import { describe, expect, it } from "vitest";
import { filterDispatchAssetOptions } from "./dispatchAssetSearch";

describe("Dispatch asset search", () => {
  it("matches a registration suffix such as VDD", () => {
    const options = [
      { id: "one", label: "AB12VDD", search: "AB12VDD" },
      { id: "two", label: "VDD123", search: "VDD123" },
      { id: "three", label: "XY99ABC", search: "XY99ABC" },
    ];

    expect(filterDispatchAssetOptions(options, "VDD").map(option => option.id)).toEqual(["one", "two"]);
  });

  it("also searches trailer type and preserves the original order for equal matches", () => {
    const options = [
      { id: "one", label: "TRL001 · Refrigerated", search: "TRL001 Refrigerated" },
      { id: "two", label: "TRL002 · Standard", search: "TRL002 Standard" },
    ];

    expect(filterDispatchAssetOptions(options, "refrigerated").map(option => option.id)).toEqual(["one"]);
  });
});
