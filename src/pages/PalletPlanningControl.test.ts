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
