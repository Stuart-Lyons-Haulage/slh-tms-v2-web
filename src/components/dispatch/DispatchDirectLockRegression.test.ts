import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DispatchBoard.tsx", import.meta.url), "utf8");

describe("direct Dispatch allocation preparation", () => {
  it("recalculates Tacho time and allocates without using the planner lock", () => {
    expect(source).toContain("availableTimes[driver.driverId]?.requiredRestPeriod !== (effectiveSelection.useReducedDailyRest ? 9 : 11)");
    expect(source).toContain("getAvailableTimes(");
    expect(source).toContain("allocateDispatchRun(effectiveSelection.runId, driver.driverId, effectiveSelection, access)");
    expect(source).not.toContain("lockDispatchPlan(");
  });
});
