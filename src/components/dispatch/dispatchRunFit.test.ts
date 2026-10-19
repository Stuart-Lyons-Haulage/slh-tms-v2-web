import { describe, expect, it } from "vitest";
import { fairnessAdjustment, runMetrics, sortRunsForDispatch, workingStyleFit } from "./dispatchRunFit";
import type { DispatchDriverDto, DispatchRunDto } from "./types";

const run = (patch: Partial<DispatchRunDto>): DispatchRunDto => ({
  runId: patch.reference || "r", reference: "r", collectionPoint: { name: "Barfoots" }, requiredSkills: "",
  requiresDoubleDeck: false, requiresRefrigerated: false, isBackload: false, isOvernightMarket: false, isSouthbound: false, ...patch
});
const driver = (patch: Partial<DispatchDriverDto>): DispatchDriverDto => ({
  driverId: "d", driverCode: "d", name: "Driver", employmentType: "Employed", skills: "", holidayDates: [], contractedDays: [],
  tachoData: { currentDutyDay: 1, weeklyWorkingTime: 0, dailyDrivingTime: 0, breakCompliance: true, requiredRestPeriod: 11, reducedDailyRestsUsed: 0 },
  trackingData: {}, needsReturn: false, isBlocked: false, backloadCandidate: false, ...patch
});

describe("dispatch run fit", () => {
  it("measures a long northern run as needing a night out", () => {
    const metrics = runMetrics({
      id: "1", plannedStartUtc: "2026-10-19T03:00:00Z",
      stops: [
        { id: "a", sequence: 1, name: "Collect · Barfoots", latitude: 50.80, longitude: -0.70, plannedArrivalUtc: "2026-10-19T03:30:00Z" },
        { id: "b", sequence: 2, name: "Deliver · Aldi Goldthorpe", latitude: 53.53, longitude: -1.31, plannedArrivalUtc: "2026-10-19T10:30:00Z" },
        { id: "c", sequence: 3, name: "Deliver · Aldi Darlington", latitude: 54.52, longitude: -1.55, plannedArrivalUtc: "2026-10-19T13:30:00Z" }
      ]
    } as never);
    expect(metrics.furthestMiles).toBeGreaterThan(250);
    expect(metrics.needsNightOut).toBe(true);
  });

  it("orders the furthest runs first", () => {
    const sorted = sortRunsForDispatch([run({ reference: "local", furthestMiles: 20 }), run({ reference: "north", furthestMiles: 260 }), run({ reference: "mid", furthestMiles: 120 })]);
    expect(sorted.map(item => item.reference)).toEqual(["north", "mid", "local"]);
  });

  it("only trampers take a night out; day drivers do not take night runs", () => {
    const nightOut = run({ needsNightOut: true, spanHours: 18 });
    expect(workingStyleFit(driver({ workingStyle: "Tramper" }), nightOut).ok).toBe(true);
    expect(workingStyleFit(driver({ workingStyle: "Day" }), nightOut).ok).toBe(false);
    expect(workingStyleFit(driver({ workingStyle: "Day" }), run({ isNightRun: true })).ok).toBe(false);
    expect(workingStyleFit(driver({}), nightOut).warning).toContain("driver type not set");
  });

  it("rotates long work towards drivers who have had less of it", () => {
    const longRun = run({ furthestMiles: 220 });
    expect(fairnessAdjustment(driver({ recentLongRuns: 0 }), longRun).score).toBeGreaterThan(fairnessAdjustment(driver({ recentLongRuns: 3 }), longRun).score);
    expect(fairnessAdjustment(driver({ recentLongRuns: 3 }), run({ furthestMiles: 30 })).score).toBe(0);
  });
});
