import { describe, expect, it } from "vitest";
import { inferredPlanningWindow, matchesPlanningDate, planningDates, runsOvernight } from "./orderReviewDates";

describe("Order Review planning dates", () => {
  it("includes an order that only has a delivery date in the same queue date used by the bubbles", () => {
    const order = { deliveryDate: "2026-09-14" };

    expect(planningDates(order)).toEqual(["2026-09-13", "2026-09-14"]);
    expect(matchesPlanningDate(order, "2026-09-14")).toBe(true);
  });

  it("does not double-count an order when collection and delivery are on the same day", () => {
    const order = { collectionDate: "2026-09-14", deliveryDate: "2026-09-14" };

    expect(planningDates(order)).toEqual(["2026-09-14"]);
  });

  it("places a cross-date order on the PM collection-date board only", () => {
    const order = {
      collectionDate: "2026-09-15",
      deliveryDate: "2026-09-16",
      sellerName: "Hall Hunter",
      stallNumber: "Leyland",
    };

    expect(inferredPlanningWindow(order)).toBe("PM");
    expect(runsOvernight(order)).toBe(true);
    expect(planningDates(order)).toEqual(["2026-09-15"]);
    expect(matchesPlanningDate(order, "2026-09-15")).toBe(true);
    expect(matchesPlanningDate(order, "2026-09-16")).toBe(false);
  });

  it("treats Barefoots PM as a PM route pattern", () => {
    const order = {
      collectionDate: "2026-09-15",
      deliveryDate: "2026-09-16",
      customerCode: "Barefoots",
      requestedTime: "PM load",
    };

    expect(inferredPlanningWindow(order)).toBe("PM");
    expect(runsOvernight(order)).toBe(true);
    expect(planningDates(order)).toEqual(["2026-09-15"]);
  });

  it("treats markets as market planning work", () => {
    const order = {
      collectionDate: "2026-09-15",
      deliveryDate: "2026-09-16",
      marketName: "Covent Garden Market",
    };

    expect(inferredPlanningWindow(order)).toBe("Market");
    expect(planningDates(order)).toEqual(["2026-09-15"]);
  });
});
