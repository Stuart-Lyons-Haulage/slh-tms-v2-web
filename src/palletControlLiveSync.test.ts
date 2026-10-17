import { describe, expect, it } from "vitest";
import palletControl from "./pages/PalletPlanningControl.tsx?raw";

describe("Pallet Control live sync", () => {
  it("uses the shared planning change bus for immediate refresh", () => {
    expect(palletControl).toContain('import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";');
    expect(palletControl).toContain("subscribePlanningChanges");
    expect(palletControl).toContain("refreshControl(); void refreshRegions()");
    expect(palletControl).toContain("signalPlanningChange();");
    expect(palletControl).not.toContain('const PLANNING_CHANNEL = "slh-planning-control"');
    expect(palletControl).not.toContain('const PLANNING_STORAGE_KEY = "slh:planning-control-changed"');
  });

  it("uses event-driven refresh with only a thirty-second reconciliation safety net", () => {
    expect(palletControl).toContain("startVisiblePolling");
    expect(palletControl).toContain("30_000");
    expect(palletControl).not.toContain("2000");
    expect(palletControl).not.toContain("2_000");
    expect(palletControl).toContain("await Promise.allSettled([refreshControl(), refreshRegions()])");
    expect(palletControl).toContain('onClick={() => { void refreshControl(); void refreshRegions(); }}');
  });
});
