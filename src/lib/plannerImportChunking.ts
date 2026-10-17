export type PlannerImportRunResult = {
  runRef: string;
  tmsReference: string;
  outcome: string;
  capacityStatus: string;
  utilisationPercent: number;
  detail?: string;
};

export type PlannerImportSummary = {
  planningDate: string;
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  held: number;
  warnings: string[];
  unresolvedDrivers: string[];
  unresolvedVehicles: string[];
  unresolvedTrailers: string[];
  runs: PlannerImportRunResult[];
};

type PlannerPayload<TRun> = {
  planningDate?: string;
  runs: TRun[];
  [key: string]: unknown;
};

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export async function importPlannerPlanInChunks<TRun, TPayload extends PlannerPayload<TRun>>(
  payload: TPayload,
  sendBatch: (batch: TPayload) => Promise<PlannerImportSummary>,
  chunkSize = 10,
  onProgress?: (completed: number, total: number) => void,
): Promise<PlannerImportSummary> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("Planner import chunk size must be at least 1.");
  const planningDate = payload.planningDate || "";
  const aggregate: PlannerImportSummary = {
    planningDate,
    received: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    held: 0,
    warnings: [],
    unresolvedDrivers: [],
    unresolvedVehicles: [],
    unresolvedTrailers: [],
    runs: [],
  };

  for (let offset = 0; offset < payload.runs.length; offset += chunkSize) {
    const runs = payload.runs.slice(offset, offset + chunkSize);
    const result = await sendBatch({ ...payload, runs } as TPayload);
    aggregate.received += result.received;
    aggregate.created += result.created;
    aggregate.updated += result.updated;
    aggregate.unchanged += result.unchanged;
    aggregate.held += result.held;
    aggregate.warnings.push(...result.warnings);
    aggregate.unresolvedDrivers.push(...result.unresolvedDrivers);
    aggregate.unresolvedVehicles.push(...result.unresolvedVehicles);
    aggregate.unresolvedTrailers.push(...result.unresolvedTrailers);
    aggregate.runs.push(...result.runs);
    onProgress?.(Math.min(offset + runs.length, payload.runs.length), payload.runs.length);
  }

  aggregate.warnings = unique(aggregate.warnings);
  aggregate.unresolvedDrivers = unique(aggregate.unresolvedDrivers);
  aggregate.unresolvedVehicles = unique(aggregate.unresolvedVehicles);
  aggregate.unresolvedTrailers = unique(aggregate.unresolvedTrailers);
  return aggregate;
}
