import { describe, expect, it } from "vitest";
import planner from "./pages/RunPlannerLive.tsx?raw";

describe("Run Planner autosave", () => {
  it("creates a persisted run when a collection and delivery resolve to live work", () => {
    expect(planner).toContain("void createPlanningRun({ ...currentRun, lines: linkedLines });");
    expect(planner).toContain("void createPlanningRun({ ...currentRun, lines: nextLines });");
    expect(planner).toContain("const confirmed = (await listRuns(date, access)).find((item) => item.id === created.id);");
    expect(planner).toContain("signalPlanningChange();");
  });
});
