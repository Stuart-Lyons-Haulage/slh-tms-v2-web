import { describe, expect, it } from "vitest";
import { availabilityDayCount } from "./availabilityDayCount";
import type { DriverAvailabilityItem } from "./types";

function availability(overrides: Partial<DriverAvailabilityItem> = {}): DriverAvailabilityItem {
  return {
    driverId: "agency-1",
    employeeNumber: "A1",
    displayName: "Agency Driver",
    employmentType: "Agency",
    group: "Agency confirmed",
    dispatchable: true,
    blockReasons: [],
    classificationMismatch: false,
    availabilityConfirmed: true,
    longTermPlacement: true,
    currentAllocationCount: 0,
    ...overrides
  };
}

describe("availabilityDayCount", () => {
  it("uses the current week's Sage staffing pattern for long-term agency cover", () => {
    expect(availabilityDayCount(availability({
      availableFromUtc: "2026-10-05T06:00:00Z",
      placementEndDate: "2026-10-31",
      usualDays: "Mon-Fri"
    }), "2026-10-07")).toBe(5);
  });

  it("uses the confirmed one-off agency window as one available day", () => {
    expect(availabilityDayCount(availability({
      longTermPlacement: false,
      availableFromUtc: "2026-10-09T05:00:00Z",
      availableUntilUtc: "2026-10-10T00:00:00Z"
    }), "2026-10-09")).toBe(1);
  });

  it("leaves employed-driver denominators to Sage contracted days", () => {
    expect(availabilityDayCount(availability({ employmentType: "Employed" }), "2026-10-09")).toBeUndefined();
  });
});
