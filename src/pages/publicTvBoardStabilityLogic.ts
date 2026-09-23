export type TvRun = {
  id?: string;
  etaUtc?: string;
  etaSource?: string;
  state?: string;
  stateDetail?: string;
  finalStop?: string;
  nextStop?: string;
  siteArrivalUtc?: string;
  dwellState?: string;
  liveDwellMinutes?: number;
  liveDwellSeconds?: number;
  priority?: number;
  [key: string]: unknown;
};
export type CachedRun = { run: TvRun; seenAt: number };

const ETA_RETENTION_MS = 5 * 60 * 1000;

function hasUsefulEta(run: TvRun) {
  if (!run.etaUtc) return false;
  const source = String(run.etaSource || "").toLowerCase();
  return source === "live" || source === "estimated" || source === "geofence" || source === "geofenceestimated" || source === "planned" || source === "arrived";
}

function isFinalOnSite(run: TvRun) {
  return run.dwellState === "OnSite" && Boolean(run.siteArrivalUtc) && Boolean(run.finalStop) && run.nextStop === run.finalStop;
}

export function stabiliseTvRuns(current: TvRun[], cache: Map<string, CachedRun>, now = Date.now()) {
  const currentIds = new Set(current.map(run => run.id).filter((id): id is string => Boolean(id)));
  for (const key of [...cache.keys()]) if (!currentIds.has(key)) cache.delete(key);

  return current.map(run => {
    if (!run.id) return run;
    const previous = cache.get(run.id);
    let stable = run;
    if (!hasUsefulEta(run) && previous && now - previous.seenAt <= ETA_RETENTION_MS && hasUsefulEta(previous.run)) {
      stable = { ...run, etaUtc: previous.run.etaUtc, etaSource: previous.run.etaSource };
    }
    if (isFinalOnSite(stable)) {
      stable = {
        ...stable,
        state: "ARRIVED",
        stateDetail: `${stable.finalStop || "Final destination"} · final destination reached`,
        etaUtc: stable.siteArrivalUtc,
        etaSource: "Arrived",
        dwellState: "EnRoute",
        liveDwellMinutes: undefined,
        liveDwellSeconds: undefined,
        priority: Math.min(Number(stable.priority ?? 70), 70),
      };
    }
    cache.set(run.id, { run: stable, seenAt: hasUsefulEta(stable) ? now : previous?.seenAt ?? now });
    return stable;
  });
}
