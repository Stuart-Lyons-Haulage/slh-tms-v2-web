import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { planningCollectionGroup } from "./PalletPlanningControl";

describe("planningCollectionGroup", () => {
  it("uses the temperature-aware planning label while retaining the physical collection site", () => {
    expect(planningCollectionGroup({ collection: "Sefter South", planningGroup: "Sefter South +3°C" })).toBe("Sefter South +3°C");
    expect(planningCollectionGroup({ collection: "Sefter North", planningGroup: "Sefter North +10°C" })).toBe("Sefter North +10°C");
  });

  it("falls back to the collection site for older API responses", () => {
    expect(planningCollectionGroup({ collection: "Leythorne", planningGroup: undefined })).toBe("Leythorne");
  });
});

describe("SSE-gated refresh", () => {
  it("uses the /orders/changes endpoint to gate local/cross-tab refreshes", () => {
    const source = readFileSync(new URL("./PalletPlanningControl.tsx", import.meta.url), "utf8");
    // The local event handler must check /orders/changes before calling the heavy refreshControl()
    expect(source).toContain("orders/changes");
    expect(source).toContain("changes.changed");
    // The lastRefreshAtUtc ref must track the server timestamp from the latest /pallets response
    expect(source).toContain("lastRefreshAtUtc");
    expect(source).toContain("generatedAtUtc");
  });

  it("bypasses the changes gate for server-pushed SSE events", () => {
    const source = readFileSync(new URL("./PalletPlanningControl.tsx", import.meta.url), "utf8");
    // Server-pushed events (allocations, stop edits) must skip the orders/changes gate
    // and trigger an immediate full refresh — the server already knows something changed.
    expect(source).toContain("subscribeServerPlanningChanges");
    // The server handler calls fullRefresh directly, not checkThenRefresh
    expect(source).toContain("subscribeServerPlanningChanges(fullRefresh)");
  });
});
