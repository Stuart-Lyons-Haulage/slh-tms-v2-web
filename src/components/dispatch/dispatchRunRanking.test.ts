import { describe, expect, it } from "vitest";
import { rankDriversForRun } from "./dispatchRunRanking";
import type { DispatchDriverDto, DispatchRunDto } from "./types";

const run = (overrides: Partial<DispatchRunDto> = {}): DispatchRunDto => ({
  runId: "run-1",
  reference: "AM 1",
  collectionPoint: { name: "Aylesford", latitude: 51.3, longitude: 0.45 },
  requiredSkills: "",
  requiresDoubleDeck: false,
  requiresRefrigerated: false,
  isBackload: false,
  isOvernightMarket: false,
  isSouthbound: false,
  ...overrides
});

const driver = (id: string, name: string, overrides: Partial<DispatchDriverDto> = {}): DispatchDriverDto => ({
  driverId: id,
  driverCode: id,
  name,
  employmentType: "Employed",
  skills: "",
  holidayDates: [],
  contractedDays: [],
  tachoData: {
    currentDutyDay: 1,
    weeklyWorkingTime: 10,
    dailyDrivingTime: 2,
    breakCompliance: true,
    requiredRestPeriod: 11,
    reducedDailyRestsUsed: 0,
    reducedDailyRestAvailable: true
  },
  trackingData: { lastKnownPosition: { latitude: 51.3, longitude: 0.45 } },
  needsReturn: false,
  isBlocked: false,
  backloadCandidate: false,
  ...overrides
});

describe("rankDriversForRun", () => {
  it("ranks an eligible nearby driver above a more distant driver", () => {
    const result = rankDriversForRun(run(), [
      driver("far", "Far Driver", { trackingData: { lastKnownPosition: { latitude: 52.3, longitude: 0.45 } } }),
      driver("near", "Near Driver")
    ], {});

    expect(result.map(item => item.driver.driverId)).toEqual(["near", "far"]);
    expect(result[0].reasons).toContain("0.0mi to collection");
  });

  it("excludes blocked drivers and respects specialist skills", () => {
    const result = rankDriversForRun(run({ requiredSkills: "DoubleDecker" }), [
      driver("blocked", "Blocked", { isBlocked: true }),
      driver("untrained", "Untrained"),
      driver("trained", "Trained", { skills: "DoubleDecker" })
    ], {});

    expect(result.map(item => item.driver.driverId)).toEqual(["trained"]);
    expect(result[0].reasons).toContain("Required skills matched");
  });

  it("prioritises a return-compatible backload", () => {
    const result = rankDriversForRun(run({ isBackload: true, isSouthbound: true }), [
      driver("local", "Local"),
      driver("return", "Return Driver", { needsReturn: true })
    ], {});

    expect(result[0].driver.driverId).toBe("return");
    expect(result[0].reasons).toContain("Supports return/backload positioning");
  });

  it("penalises a driver whose available time is after the collection", () => {
    const collectionTime = "2026-10-20T06:00:00Z";
    const availableTimes = {
      "early": { driverId: "early", availableFrom: "2026-10-20T04:00:00Z", requiredRestPeriod: 11, weeklyWorkingTimeUsed: 10, dailyDrivingTimeUsed: 2, wtdStatus: "ok" as const },
      "late": { driverId: "late", availableFrom: "2026-10-20T10:00:00Z", requiredRestPeriod: 11, weeklyWorkingTimeUsed: 10, dailyDrivingTimeUsed: 2, wtdStatus: "ok" as const }
    };
    const result = rankDriversForRun(
      run({ firstCollectionTimeUtc: collectionTime }),
      [driver("late", "Late Driver"), driver("early", "Early Driver")],
      {},
      availableTimes
    );

    expect(result[0].driver.driverId).toBe("early");
    expect(result[0].timeEligible).toBe(true);
    expect(result[1].driver.driverId).toBe("late");
    expect(result[1].timeEligible).toBe(false);
    expect(result[1].score).toBeLessThan(result[0].score);
  });
});
