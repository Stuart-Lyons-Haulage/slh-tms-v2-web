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
  DispatchRunDto,
  DispatchVisibilitySnapshot
} from "./types";
import { availabilityDayCount } from "./availabilityDayCount";

export type SamsaraDispatchResult = {
  success: boolean;
  runId: string;
  reference: string;
  routeId?: string;
  externalId: string;
  created: boolean;
  updated: boolean;
  assignment: "driver" | "vehicle";
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
  executionState?: string;
  executionOperation?: string;
  executionUpdatedAtUtc?: string;
  lastStopName?: string;
};

type DriverDispatchAuthority = DispatchEquipmentWorkbench & {
  drivers: Array<{
    driverId: string;
    dayNumber: number;
    onLeave: boolean;
    leaveType?: string;
    leaveDetails?: string;
    partDayLeave: boolean;
  }>;
};

type SamsaraDispatchStatusResponse = {
  planningDate: string;
  configured: boolean;
  connected: boolean;
  connectionMessage?: string;
  remoteVerification?: boolean;
  staleRouteCount?: number;
  runs: SamsaraDispatchState[];
};

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
    token
  );
}

export async function getDriverAvailability(planningDate: string, token: string): Promise<DriverAvailabilitySnapshot> {
  return request<DriverAvailabilitySnapshot>(`/api/v1/driver-availability?date=${encodeURIComponent(planningDate)}`, token);
}

export async function getDispatchHistory(planningDate: string, token: string): Promise<DispatchHistoryItem[]> {
  return request<DispatchHistoryItem[]>(
    `/api/dispatch/history?date=${encodeURIComponent(planningDate)}`,
    token
  );
}

function cleanStopName(value?: string): string | undefined {
  const cleaned = value?.replace(/^(?:Collect|Deliver)\s*[·:-]\s*/i, "").replace(/-/g, " ").trim();
  return cleaned || undefined;
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
    firstCollectionTimeUtc: collection?.plannedArrivalUtc || load.plannedStartUtc,
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
  onOptionalEnrichment?: (enrichment: SmartDispatchOptionalEnrichment) => void
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
}> {
  const encoded = encodeURIComponent(planningDate);
  // The legal-start calculation is the slowest Dispatch dependency because it
  // fans out to TachoMaster. Start it as soon as the authoritative workbench
  // gives us the driver IDs instead of waiting for the optional enrichment
  // requests (visibility, history and Samsara) to finish first.
  const [drivers, runs, driverAuthority] = await Promise.all([
    request<DispatchDriverDto[]>(`/api/dispatch/drivers?date=${encoded}`, token),
    request<DispatchRunDto[]>(`/api/dispatch/runs?date=${encoded}`, token),
    request<DriverDispatchAuthority>(`/api/v1/driver-dispatch?date=${encoded}`, token)
  ]);
  const availableTimesPromise = getAvailableTimes(
    planningDate,
    driverAuthority.drivers.map(driver => driver.driverId),
    token
  );
  // History and Samsara improve the board but are not needed to allocate safely.
  // Start both in parallel with the core requests and apply them when they finish;
  // a slow optional integration must not delay the Dispatch table.
  const optionalEnrichmentPromise = Promise.all([
    getDispatchHistory(planningDate, token).catch(() => [] as DispatchHistoryItem[]),
    request<SamsaraDispatchStatusResponse>(`/api/v1/integrations/samsara/dispatch/status?date=${encoded}`, token)
      .catch(() => ({
        planningDate,
        configured: false,
        connected: false,
        connectionMessage: "Samsara connection status could not be checked.",
        runs: []
      } as SamsaraDispatchStatusResponse))
  ]);
  const [statusResponse, visibility, availability] = await Promise.all([
    request<{ drivers: DispatchDriverStatusDto[] }>(`/api/v1/driver-dispatch-status?date=${encoded}`, token),
    getDispatchVisibility(planningDate, token),
    getDriverAvailability(planningDate, token)
  ]);
  const visibilityByDriver = new Map(visibility.drivers.map(item => [item.driverId, item]));
  const availabilityByDriver = new Map(availability.drivers.map(item => [item.driverId, item]));
  const authorityByDriver = new Map(driverAuthority.drivers.map(item => [item.driverId, item]));
  const equipment: DispatchEquipmentWorkbench = driverAuthority;
  const enrichedDrivers = drivers.filter(driver => authorityByDriver.has(driver.driverId)).map(driver => {
    const authority = authorityByDriver.get(driver.driverId);
    const visibilityDriver = visibilityByDriver.get(driver.driverId);
    const sharedAvailability = availabilityByDriver.get(driver.driverId);
    return {
      ...driver,
      dayNumber: authority?.dayNumber ?? driver.tachoData.currentDutyDay,
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
  // Dispatch is an availability workbench, not a complete Driver Master list.
  // Keep only drivers who pass the shared availability decision and the latest
  // TachoMaster legal-hours calculation; Sage HR leave/contract blocks are already
  // reflected in driver.isBlocked by the API authority response.
  const availableTimeByDriver = new Map((await availableTimesPromise).map(item => [item.driverId, item]));
  const dispatchable = (items: DispatchDriverDto[]) => items.filter(driver => {
    const shared = availabilityByDriver.get(driver.driverId);
    const legal = availableTimeByDriver.get(driver.driverId);
    return !driver.isBlocked && shared?.dispatchable !== false && !legal?.breachDetail;
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
      drivers: dispatchable(driversWithHistory),
      samsaraConfigured: samsaraStatus.configured && samsaraStatus.connected,
      samsaraConnectionMessage: samsaraStatus.connectionMessage,
      samsaraStaleRouteCount: samsaraStatus.staleRouteCount || 0,
      samsaraDispatch: Object.fromEntries(samsaraStatus.runs.map(item => [item.runId, item]))
    });
  }).catch(() => undefined);

  return {
    drivers: dispatchable(enrichedDrivers),
    runs: runs.map(run => runDetail(run, equipment)),
    equipment,
    availableTimes: [...availableTimeByDriver.values()],
    statuses: Object.fromEntries(statusResponse.drivers.map(status => [status.driverId, status])),
    visibility,
    availability,
    samsaraConfigured: false,
    samsaraConnectionMessage: "Samsara status is loading.",
    samsaraStaleRouteCount: 0,
    samsaraDispatch: {}
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
  });
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
): Promise<void> {
  await request(`/api/v1/runs/${encodeURIComponent(runId)}/allocation`, token, {
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
