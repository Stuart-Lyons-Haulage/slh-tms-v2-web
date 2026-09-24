import { describe, expect, it } from "vitest";
import { planningDeliveryLocation } from "./planningLocations";

describe("planning location presentation", () => {
  it("prefers the API original delivery site over a legacy combined lane", () => {
    expect(planningDeliveryLocation({
      collection: "Summer Berry",
      destination: "Summer Berry → Leyland",
      originalDestination: "Leyland",
    })).toBe("Leyland");
  });

  it("strips the collection prefix from legacy combined delivery values", () => {
    expect(planningDeliveryLocation({
      collection: "Summer Berry",
      destination: "Summer Berry → Leyland",
    })).toBe("Leyland");
  });

  it("leaves a normal delivery site unchanged", () => {
    expect(planningDeliveryLocation({
      collection: "Summer Berry",
      destination: "Leyland",
    })).toBe("Leyland");
  });
});
