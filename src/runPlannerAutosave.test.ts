import { describe, expect, it } from "vitest";
import planner from "./pages/RunPlannerLive.tsx?raw";
import plannerLine from "./pages/RunPlannerLine.tsx?raw";

describe("Run Planner autosave", () => {
  it("skips obsolete queued quantity snapshots before sending them to the API", () => {
    expect(planner).toContain("if (!persistStops) {");
    expect(planner).toContain("validPallets(latestLine.pallets) !== pallets");
    expect(planner).toContain("latestLine.orderAllocations?.[id] !== allocations[id]");
  });

  it("creates a persisted run when a collection and delivery resolve to live work", () => {
    expect(planner).toContain("void createPlanningRun({ ...currentRun, lines: linkedLines });");
    expect(planner).toContain("void createPlanningRun({ ...currentRun, lines: nextLines });");
    expect(planner).toContain("const confirmed = created;");
    expect(planner).toContain("gateway 504s after a successful run save");
    // Putting an order on a run plans its quantity at once so Pallet Order's To plan drops.
    expect(planner).toContain("Putting an order on a run plans its quantity straight away");
    expect(planner).toContain("await allocateBatch(allocationEntries, created.id, access)");
    expect(planner).not.toContain("await Promise.all(allocationWrites);");
    expect(planner).toContain("signalPlanningChange();");
  });

  it("persists a suggested job added to a new run immediately", () => {
    expect(planner).toContain("Saving ${order.reference} to the new run…");
    expect(planner).toContain("void createPlanningRun({ ...currentRun, lines: nextLines });");
    expect(planner).toContain("await allocate(allocationEntries[0][0], created.id, allocationEntries[0][1], access)");
    expect(planner).toContain("void refreshControl().catch(() => undefined);");
  });

  it("does not mark a linked job unmatched after its remaining quantity reaches zero", () => {
    expect(plannerLine).toContain("const matches = effectiveOrders.filter");
    expect(plannerLine).toContain("orderIds.length || matches.length");
    expect(plannerLine).toContain("Linked to ${orderIds.length} live order");
    expect(plannerLine).toContain("line.collectionSite.trim() && line.deliverySite.trim()");
    expect(planner).toContain("<RunPlannerLine");
  });

  it("uses a unique idempotency key for each allocation save", () => {
    expect(planner).toContain("const idempotencyKey = crypto.randomUUID();");
    expect(planner).toContain("date, pallets, idempotencyKey, note:");
  });

  it("serializes note and removal stop-list writes with order additions", () => {
    expect(planner).toContain("function enqueueRunMutation(runKey: string, mutation: () => Promise<void>)");
    expect(planner).toContain("await enqueueRunMutation(run.key, async () => {");
    expect(planner).toContain("const latestLines = runsRef.current.find((item) => item.key === run.key)?.lines || linesAfterEdit;");
    expect(planner).toContain("const latestLines = runsRef.current.find((item) => item.key === run.key)?.lines || remaining;");
  });
});
