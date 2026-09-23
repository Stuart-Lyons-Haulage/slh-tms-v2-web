import { apiBaseUrl, request } from "../../lib/api";
import type {
  DispatchAllocationSelection,
  DispatchAvailableTimeDto,
  DispatchDriverDto,
  DispatchDriverStatusDto,
  DispatchEquipmentWorkbench,
  DispatchHistoryItem,
  DispatchLockResponse,
  DispatchRunDto,
  DispatchVisibilitySnapshot
} from "./types";

export type DispatchReadiness = {
  canDispatch: boolean;
  explanation?: string;
  structuralReadiness?: {
    classification: "Recommended" | "Unverified" | "Blocked";
    requiresAcknowledgement: boolean;
    checks: Array<{ passed: boolean; message: string }>;
  };
};

export async function getDispatchVisibility(planningDate: string, token: string): Promise<DispatchVisibilitySnapshot> {
  return request<DispatchVisibilitySnapshot>(
    `/api/dispatch/driver-visibility?date=${encodeURIComponent(planningDate)}`,
    token
  );
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
    trailerSwapRequested
  };
}

export async function getSmartDispatch(
  planningDate: string,
  token: string
): Promise<{
  drivers: DispatchDriverDto[];
  runs: DispatchRunDto[];
  equipment: DispatchEquipmentWorkbench;
  statuses: Record<string, DispatchDriverStatusDto>;
  visibility: DispatchVisibilitySnapshot;
}> {
  const encoded = encodeURIComponent(planningDate);
  const [drivers, runs, equipment, statusResponse, visibility, history] = await Promise.all([
    request<DispatchDriverDto[]>(`/api/dispatch/drivers?date=${encoded}`, token),
    request<DispatchRunDto[]>(`/api/dispatch/runs?date=${encoded}`, token),
    request<DispatchEquipmentWorkbench>(`/api/v1/driver-dispatch?date=${encoded}`, token),
    request<{ drivers: DispatchDriverStatusDto[] }>(`/api/v1/driver-dispatch-status?date=${encoded}`, token),
    getDispatchVisibility(planningDate, token),
    getDispatchHistory(planningDate, token).catch(() => [] as DispatchHistoryItem[])
  ]);
  const visibilityByDriver = new Map(visibility.drivers.map(item => [item.driverId, item]));
  const historyByDriver = new Map(history.map(item => [item.driverId, item]));
  const enrichedDrivers = drivers.map(driver => {
    const historical = historyByDriver.get(driver.driverId);
    const hasAuthoritativePosition = Boolean(driver.trackingData.lastKnownPosition);
    const fallbackPosition = historical?.previousFinalLatitude != null && historical?.previousFinalLongitude != null
      ? { latitude: historical.previousFinalLatitude, longitude: historical.previousFinalLongitude }
      : undefined;
    return {
      ...driver,
      employmentType: visibilityByDriver.get(driver.driverId)?.employmentType ?? driver.employmentType,
      skills: visibilityByDriver.get(driver.driverId)?.skills ?? driver.skills,
      driverCode: visibilityByDriver.get(driver.driverId)?.coding?.trim() || driver.driverCode,
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
  return {
    drivers: enrichedDrivers,
    runs: runs.map(run => runDetail(run, equipment)),
    equipment,
    statuses: Object.fromEntries(statusResponse.drivers.map(status => [status.driverId, status])),
    visibility
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

export async function checkDispatchReadiness(
  runId: string,
  routeDrivingMinutes: number,
  acknowledgeUnverified: boolean,
  token: string
): Promise<DispatchReadiness> {
  return request<DispatchReadiness>(`/api/v1/loads/${encodeURIComponent(runId)}/dispatch-readiness`, token, {
    method: "POST",
    body: JSON.stringify({ routeDrivingMinutes, acknowledgeUnverified })
  }, 90000);
}

export async function sendDriverMessage(
  runId: string,
  message: string,
  dispatch: boolean,
  routeDrivingMinutes: number | null,
  acknowledgeUnverified: boolean,
  token: string
): Promise<void> {
  await request(`/api/v1/loads/${encodeURIComponent(runId)}/driver-message/sms`, token, {
    method: "POST",
    body: JSON.stringify({ message, dispatch, routeDrivingMinutes, acknowledgeUnverified })
  }, 90000);
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
      plannedStartUtc: selection.plannedStartTime || null
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
