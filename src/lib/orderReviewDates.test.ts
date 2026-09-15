import { describe, expect, it } from "vitest";
import { matchesPlanningDate, planningDates } from "./orderReviewDates";

describe("Order Review planning dates", () => {
  it("includes an order that only has a delivery date in the same queue date used by the bubbles", () => {
    const order = { deliveryDate: "2026-09-14" };

    expect(planningDates(order)).toEqual(["2026-09-14"]);
    expect(matchesPlanningDate(order, "2026-09-14")).toBe(true);
  });

  it("does not double-count an order when collection and delivery are on the same day", () => {
    const order = { collectionDate: "2026-09-14", deliveryDate: "2026-09-14" };

    expect(planningDates(order)).toEqual(["2026-09-14"]);
  });
});
