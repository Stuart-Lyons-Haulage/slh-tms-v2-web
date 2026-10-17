export type TvTimingRecord = {
  loadId: string;
  completed: boolean;
  finalEtaUtc?: string;
  finalEtaSource?: string;
};

export type TvTimingResponse = {
  planningDate: string;
  geofenceAvailable: boolean;
  records: TvTimingRecord[];
};

type TvTimingRun = {
  id: string;
  finalStop?: string;
  etaTarget?: string;
  etaUtc?: string;
  etaSource: string;
  state: string;
  [key: string]: unknown;
};

function displayEtaSource(source?: string) {
  if (source === "Geofence") return "Live";
  if (source === "GeofenceEstimated") return "Estimated";
  return source;
}

function hasUsefulEta(run?: TvTimingRun) {
  if (!run?.etaUtc) return false;
  const source = String(run.etaSource || "").toLowerCase();
  return source === "live" || source === "estimated" || source === "arrived" || source === "geofence" || source === "geofenceestimated";
}

export function retainLastUsefulTvEtas<T extends TvTimingRun>(current: T[], previous: T[]): T[] {
  const previousById = new Map(previous.map(run => [run.id, run]));
  return current.map(run => {
    if (run.state === "ARRIVED" || run.etaSource === "Arrived" || hasUsefulEta(run)) return run;
    const prior = previousById.get(run.id);
    if (!prior || !hasUsefulEta(prior)) return run;
    return {
      ...run,
      etaUtc: prior.etaUtc,
      etaSource: prior.etaSource,
      etaTarget: prior.etaTarget || run.etaTarget,
    };
  });
}

export function mergeAuthoritativeFinalTiming<T extends TvTimingRun>(runs: T[], timing?: TvTimingResponse): T[] {
  if (!timing?.geofenceAvailable || !Array.isArray(timing.records)) return runs;
  const byLoad = new Map(timing.records.map(record => [record.loadId, record]));

  return runs.map(run => {
    if (run.state === "ARRIVED" || run.etaSource === "Arrived") return run;
    const record = byLoad.get(run.id);
    if (!record || record.completed || !record.finalEtaUtc) return run;
    return {
      ...run,
      etaUtc: record.finalEtaUtc,
      etaSource: displayEtaSource(record.finalEtaSource) || run.etaSource,
      etaTarget: run.finalStop || run.etaTarget,
    };
  });
}
