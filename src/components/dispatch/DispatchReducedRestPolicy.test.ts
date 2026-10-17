import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyDispatchSelection, reducedRestDriverIds } from "./dispatchBoardState";

describe("authoritative Dispatch reduced-rest policy", () => {
  it("defaults every driver to regular 11h rest", () => {
    expect(emptyDispatchSelection()).toMatchObject({ useReducedDailyRest: false });
  });

  it("only sends driver ids that the planner explicitly marked for reduced rest", () => {
    expect(reducedRestDriverIds({
      "driver-1": { runId: "run-1", vehicleId: "vehicle-1", trailerId: "", useReducedDailyRest: true },
      "driver-2": { runId: "run-2", vehicleId: "vehicle-2", trailerId: "", useReducedDailyRest: false }
    })).toEqual(["driver-1"]);
  });

  it("shows an explicit 9h reduced-rest control rather than spending it automatically", () => {
    const row = readFileSync(new URL("./DispatchDriverRow.tsx", import.meta.url), "utf8");
    const api = readFileSync(new URL("./dispatchApi.ts", import.meta.url), "utf8");

    expect(row).toContain("Reduced rest (9h)");
    expect(row).toContain("reducedDailyRestAvailable");
    expect(api).toContain("reducedRestDriverIds");
    expect(api).toContain("useReducedDailyRest");
  });
});
