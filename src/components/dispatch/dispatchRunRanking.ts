import { canDriverTakeRun, dispatchSkills, missingSkills } from "./dispatchRules";
import type { DispatchDriverDto, DispatchRunDto } from "./types";

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

export type RunDriverMatch = { driver: DispatchDriverDto; score: number; distance?: number; reasons: string[] };

export function rankDriversForRun(run: DispatchRunDto, drivers: DispatchDriverDto[], owners: Record<string, string | undefined>): RunDriverMatch[] {
  return drivers
    .filter(driver => !owners[run.runId] || owners[run.runId] === driver.driverId)
    .filter(driver => canDriverTakeRun(driver, run))
    .map(driver => {
      const distance = driverRunDistanceMiles(driver, run);
      const missing = missingSkills(driver, run);
      const score = Math.min(100,
        (distance == null ? 12 : Math.max(0, Math.round(45 - distance * 0.65))) +
        (missing.length === 0 ? (run.requiredSkills ? 25 : 15) : 0) +
        (driver.needsReturn && (run.isBackload || run.isSouthbound) ? 25 : !driver.needsReturn && !run.isBackload ? 10 : 0) +
        (driver.tachoData.breakCompliance ? 10 : 0));
      const reasons = [
        distance == null ? "Live distance unavailable" : `${distance.toFixed(1)}mi to collection`,
        missing.length === 0 ? (run.requiredSkills ? "Required skills matched" : "No specialist skills required") : `Missing ${missing.map(skill => dispatchSkills.find(item => item.skill === skill)?.label || skill).join(", ")}`,
        driver.needsReturn && (run.isBackload || run.isSouthbound) ? "Supports return/backload positioning" : "Available for normal route work",
        driver.tachoData.breakCompliance ? "Tacho break status clear" : "Tacho break status needs review"
      ];
      return { driver, score, distance, reasons };
    })
    .sort((left, right) => right.score - left.score || (left.distance ?? Number.POSITIVE_INFINITY) - (right.distance ?? Number.POSITIVE_INFINITY) || left.driver.name.localeCompare(right.driver.name));
}
