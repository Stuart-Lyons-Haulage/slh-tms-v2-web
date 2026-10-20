import { runMetrics, sortRunsForDispatch } from "./dispatchRunFit";
import { apiBaseUrl, request } from "../../lib/api";
import type {
  DispatchAllocationSelection,
  DispatchAvailableTimeDto,
  DispatchDriverDto,
  DispatchDriverStatusDto,
  DriverAvailabilitySnapshot,
  DispatchEquipmentWorkbench,
  DispatchHistoryItem,
  DispatchLockResponse,
  LegacyDispatchLoad,
  DispatchRunDto,
  DispatchVisibilitySnapshot
} from "./types";
import { availabilityDayCount } from "./availabilityDayCount";
import { isPotentiallyDispatchAvailable } from "./dispatchBoardState";

const DISPATCH_READ_TIMEOUT_MS = 60_000;
const DISPATCH_TACHO_TIMEOUT_MS = 180_000;
// Supporting feeds must not hold the authoritative driver board hostage. They
// still complete in the background at the HTTP layer, but the UI uses a
// conservative snapshot if they exceed this render budget.
const DISPATCH_SUPPORT_TIMEOUT_MS = 5_000;

function supportFeed<T>(promise: Promise<T>, fallback: T, onDegraded: () => void): Promise<T> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: T, degraded: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (degraded) onDegraded();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(fallback, true), DISPATCH_SUPPORT_TIMEOUT_MS);
    promise.then(value => finish(value, false)).catch(() => finish(fallback, true));
  });
}

export type SamsaraDispatchResult = {
  success: boolean;
  runId: string;
  reference: string;
  routeId?: string;
  externalId: string;
  created: boolean;
  updated: boolean;
  assignment: "driver" | "vehicle" | "unallocated";
  samsaraDriverId?: string;
  samsaraVehicleId?: string;
  stopCount: number;
  message: string;
};

export type SamsaraDispatchState = {
  runId: string;
  reference?: string;
  routeId: string;
  deliveryRouteId?: string;
  exportedAtUtc: string;
  requiresResend?: boolean;
  executionState?: string;
  executionOperation?: string;
  executionUpdatedAtUtc?: string;
  lastStopName?: string;
};

export type DispatchRosterHealth = {
  healthy: boolean;
  activeDrivers: number;
  tachoLinkedDrivers: number;
  latestTachoSyncUtc?: string;
  message: string;
};

type DriverDispatchAuthority = DispatchEquipmentWorkbench & {
  drivers: Array<{
    driverId: string;
    employeeNumber?: string;
    displayName?: string;
    driverType?: string;
    driverGroup?: string;
    skills?: string;
    coding?: string;
    dayNumber: number;
    workingStyle?: string;
    recentLongRuns?: number;
    recentFurthestMiles?: number;
    onLeave: boolean;
    leaveType?: string;
    leaveDetails?: string;
    partDayLeave: boolean;
  }>;
};

function authorityFallbackDriver(driver: DriverDispatchAuthority["drivers"][number]): DispatchDriverDto {
  const employmentType = driver.driverType || driver.driverGroup || "Unknown";
  return {
    driverId: driver.driverId,
    driverCode: driver.coding || driver.employeeNumber || driver.driverId,
    name: driver.displayName || driver.employeeNumber || driver.driverId,
    employmentType,
    skills: driver.skills || "",
    holidayDates: [],
    contractedDays: [],
    tachoData: {
      currentDutyDay: driver.dayNumber || 0,
      weeklyWorkingTime: 0,
      dailyDrivingTime: 0,
      breakCompliance: false,
      requiredRestPeriod: 11,
      reducedDailyRestsUsed: 0
    },
    trackingData: {},
    needsReturn: false,
    isBlocked: false,
    backloadCandidate: false,
    onLeave: driver.onLeave,
    leaveType: driver.leaveType,
    leaveDetails: driver.leaveDetails,
    partDayLeave: driver.partDayLeave,
    suggestion: driver.onLeave ? `Unavailable · Sage HR ${driver.leaveType || "leave"}.` : "Roster identity loaded; availability requires verification."
  };
}

type SamsaraDispatchStatusResponse = {
  planningDate: string;
  configured: boolean;
  connected: boolean;
  connectionMessage?: string;
  remoteVerification?: boolean;
  staleRouteCount?: number;
  runs: SamsaraDispatchState[];
};

export async function getSamsaraDispatchStatus(planningDate: string, token: string): Promise<{
  configured: boolean;
  connectionMessage?: string;
  staleRouteCount: number;
  runs: Record<string, SamsaraDispatchState>;
}> {
  const status = await request<SamsaraDispatchStatusResponse>(
    `/api/v1/integrations/samsara/dispatch/status?date=${encodeURIComponent(planningDate)}`, token, undefined, DISPATCH_READ_TIMEOUT_MS
  );
  return {
    configured: status.configured && status.connected,
    connectionMessage: status.connectionMessage,
    staleRouteCount: status.staleRouteCount || 0,
    runs: Object.fromEntries(status.runs.map(run => [run.runId, run]))
  };
}

export type SmartDispatchOptionalEnrichment = {
  drivers: DispatchDriverDto[];
  samsaraConfigured: boolean;
  samsaraConnectionMessage?: string;
  samsaraStaleRouteCount: number;
  samsaraDispatch: Record<string, SamsaraDispatchState>;
};

export async function getDispatchVisibility(planningDate: string, token: string): Promise<DispatchVisibilitySnapshot> {
  return request<DispatchVisibilitySnapshot>(
    `/api/dispatch/driver-visibility?date=${encodeURIComponent(planningDate)}`,
    token,
    undefined,
    DISPATCH_READ_TIMEOUT_MS
  );
}

export async function getDriverAvailability(planningDate: string, token: string): Promise<DriverAvailabilitySnapshot> {
  return request<DriverAvailabilitySnapshot>(`/api/v1/driver-availability?date=${encodeURIComponent(planningDate)}`, token, undefined, DISPATCH_READ_TIMEOUT_MS);
}

export async function getDispatchRosterHealth(token: string): Promise<DispatchRosterHealth> {
  return request<DispatchRosterHealth>("/api/v1/driver-dispatch/health", token, undefined, 10_000);
}

export async function getDispatchHistory(planningDate: string, token: string): Promise<DispatchHistoryItem[]> {
  return request<DispatchHistoryItem[]>(
    `/api/dispatch/history?date=${encodeURIComponent(planningDate)}`,
    token,
    undefined,
    DISPATCH_READ_TIMEOUT_MS
  );
}

function cleanStopName(value?: string): string | undefined {
  const cleaned = value?.replace(/^(?:Collect|Deliver)\s*[·:-]\s*/i, "").replace(/-/g, " ").trim();
  return cleaned || undefined;
}

function authorityRun(load: LegacyDispatchLoad): DispatchRunDto {
  const stops = [...(load.stops || [])].sort((left, right) => left.sequence - right.sequence);
  const collection = stops.find(stop => /^collect\\b/i.test(stop.name)) || stops[0];
  const delivery = [...stops].reverse().find(stop => /^deliver\\b/i.test(stop.name)) || stops.at(-1);
  return {
    runId: load.id,
    reference: load.reference || load.rawReference || load.id,
    collectionPoint: { name: cleanStopName(collection?.name) || collection?.name || "Collection pending", latitude: collection?.latitude, longitude: collection?.longitude },
    requiredSkills: "",
    requiresDoubleDeck: false,
    requiresRefrigerated: false,
    isBackload: Boolean(load.southbound),
    isOvernightMarket: false,
    isSouthbound: Boolean(load.southbound),
    firstCollectionTimeUtc: collection?.plannedCollectionTimeUtc || collection?.plannedArrivalUtc || load.plannedStartUtc,
    deliveryCutoffTimeUtc: delivery?.deliveryCutoffTimeUtc,
    finalDeliveryPoint: delivery ? { name: cleanStopName(delivery.name) || delivery.name, latitude: delivery.latitude, longitude: delivery.longitude } : undefined,
    plannerNotes: load.plannerNotes,
    trailerSwapRequested: /(?:trailer\\s*(?:swap|change)|swap\\s*trailer|drop\\s*trailer|pick\\s*up\\s+(?:a\\s*)?(?:different|new)\\s*trailer)/i.test(load.plannerNotes || ""),
    relay: load.relayPlan
  };
}

function runDetail(run: DispatchRunDto, equipment: DispatchEquipmentWorkbench): DispatchRunDto {
  const load = equipment.loads.find(item => item.id === run.runId);
  if (!load) return run;
  const ordered = [...(load.stops || [])].sort((left, right) => left.sequence - right.sequence);
  const collection = ordered.find(stop => /^collect\b/i.test(stop.name)) || ordered[0];
  const delivery = [...ordered].reverse().find(stop => /^deliver\b/i.test(stop.name)) || ordered.at(-1);
  const notes = [load.plannerNotes, ...(ordered.map(stop => stop.plannerNote))].filter(Boolean).join(" ");
  const trailerSwapRequested = /(?:trailer\s*(?:swap|change)|swap\s*trailer|change\s*trailer|drop\s*trailer|pick\s*up\s*(?:a\s*)?(?:different|new)\s*trailer)/i.test(notes);
  return {
    ...run,
    ...runMetrics(load),
    firstCollectionTimeUtc: collection?.plannedCollectionTimeUtc || collection?.plannedArrivalUtc || load.plannedStartUtc,
    deliveryCutoffTimeUtc: delivery?.deliveryCutoffTimeUtc,
    finalDeliveryPoint: delivery ? {
      name: cleanStopName(delivery.name) || delivery.name,
      latitude: delivery.latitude,
      longitude: delivery.longitude
    } : undefined,
    plannerNotes: load.plannerNotes,
    trailerSwapRequested,
    relay: load.relayPlan
  };
}

export async function getSmartDispatch(
  planningDate: string,
  token: string,
  onOptionalEnrichment?: (enrichment: SmartDispatchOptionalEnrichment) => void,
  onAvailableTimes?: (availableTimes: DispatchAvailableTimeDto[]) => void
): Promise<{
  drivers: DispatchDriverDto[];
  runs: DispatchRunDto[];
  equipment: DispatchEquipmentWorkbench;
  availableTimes: DispatchAvailableTimeDto[];
  statuses: Record<string, DispatchDriverStatusDto>;
  visibility: DispatchVisibilitySnapshot;
  availability: DriverAvailabilitySnapshot;
  samsaraConfigured: boolean;
  samsaraConnectionMessage?: string;
  samsaraStaleRouteCount: number;
  samsaraDispatch: Record<string, SamsaraDispatchState>;
  degradedSources: string[];
  rosterHealth: DispatchRosterHealth;
}> {
  const encoded = encodeURIComponent(planningDate);
  const rosterHealthPromise = getDispatchRosterHealth(token).catch(() => undefined);
  // Use the single authoritative Driver Dispatch snapshot for the initial board.
  // The old implementation started three heavyweight reads together; each rebuilt
  // Tacho/availability state and they competed for the same SQL/provider resources,
  // causing the mobile gateway to return 504 and an empty limited-mode board.
  const authorityResult = await Promise.allSettled([
    request<DriverDispatchAuthority>(`/api/v1/driver-dispatch?date=${encoded}`, token, undefined, DISPATCH_READ_TIMEOUT_MS)
  ]);
  const rosterHealth = (await rosterHealthPromise) || {
    healthy: false,
    activeDrivers: 0,
    tachoLinkedDrivers: 0,
    message: "Driver Master health could not be checked."
  };
  const degradedSources: string[] = [];
  const driverAuthority = authorityResult[0].status === "fulfilled"
    ? authorityResult[0].value
    : (degradedSources.push("equipment", "drivers", "runs"), { drivers: [], vehicles: [], trailers: [], loads: [] } as DriverDispatchAuthority);
  const requestedDrivers: DispatchDriverDto[] = [];
  const runs = driverAuthority.loads.map(authorityRun);
  // The Driver Master authority endpoint is a deliberately smaller, resilient
  // roster. If the enriched dispatch roster is empty or unavailable, retain
  // those identities rather than rendering an empty driver board.
  const drivers = requestedDrivers.length > 0
    ? requestedDrivers
    : driverAuthority.drivers.map(authorityFallbackDriver);
  if (requestedDrivers.length === 0 && driverAuthority.drivers.length > 0 && !degradedSources.includes("drivers")) {
    degradedSources.push("drivers");
  }
  // History and Samsara improve the board but are not needed to allocate safely.
  // Start both in parallel with the core requests and apply them when they finish;
  // a slow optional integration must not delay the Dispatch table.
  const optionalEnrichmentPromise = Promise.all([
    getDispatchHistory(planningDate, token).catch(() => [] as DispatchHistoryItem[]),
    request<SamsaraDispatchStatusResponse>(`/api/v1/integrations/samsara/dispatch/status?date=${encoded}`, token, undefined, DISPATCH_READ_TIMEOUT_MS)
      .catch(() => ({
        planningDate,
        configured: false,
        connected: false,
        connectionMessage: "Samsara connection status could not be checked.",
        runs: []
      } as SamsaraDispatchStatusResponse))
  ]);
  // Status, visibility and availability are supporting feeds. They must never
  // take down the authoritative drivers/runs/equipment board when one source is
  // slow or temporarily unavailable. An empty snapshot is deliberately
  // conservative: it does not promote anyone to available or clear a block.
  const [statusResponse, visibility, availability] = await Promise.all([
    supportFeed(
      request<{ drivers: DispatchDriverStatusDto[] }>(`/api/v1/driver-dispatch-status?date=${encoded}`, token, undefined, DISPATCH_READ_TIMEOUT_MS),
      { drivers: [] },
      () => degradedSources.push("status")
    ),
    supportFeed(
      getDispatchVisibility(planningDate, token),
      {
        planningDate,
        windowDays: 0,
        cutoffDate: planningDate,
        drivers: []
      } as DispatchVisibilitySnapshot,
      () => degradedSources.push("visibility")
    ),
    supportFeed(
      getDriverAvailability(planningDate, token),
      {
        planningDate,
        generatedAtUtc: new Date().toISOString(),
        summary: {
          employedAvailable: 0,
          agencyConfirmed: 0,
          agencyUnconfirmed: 0,
          casualConfirmed: 0,
          casualUnconfirmed: 0,
          unavailableBlocked: 0,
          driversRequired: 0,
          availableDrivers: 0,
          surplusShortfall: 0
        },
        drivers: [],
        classificationMismatchCount: 0
      } as DriverAvailabilitySnapshot,
      () => degradedSources.push("availability")
    )
  ]);
  const visibilityByDriver = new Map(visibility.drivers.map(item => [item.driverId, item]));
  const availabilityByDriver = new Map(availability.drivers.map(item => [item.driverId, item]));
  const authorityByDriver = new Map(driverAuthority.drivers.map(item => [item.driverId, item]));
  const equipment: DispatchEquipmentWorkbench = driverAuthority;
  // The driver roster is useful on its own. Equipment/authority enriches it
  // when available, but a failed authority read must not hide every driver.
  const enrichedDrivers = drivers.map(driver => {
    const authority = authorityByDriver.get(driver.driverId);
    const visibilityDriver = visibilityByDriver.get(driver.driverId);
    const sharedAvailability = availabilityByDriver.get(driver.driverId);
    return {
      ...driver,
      dayNumber: authority?.dayNumber ?? driver.tachoData.currentDutyDay,
      workingStyle: authority?.workingStyle,
      recentLongRuns: authority?.recentLongRuns,
      recentFurthestMiles: authority?.recentFurthestMiles,
      onLeave: authority?.onLeave === true,
      leaveType: authority?.leaveType,
      leaveDetails: authority?.leaveDetails,
      partDayLeave: authority?.partDayLeave === true,
      isBlocked: driver.isBlocked || authority?.onLeave === true || sharedAvailability?.dispatchable === false,
      blockedReason: sharedAvailability?.dispatchable === false
        ? sharedAvailability.blockReasons.join(" · ")
        : authority?.onLeave
        ? `Sage HR ${authority.leaveType || "leave"}${authority.partDayLeave ? " (part day)" : ""}`
        : driver.blockedReason,
      // Sage HR is the only authority allowed to label a driver Employed. If the
      // visibility snapshot is unavailable, preserve known non-employed categories
      // but never promote the local Driver Master default to Employed.
      employmentType: sharedAvailability?.employmentType ?? visibilityDriver?.employmentType ?? "Unknown",
      skills: sharedAvailability?.skills ?? visibilityDriver?.skills ?? driver.skills,
      availabilityGroup: sharedAvailability?.group,
      availableFrom: sharedAvailability?.availableFromUtc ?? driver.availableFrom,
      availabilityUntil: sharedAvailability?.availableUntilUtc,
      availabilityConfirmed: sharedAvailability?.availabilityConfirmed,
      availabilityState: (sharedAvailability
        ? sharedAvailability.dispatchable === false ? "unavailable" : "available"
        : "unknown") as DispatchDriverDto["availabilityState"],
      availabilitySourceUpdatedAtUtc: availability.generatedAtUtc,
      availabilityDayCount: availabilityDayCount(sharedAvailability, planningDate),
      agencyName: sharedAvailability?.agencyName,
      placementEndDate: sharedAvailability?.placementEndDate,
      classificationMismatch: sharedAvailability?.classificationMismatch,
      driverCode: visibilityDriver?.coding?.trim() || driver.driverCode,
      suggestion: authority?.onLeave
        ? `Unavailable · Sage HR ${authority.leaveType || "leave"}${authority.partDayLeave ? " (part day)" : ""}.`
        : driver.suggestion
    };
  });
  // Keep the full classified roster visible in the availability workbench.
  // Blocked and unconfirmed people remain visible with their reasons; allocation
  // controls continue to enforce these decisions.
  const assignedDriverIds = new Set(equipment.loads.map(load => load.driverId).filter(Boolean));
  const potentialDriverIds = enrichedDrivers
    .filter(driver => assignedDriverIds.has(driver.driverId)
      || isPotentiallyDispatchAvailable(driver, statusResponse.drivers.find(item => item.driverId === driver.driverId)))
    .map(driver => driver.driverId);
  const availableTimesPromise = potentialDriverIds.length
    ? getAvailableTimes(planningDate, potentialDriverIds, token)
    : Promise.resolve([] as DispatchAvailableTimeDto[]);
  const availableTimeByDriver = new Map<string, DispatchAvailableTimeDto>();
  // Fetch legal-start calculations after rendering the core Dispatch board.
  // Server-side checks still govern allocations.
  void availableTimesPromise.then(rows => {
    rows.forEach(item => availableTimeByDriver.set(item.driverId, item));
    onAvailableTimes?.(rows);
  }).catch(() => undefined);
  const annotateAvailability = (items: DispatchDriverDto[]) => items.map(driver => {
    const legal = availableTimeByDriver.get(driver.driverId);
    if (!legal?.breachDetail || driver.blockedReason?.includes(legal.breachDetail)) return driver;
    return {
      ...driver,
      isBlocked: true,
      blockedReason: [driver.blockedReason, legal.breachDetail].filter(Boolean).join(" · ")
    };
  });

  void optionalEnrichmentPromise.then(([history, samsaraStatus]) => {
    const historyByDriver = new Map(history.map(item => [item.driverId, item]));
    const driversWithHistory = enrichedDrivers.map(driver => {
      const historical = historyByDriver.get(driver.driverId);
      const hasAuthoritativePosition = Boolean(driver.trackingData.lastKnownPosition);
      const fallbackPosition = historical?.previousFinalLatitude != null && historical?.previousFinalLongitude != null
        ? { latitude: historical.previousFinalLatitude, longitude: historical.previousFinalLongitude }
        : undefined;
      return {
        ...driver,
        trackingData: {
          ...driver.trackingData,
          lastKnownPosition: driver.trackingData.lastKnownPosition || fallbackPosition,
          lastStopName: driver.trackingData.lastStopName || historical?.previousFinalStopName,
          lastPositionAtUtc: driver.trackingData.lastPositionAtUtc
        },
        previousRunReference: historical?.previousRunReference,
        previousPlanningDate: historical?.previousPlanningDate,
        previousTrailerId: historical?.previousTrailerId,
        previousTrailerNumber: historical?.previousTrailerNumber,
        previousTrailerPlanningDate: historical?.previousTrailerPlanningDate,
        suggestion: driver.suggestion || (!hasAuthoritativePosition && historical?.previousFinalStopName
          ? `Last known operational stop · ${historical.previousFinalStopName}`
          : undefined)
      };
    });
    onOptionalEnrichment?.({
      drivers: annotateAvailability(driversWithHistory),
      samsaraConfigured: samsaraStatus.configured && samsaraStatus.connected,
      samsaraConnectionMessage: samsaraStatus.connectionMessage,
      samsaraStaleRouteCount: samsaraStatus.staleRouteCount || 0,
      samsaraDispatch: Object.fromEntries(samsaraStatus.runs.map(item => [item.runId, item]))
    });
  }).catch(() => undefined);

  return {
    drivers: annotateAvailability(enrichedDrivers),
    runs: sortRunsForDispatch(runs.map(run => runDetail(run, equipment))),
    equipment,
    availableTimes: [],
    statuses: Object.fromEntries(statusResponse.drivers.map(status => [status.driverId, status])),
    visibility,
    availability,
    samsaraConfigured: false,
    samsaraConnectionMessage: "Samsara status is loading.",
    samsaraStaleRouteCount: 0,
    samsaraDispatch: {},
    degradedSources,
    rosterHealth: {
      ...rosterHealth,
      activeDrivers: rosterHealth.activeDrivers || drivers.length,
      healthy: rosterHealth.healthy || drivers.length > 0
    }
  };
}

export async function syncDispatchDrivers(token: string): Promise<void> {
  await request("/api/v1/driver-master/tachomaster/sync", token, { method: "POST" }, 180000);
}

export async function getAvailableTimes(
  planningDate: string,
  driverIds: string[],
  token: string,
  reducedRestDriverIds: string[] = []
): Promise<DispatchAvailableTimeDto[]> {
  return request<DispatchAvailableTimeDto[]>("/api/dispatch/available-times", token, {
    method: "POST",
    body: JSON.stringify({ planningDate, driverIds, reducedRestDriverIds })
  }, DISPATCH_TACHO_TIMEOUT_MS);
}

export async function syncSamsaraMappings(planningDate: string, token: string): Promise<void> {
  await request(
    `/api/v1/integrations/samsara/dispatch/mappings/sync?date=${encodeURIComponent(planningDate)}`,
    token,
    { method: "POST" },
    60000
  );
}

export async function sendRunToSamsara(runId: string, token: string): Promise<SamsaraDispatchResult> {
  return request<SamsaraDispatchResult>(
    `/api/v1/integrations/samsara/dispatch/${encodeURIComponent(runId)}`,
    token,
    { method: "POST" },
    90000
  );
}

export async function downloadSamsaraCsv(runId: string, reference: string, token: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/integrations/samsara/dispatch/${encodeURIComponent(runId)}/csv`, {
    headers: {
      Accept: "text/csv",
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || `Samsara CSV export failed (${response.status}).`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `SLH-${reference.replace(/[^a-z0-9_-]+/gi, "-")}-Samsara.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function unassignDispatchRun(runId: string, token: string): Promise<void> {
  await request(`/api/v1/runs/${encodeURIComponent(runId)}/allocation`, token, {
    method: "PUT",
    body: JSON.stringify({ driverId: null, vehicleId: null, trailerId: null })
  }, 90000);
}

export async function allocateDispatchRun(
  runId: string,
  driverId: string,
  selection: DispatchAllocationSelection,
  token: string
): Promise<LegacyDispatchLoad> {
  return request<LegacyDispatchLoad>(`/api/v1/runs/${encodeURIComponent(runId)}/allocation`, token, {
    method: "PUT",
    body: JSON.stringify({
      driverId,
      vehicleId: selection.vehicleId,
      trailerId: selection.trailerId || null,
      plannedStartUtc: selection.plannedStartTime || null,
      useReducedDailyRest: selection.useReducedDailyRest === true
    })
  }, 90000);
}

export async function lockDispatchPlan(
  planningDate: string,
  selections: Array<{ driverId: string; selection: DispatchAllocationSelection }>,
  token: string
): Promise<DispatchLockResponse> {
  const response = await fetch(`${apiBaseUrl}/api/dispatch/lock`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      planningDate,
      allocations: selections.map(({ driverId, selection }) => ({
        driverId,
        vehicleId: selection.vehicleId,
        trailerId: selection.trailerId || null,
        runId: selection.runId,
        plannedStartTime: selection.plannedStartTime,
        useReducedDailyRest: selection.useReducedDailyRest === true
      }))
    })
  });

  const payload = (await response.json().catch(() => ({ success: false, failures: [] }))) as DispatchLockResponse;
  if (response.ok) return payload;
  if (payload.failures?.length) return payload;
  return {
    success: false,
    failures: [{ driverId: "", reason: `Plan lock failed (${response.status}). Refresh and try again.` }]
  };
}
