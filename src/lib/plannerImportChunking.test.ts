import { describe, expect, it, vi } from "vitest";
import { importPlannerPlanInChunks } from "./plannerImportChunking";

describe("importPlannerPlanInChunks", () => {
  it("splits a larger plan into bounded requests and aggregates summaries", async () => {
    const payload = {
      schema: "slh-planner-v1",
      planningDate: "2026-08-27",
      runs: Array.from({ length: 23 }, (_, index) => ({ runRef: `R${index + 1}`, includeInImport: true })),
    };
    const sendBatch = vi.fn(async (batch: typeof payload) => ({
      planningDate: batch.planningDate,
      received: batch.runs.length,
      created: batch.runs.length,
      updated: 0,
      unchanged: 0,
      held: 0,
      warnings: [],
      unresolvedDrivers: [],
      unresolvedVehicles: [],
      unresolvedTrailers: [],
      runs: batch.runs.map((run) => ({ runRef: run.runRef, tmsReference: run.runRef, outcome: "ImportedPlanned", capacityStatus: "Green", utilisationPercent: 50 })),
    }));

    const result = await importPlannerPlanInChunks(payload, sendBatch, 10);

    expect(sendBatch).toHaveBeenCalledTimes(3);
    expect(sendBatch.mock.calls.map(([batch]) => batch.runs.length)).toEqual([10, 10, 3]);
    expect(result.received).toBe(23);
    expect(result.created).toBe(23);
    expect(result.runs).toHaveLength(23);
  });
});
