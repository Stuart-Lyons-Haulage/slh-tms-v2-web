export type PlanningStop = { id: string; sequence: number; name: string; latitude?: number; longitude?: number; plannedArrivalUtc?: string };
export type PlanningLoad = { reference?: string; rawReference?: string; southbound?: boolean; stops: PlanningStop[] };
export type DispatchDriverSortRow = { driverId: string; displayName: string; driverType: string; assignedLoadId?: string };

let focusedDriverIds: Set<string> | undefined;

/** Set before the operational Dispatch table mounts so it shares Smart Dispatch's rolling population. */
export function setDispatchFocusedDriverIds(driverIds?: Iterable<string>) {
  focusedDriverIds = driverIds ? new Set(driverIds) : undefined;
}

function orderedStops(load?: PlanningLoad) { return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence); }
function compactRun(load?: PlanningLoad) { if (!load) return "—"; const match = `${load.reference || ""} ${load.rawReference || ""}`.match(/\b(?:run\s*)?(\d{1,3})\b/i); return `${load.southbound ? "SB " : ""}${match?.[1] || load.reference || "—"}`; }
function cleanStopName(value?: string) { return (value || "").replace(/^(?:Collect|Deliver)\s*[·:-]\s*/i, "").replace(/-/g, " ").trim(); }
function driverTypeOrder(type: string) { return type === "Employed" ? 0 : type === "Casual" ? 1 : type === "Agency" ? 2 : type === "Subcontractor" ? 3 : 4; }
export function firstCollectionStop(load?: PlanningLoad) { const stops = orderedStops(load); return stops.find(stop => /^Collect\b/i.test(stop.name || "")) || stops[0]; }
export function suggestionRunLabel(load?: PlanningLoad) { const run = compactRun(load); const label = run.startsWith("SB ") ? `SB Run ${run.slice(3)}` : `Run ${run}`; const destination = cleanStopName(orderedStops(load).at(-1)?.name); return destination ? `${label} ${destination}` : label; }
export function runDirection(load: PlanningLoad) { const mapped = orderedStops(load).filter(stop => stop.latitude != null && stop.longitude != null); const first = mapped[0]; const final = orderedStops(load).at(-1); if (first?.latitude != null && final?.latitude != null) { const delta = final.latitude - first.latitude; if (delta >= 0.35) return "Northern"; if (delta <= -0.35) return "Southern"; } return load.southbound ? "Southern" : "Local / Other"; }
export function sortDispatchDrivers<T extends DispatchDriverSortRow>(drivers: T[]) {
  const focused = focusedDriverIds ? drivers.filter(driver => focusedDriverIds?.has(driver.driverId)) : drivers;
  return [...focused].sort((left, right) => {
    const allocated = Number(Boolean(right.assignedLoadId)) - Number(Boolean(left.assignedLoadId));
    if (allocated !== 0) return allocated;
    const type = driverTypeOrder(left.driverType) - driverTypeOrder(right.driverType);
    return type || left.displayName.localeCompare(right.displayName);
  });
}