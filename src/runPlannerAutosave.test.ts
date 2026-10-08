import { describe, expect, it } from "vitest";
import planner from "./pages/RunPlannerLive.tsx?raw";

describe("Run Planner autosave", () => {
  it("creates a persisted run when a collection and delivery resolve to live work", () => {
    expect(planner).toContain("void createPlanningRun({ ...currentRun, lines: linkedLines });");
    expect(planner).toContain("void createPlanningRun({ ...currentRun, lines: nextLines });");
    expect(planner).toContain("const confirmed = (await listRuns(date, access)).find((item) => item.id === created.id);");
    expect(planner).toContain("Run creation establishes the operational shell only");
    expect(planner).not.toContain("await Promise.all(allocationWrites);");
    expect(planner).toContain("signalPlanningChange();");
  });

  it("does not mark a linked job unmatched after its remaining quantity reaches zero", () => {
    expect(planner).toContain("matchingLiveOrders(line.collectionSite, line.deliverySite)");
    expect(planner).toContain("lineOrderIds(line).length || matches.length");
    expect(planner).toContain("Linked to ${lineOrderIds(line).length} live order");
    expect(planner).toContain("line.collectionSite.trim() && line.deliverySite.trim()");
  });
});
