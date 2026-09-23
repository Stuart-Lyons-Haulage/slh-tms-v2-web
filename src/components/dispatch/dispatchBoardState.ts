import { canDriverTakeRun, missingSkills, tachoVehicleId, trailerEligible } from "./dispatchRules";
import type {
  DispatchAllocationSelection,
  DispatchAvailableTimeDto,
  DispatchDriverDto,
  DispatchEmploymentFilter,
  DispatchEquipmentWorkbench,
  DispatchFilter,
  DispatchLockFailure,
  DispatchRunDto
} from "./types";

export type DispatchSelectionMap = Record<string, DispatchAllocationSelection>;
export type DispatchAvailableTimeMap = Record<string, DispatchAvailableTimeDto>;

export function emptyDispatchSelection(): DispatchAllocationSelection {
  return { runId: "", vehicleId: "", trailerId: "", useReducedDailyRest: false };
}

export function buildInitialSelections(
  drivers: DispatchDriverDto[],
  runs: DispatchRunDto[],
  equipment: DispatchEquipmentWorkbench
): DispatchSelectionMap {
  const runIds = new Set(runs.map(run => run.runId));
  const result: DispatchSelectionMap = {};

  for (const driver of drivers) {
    const assigned = equipment.loads.find(load => load.driverId === driver.driverId && runIds.has(load.id));
    const assignedRun = runs.find(run => run.runId === assigned?.id);
    const previousTrailer = equipment.trailers.find(trailer => trailer.id === driver.previousTrailerId);
    const continuityTrailerId = previousTrailer && !assignedRun?.trailerSwapRequested && trailerEligible(assignedRun, previousTrailer)
      ? previousTrailer.id
      : "";
    result[driver.driverId] = {
      runId: assigned?.id || "",
      vehicleId: assigned?.vehicleId || tachoVehicleId(driver, equipment.vehicles),
      trailerId: assigned?.trailerId || continuityTrailerId,
      plannedStartTime: assigned?.plannedStartUtc || driver.availableFrom,
      useReducedDailyRest: false
    };
  }

  return result;
}

export function reducedRestDriverIds(selections: DispatchSelectionMap): string[] {
  return Object.entries(selections)
    .filter(([, selection]) => selection.useReducedDailyRest === true)
    .map(([driverId]) => driverId);
}

export function applyAvailableTimes(
  selections: DispatchSelectionMap,
  times: DispatchAvailableTimeDto[]
): DispatchSelectionMap {
  const next: DispatchSelectionMap = { ...selections };
  for (const row of times) {
    const current = next[row.driverId] || emptyDispatchSelection();
    next[row.driverId] = {
      ...current,
      // Get Times is the authoritative recomputation.  Do not retain a start
      // from the previously selected run (or from the opposite rest choice).
      plannedStartTime: row.availableFrom || undefined
    };
  }
  return next;
}

export function availableTimesByDriver(rows: DispatchAvailableTimeDto[]): DispatchAvailableTimeMap {
  return Object.fromEntries(rows.map(row => [row.driverId, row]));
}

export function buildRunOwnerById(
  selections: DispatchSelectionMap,
  equipment: DispatchEquipmentWorkbench
): Record<string, string | undefined> {
  const owners: Record<string, string | undefined> = {};
  for (const load of equipment.loads) {
    if (load.driverId) owners[load.id] = load.driverId;
  }
  for (const [driverId, selection] of Object.entries(selections)) {
    if (selection.runId) owners[selection.runId] = driverId;
  }
  return owners;
}

function employmentBucket(value: string): Exclude<DispatchEmploymentFilter, "all"> {
  const token = value.toLowerCase().replace(/[^a-z]/g, "");
  if (token.includes("subcontract") || token.includes("subbie")) return "subcontractor";
  if (token.includes("agency")) return "agency";
  if (token.includes("casual") || token.includes("zerohour")) return "casual";
  return "employed";
}

export function filterDriversByEmploymentType(
  drivers: DispatchDriverDto[],
  filter: DispatchEmploymentFilter
): DispatchDriverDto[] {
  if (filter === "all") return drivers;
  return drivers.filter(driver => employmentBucket(driver.employmentType) === filter);
}

export function filterDriversByDriverSearch(
  drivers: DispatchDriverDto[],
  search: string
): DispatchDriverDto[] {
  const query = search.trim().toLowerCase();
  if (!query) return drivers;
  return drivers.filter(driver => [
    driver.name,
    driver.driverCode,
    driver.employmentType,
    driver.skills,
    driver.homeDepot,
    driver.trackingData.lastStopName,
    driver.suggestedRunReference,
    driver.suggestion,
    driver.tachoData.lastVehicleRegistration,
    driver.previousTrailerNumber,
    driver.blockedReason
  ].filter(Boolean).join(" ").toLowerCase().includes(query));
}

export function sortDriversForDispatch(
  drivers: DispatchDriverDto[],
  selections: DispatchSelectionMap
): DispatchDriverDto[] {
  return [...drivers].sort((left, right) => {
    const leftHasRun = Boolean(selections[left.driverId]?.runId);
    const rightHasRun = Boolean(selections[right.driverId]?.runId);
    if (leftHasRun !== rightHasRun) return leftHasRun ? -1 : 1;
    return left.name.localeCompare(right.name, "en-GB", { sensitivity: "base" });
  });
}

export function filterDispatchDrivers(
  drivers: DispatchDriverDto[],
  filter: DispatchFilter,
  selections: DispatchSelectionMap,
  runs: DispatchRunDto[],
  times: DispatchAvailableTimeMap,
  failures: DispatchLockFailure[]
): DispatchDriverDto[] {
  const filtered = filter === "all" ? drivers : drivers.filter(driver => {
    const selection = selections[driver.driverId] || emptyDispatchSelection();
    const selectedRun = runs.find(run => run.runId === selection.runId);
    const suggestedRun = runs.find(run => run.runId === driver.suggestedRunId);
    const available = times[driver.driverId];
    const hasFailure = failures.some(failure => failure.driverId === driver.driverId);

    if (filter === "unallocated") return !selection.runId;
    if (filter === "backloads") return driver.backloadCandidate || selectedRun?.isBackload === true || suggestedRun?.isBackload === true;
    if (filter === "warnings") return driver.isBlocked || driver.needsReturn || Boolean(available?.breachDetail) || hasFailure;
    if (filter === "skills-mismatch") {
      if (selectedRun && missingSkills(driver, selectedRun).length > 0) return true;
      return Boolean(suggestedRun && missingSkills(driver, suggestedRun).length > 0);
    }
    return true;
  });

  return sortDriversForDispatch(filtered, selections);
}

export function validateLockSelections(
  drivers: DispatchDriverDto[],
  runs: DispatchRunDto[],
  equipment: DispatchEquipmentWorkbench,
  selections: DispatchSelectionMap,
  times: DispatchAvailableTimeMap
): DispatchLockFailure[] {
  const failures: DispatchLockFailure[] = [];
  const trailers = equipment.trailers;
  const selectedRunIds = new Set<string>();
  const selectedVehicleIds = new Map<string, string>();

  for (const driver of drivers) {
    const selection = selections[driver.driverId] || emptyDispatchSelection();
    if (!selection.runId) continue;

    const run = runs.find(item => item.runId === selection.runId);
    if (!run) {
      failures.push({ driverId: driver.driverId, runId: selection.runId, reason: "The selected run is no longer available. Refresh Dispatch." });
      continue;
    }
    if (driver.isBlocked) {
      failures.push({ driverId: driver.driverId, runId: run.runId, reason: driver.blockedReason || "This driver is not available for allocation." });
    }
    if (!canDriverTakeRun(driver, run)) {
      const missing = missingSkills(driver, run);
      failures.push({
        driverId: driver.driverId,
        runId: run.runId,
        reason: missing.length > 0
          ? `Missing required skills: ${missing.join(", ")}.`
          : "This driver is not eligible for the selected run."
      });
    }
    if (!selection.vehicleId) {
      failures.push({ driverId: driver.driverId, runId: run.runId, reason: "Select a vehicle before locking this run." });
    } else {
      const existingDriver = selectedVehicleIds.get(selection.vehicleId);
      if (existingDriver && existingDriver !== driver.driverId) {
        failures.push({ driverId: driver.driverId, runId: run.runId, reason: "This vehicle is already selected for another driver in the plan." });
      } else {
        selectedVehicleIds.set(selection.vehicleId, driver.driverId);
      }
    }

    if ((run.requiresDoubleDeck || run.requiresRefrigerated) && !selection.trailerId) {
      failures.push({
        driverId: driver.driverId,
        runId: run.runId,
        reason: run.requiresDoubleDeck && run.requiresRefrigerated
          ? "Select a double-deck refrigerated trailer before locking this run."
          : run.requiresDoubleDeck
            ? "Select a double-deck trailer before locking this run."
            : "Select a refrigerated trailer before locking this run."
      });
    }
    if (selection.trailerId) {
      const trailer = trailers.find(item => item.id === selection.trailerId);
      if (!trailer || !trailerEligible(run, trailer)) {
        failures.push({ driverId: driver.driverId, runId: run.runId, reason: "The selected trailer does not meet this run's equipment requirements." });
      }
    }

    const available = times[driver.driverId];
    if (!selection.plannedStartTime) {
      failures.push({ driverId: driver.driverId, runId: run.runId, reason: "Get Tacho available times before locking this driver." });
    } else if (available?.availableFrom && new Date(selection.plannedStartTime).getTime() < new Date(available.availableFrom).getTime()) {
      failures.push({ driverId: driver.driverId, runId: run.runId, reason: "The planned start is earlier than the Tacho-derived available-from time." });
    }
    if (available) {
      const expectedRest = selection.useReducedDailyRest === true ? 9 : 11;
      if (available.requiredRestPeriod !== expectedRest) {
        failures.push({
          driverId: driver.driverId,
          runId: run.runId,
          reason: "Rest choice changed after Get Times. Recalculate Tacho available times before locking this driver."
        });
      }
    }
    if (available?.breachDetail) {
      failures.push({ driverId: driver.driverId, runId: run.runId, reason: available.breachDetail });
    }

    if (selectedRunIds.has(run.runId)) {
      failures.push({ driverId: driver.driverId, runId: run.runId, reason: "This run is already selected for another driver in the plan." });
    }
    selectedRunIds.add(run.runId);
  }

  return failures;
}

export function selectedAllocations(
  drivers: DispatchDriverDto[],
  selections: DispatchSelectionMap
): Array<{ driverId: string; selection: DispatchAllocationSelection }> {
  return drivers
    .map(driver => ({ driverId: driver.driverId, selection: selections[driver.driverId] || emptyDispatchSelection() }))
    .filter(item => Boolean(item.selection.runId));
}

export function rowFailures(failures: DispatchLockFailure[], driverId: string): DispatchLockFailure[] {
  return failures.filter(failure => failure.driverId === driverId);
}

export function globalFailures(failures: DispatchLockFailure[], driverIds: Set<string>): DispatchLockFailure[] {
  return failures.filter(failure => !failure.driverId || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(failure.driverId) || !driverIds.has(failure.driverId));
}
