import type { DispatchDriverDto, DispatchRunDto, LegacyDispatchLoad } from "./types";

// SLH yard, Barnham.
const BASE = { latitude: 50.8312, longitude: -0.6375 };
export const LONG_RUN_MILES = 120;
// Road miles are ~1.25 x straight line; an HGV averages ~42 mph over a trip.
const ROAD_FACTOR = 1.25;
const AVERAGE_MPH = 42;
// Longest day that still allows a reduced 9h daily rest inside 24h.
const MAX_DAY_SPAN_HOURS = 15;

export function straightMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function londonHour(iso?: string) {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(date)) % 24;
}

/** How far, how long and when a run is, from its stops. */
export function runMetrics(load: LegacyDispatchLoad | undefined): Pick<DispatchRunDto, "furthestMiles" | "plannedStartUtc" | "plannedEndUtc" | "spanHours" | "needsNightOut" | "isNightRun"> {
  const stops = [...(load?.stops || [])].sort((left, right) => left.sequence - right.sequence);
  const located = stops.filter(stop => stop.latitude != null && stop.longitude != null) as Array<{ latitude: number; longitude: number; plannedArrivalUtc?: string }>;
  const furthestMiles = located.length ? Math.round(Math.max(...located.map(stop => straightMiles(BASE, stop)))) : undefined;
  const times = stops.map(stop => stop.plannedArrivalUtc).filter((value): value is string => Boolean(value)).sort();
  const plannedStartUtc = load?.plannedStartUtc || times[0];
  const lastStop = located.at(-1);
  const lastTime = times.at(-1);
  let spanHours: number | undefined;
  if (plannedStartUtc && lastTime) {
    const backDrive = lastStop ? straightMiles(lastStop, BASE) * ROAD_FACTOR / AVERAGE_MPH : 0;
    spanHours = Math.round(((Date.parse(lastTime) - Date.parse(plannedStartUtc)) / 3_600_000 + backDrive + 0.75) * 10) / 10;
  } else if (furthestMiles != null) {
    // No timings yet: out and back at average speed plus loading time.
    spanHours = Math.round((furthestMiles * 2 * ROAD_FACTOR / AVERAGE_MPH + 2.5) * 10) / 10;
  }
  const startHour = londonHour(plannedStartUtc);
  return {
    furthestMiles,
    plannedStartUtc,
    plannedEndUtc: lastTime,
    spanHours,
    needsNightOut: spanHours != null && spanHours > MAX_DAY_SPAN_HOURS,
    isNightRun: startHour != null && (startHour >= 17 || startHour < 2)
  };
}

/** Furthest first, then earliest start, so the long runs are covered before the local work. */
export function sortRunsForDispatch(runs: DispatchRunDto[]) {
  return [...runs].sort((left, right) =>
    (right.furthestMiles ?? -1) - (left.furthestMiles ?? -1) ||
    (left.plannedStartUtc || left.firstCollectionTimeUtc || "~").localeCompare(right.plannedStartUtc || right.firstCollectionTimeUtc || "~") ||
    left.reference.localeCompare(right.reference));
}

export type StyleFit = { ok: boolean; warning?: string; reason?: string };

/** Can this kind of driver do this run: trampers can night out; day and night drivers must get back within their shift. */
export function workingStyleFit(driver: DispatchDriverDto, run: DispatchRunDto): StyleFit {
  const style = driver.workingStyle;
  if (style === "Tramper" || style === "HalfTramper") return { ok: true };
  if (run.needsNightOut) {
    if (!style) return { ok: true, warning: "Run needs a night out; driver type not set on Driver Master" };
    return { ok: false, reason: `${style === "Night" ? "Night" : "Day"} driver: run needs a night out (~${run.spanHours}h)` };
  }
  if (style === "Day" && run.isNightRun) return { ok: false, reason: "Day driver: this is a night run" };
  if (style === "Night" && run.isNightRun === false && run.plannedStartUtc) return { ok: true, warning: "Night driver on a day run" };
  return { ok: true };
}

/** Fair share: for a long run, favour drivers who have had less long work in the last fortnight. */
export function fairnessAdjustment(driver: DispatchDriverDto, run: DispatchRunDto): { score: number; reason?: string } {
  if ((run.furthestMiles ?? 0) < LONG_RUN_MILES) return { score: 0 };
  const recent = driver.recentLongRuns ?? 0;
  if (recent === 0) return { score: 12, reason: "No long runs in the last 2 weeks" };
  return { score: -8 * recent, reason: `${recent} long run${recent === 1 ? "" : "s"} in the last 2 weeks` };
}
