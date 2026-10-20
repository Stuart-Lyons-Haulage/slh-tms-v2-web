import { canDriverTakeRun, dispatchSkills, missingSkills } from "./dispatchRules";
import type { DispatchAvailableTimeDto, DispatchDriverDto, DispatchRunDto } from "./types";
import { fairnessAdjustment, workingStyleFit } from "./dispatchRunFit";

export function driverRunDistanceMiles(driver: DispatchDriverDto, run: DispatchRunDto): number | undefined {
  const point = driver.trackingData.lastKnownPosition;
  const target = run.collectionPoint;
  if (!point || target.latitude == null || target.longitude == null) return undefined;
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = radians(target.latitude - point.latitude);
  const dLon = radians(target.longitude - point.longitude);
  const lat1 = radians(point.latitude);
  const lat2 = radians(target.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type TimeEligibility = { eligible: boolean; marginMinutes?: number; reason: string };

function timeEligibility(
  driver: DispatchDriverDto,
  run: DispatchRunDto,
  availableTime?: DispatchAvailableTimeDto
): TimeEligibility {
  if (!run.firstCollectionTimeUtc) return { eligible: true, reason: "Collection time not set" };
  if (!availableTime?.availableFrom) return { eligible: true, reason: "Tacho start time pending" };
  if (availableTime.breachDetail) return { eligible: false, reason: availableTime.breachDetail };

  const collectionMs = Date.parse(run.firstCollectionTimeUtc);
  const availableMs = Date.parse(availableTime.availableFrom);
  if (Number.isNaN(collectionMs) || Number.isNaN(availableMs)) return { eligible: true, reason: "Time comparison unavailable" };

  const marginMinutes = Math.round((collectionMs - availableMs) / 60_000);
  if (marginMinutes >= 0) {
    const hours = Math.floor(marginMinutes / 60);
    const mins = marginMinutes % 60;
    return { eligible: true, marginMinutes, reason: hours > 0 ? `Available ${hours}h${mins > 0 ? ` ${mins}m` : ""} before collection` : `Available ${mins}m before collection` };
  }
  const lateMinutes = -marginMinutes;
  const hours = Math.floor(lateMinutes / 60);
  const mins = lateMinutes % 60;
  return { eligible: false, marginMinutes, reason: hours > 0 ? `Unavailable until ${hours}h${mins > 0 ? ` ${mins}m` : ""} after collection` : `Unavailable until ${mins}m after collection` };
}

export type RunDriverMatch = { driver: DispatchDriverDto; score: number; distance?: number; timeEligible: boolean; marginMinutes?: number; reasons: string[] };

export function rankDriversForRun(
  run: DispatchRunDto,
  drivers: DispatchDriverDto[],
  owners: Record<string, string | undefined>,
  availableTimes?: Record<string, DispatchAvailableTimeDto>
): RunDriverMatch[] {
  return drivers
    .filter(driver => !owners[run.runId] || owners[run.runId] === driver.driverId)
    .filter(driver => canDriverTakeRun(driver, run))
    .map(driver => {
      const distance = driverRunDistanceMiles(driver, run);
      const missing = missingSkills(driver, run);
      const fit = workingStyleFit(driver, run);
      const fairness = fairnessAdjustment(driver, run);
      const timing = timeEligibility(driver, run, availableTimes?.[driver.driverId]);
      const base = Math.min(100,
        (distance == null ? 12 : Math.max(0, Math.round(45 - distance * 0.65))) +
        (missing.length === 0 ? (run.requiredSkills ? 25 : 15) : 0) +
        (driver.needsReturn && (run.isBackload || run.isSouthbound) ? 25 : !driver.needsReturn && !run.isBackload ? 10 : 0) +
        (driver.tachoData.breakCompliance ? 10 : 0));
      const timeScore = timing.eligible ? (timing.marginMinutes != null && timing.marginMinutes >= 60 ? 10 : 5) : -40;
      const score = fit.ok ? Math.max(0, Math.min(100, base + fairness.score + timeScore)) : 0;
      const reasons = [
        ...(fit.ok ? [] : [fit.reason || "Driver type does not suit this run"]),
        ...(fit.warning ? [fit.warning] : []),
        ...(fairness.reason ? [fairness.reason] : []),
        timing.reason,
        distance == null ? "Live distance unavailable" : `${distance.toFixed(1)}mi to collection`,
        missing.length === 0 ? (run.requiredSkills ? "Required skills matched" : "No specialist skills required") : `Missing ${missing.map(skill => dispatchSkills.find(item => item.skill === skill)?.label || skill).join(", ")}`,
        driver.needsReturn && (run.isBackload || run.isSouthbound) ? "Supports return/backload positioning" : "Available for normal route work",
        driver.tachoData.breakCompliance ? "Tacho break status clear" : "Tacho break status needs review"
      ];
      return { driver, score, distance, timeEligible: timing.eligible, marginMinutes: timing.marginMinutes, reasons };
    })
    .sort((left, right) => right.score - left.score || (left.distance ?? Number.POSITIVE_INFINITY) - (right.distance ?? Number.POSITIVE_INFINITY) || left.driver.name.localeCompare(right.driver.name));
}
