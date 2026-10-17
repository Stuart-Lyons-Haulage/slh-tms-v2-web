import { describe, expect, it } from "vitest";
import { canDriverTakeRun, missingSkills, parseSkillFlags, tachoVehicleId, trailerEligible, wtdClass } from "./dispatchRules";
import type { DispatchDriverDto, DispatchRunDto } from "./types";

function driver(overrides: Partial<DispatchDriverDto> = {}): DispatchDriverDto {
  return {
    driverId: "driver-1",
    driverCode: "SLH001",
    name: "Test Driver",
    employmentType: "Employed",
    skills: "DoubleDecker,MarketRun",
    holidayDates: [],
    contractedDays: [],
    tachoData: {
      currentDutyDay: 2,
      weeklyWorkingTime: 22,
      dailyDrivingTime: 3,
      breakCompliance: true,
      lastVehicleRegistration: "AB12 CDE",
      requiredRestPeriod: 11,
      reducedDailyRestsUsed: 0
    },
    trackingData: {},
    needsReturn: false,
    isBlocked: false,
    backloadCandidate: false,
    ...overrides
  };
}

function run(overrides: Partial<DispatchRunDto> = {}): DispatchRunDto {
  return {
    runId: "run-1",
    reference: "Run 1",
    collectionPoint: { name: "Barnham" },
    requiredSkills: "MarketRun",
    requiresDoubleDeck: false,
    requiresRefrigerated: false,
    isBackload: false,
    isOvernightMarket: false,
    isSouthbound: false,
    ...overrides
  };
}

describe("smart Dispatch rules", () => {
  it("skill-gates runs and identifies the exact missing skills", () => {
    const restricted = run({ requiredSkills: "MarketRun,HazChem" });
    expect(canDriverTakeRun(driver(), restricted)).toBe(false);
    expect(missingSkills(driver(), restricted)).toEqual(["HazChem"]);
    expect(canDriverTakeRun(driver({ skills: "MarketRun,HazChem" }), restricted)).toBe(true);
  });

  it("parses the string form produced by flags-enum JSON", () => {
    expect([...parseSkillFlags("DoubleDecker, MarketRun, RefrigeratedUnit")]).toEqual([
      "DoubleDecker",
      "MarketRun",
      "RefrigeratedUnit"
    ]);
  });

  it("matches the driver's last Tacho vehicle after registration normalisation", () => {
    expect(tachoVehicleId(driver(), [
      { id: "other", registration: "XY99 ZZZ" },
      { id: "tacho", registration: "AB12CDE" }
    ])).toBe("tacho");
  });

  it("filters trailers by double-deck and refrigeration requirements", () => {
    const specialist = run({ requiresDoubleDeck: true, requiresRefrigerated: true });
    expect(trailerEligible(specialist, { id: "1", trailerNumber: "SLH1", type: "Double deck refrigerated" })).toBe(true);
    expect(trailerEligible(specialist, { id: "2", trailerNumber: "SLH2", type: "Double deck curtainsider" })).toBe(false);
  });

  it("uses the required WTD visual thresholds", () => {
    expect(wtdClass(39.9)).toBe("ok");
    expect(wtdClass(40)).toBe("amber");
    expect(wtdClass(47.9)).toBe("amber");
    expect(wtdClass(48)).toBe("red");
  });
});
