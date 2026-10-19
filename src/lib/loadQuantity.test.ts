import { describe, expect, it } from "vitest";
import { describeQuantity, quantityLabel } from "./loadQuantity";

describe("describeQuantity", () => {
  it("shows pallets with the tray count when both are known", () => {
    expect(quantityLabel({ pallets: 33, unitCount: 8316, unitCountType: "Trays" })).toBe("33 plt · 8,316 trays");
  });
  it("shows the tray or crate count, not 0 pallets, when spaces aren't stated", () => {
    const value = describeQuantity({ pallets: 0, unitCount: 600, unitCountType: "Crates" });
    expect(value.main).toBe("600 crates");
    expect(value.detail).toBe("pallet spaces not stated");
    expect(value.palletsStated).toBe(false);
  });
  it("says pallets of trays when only pallets are known for a tray job", () => {
    expect(quantityLabel({ pallets: 26, loadUnitType: "Trays" })).toBe("26 plt · pallets of trays");
  });
  it("never shows 0 when nothing was given", () => {
    expect(describeQuantity({ pallets: 0, loadUnitType: "Crates" }).main).toBe("Count not stated");
  });
});
