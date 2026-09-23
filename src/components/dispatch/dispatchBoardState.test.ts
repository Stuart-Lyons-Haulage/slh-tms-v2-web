import { describe, expect, it } from "vitest";
import {
  applyAvailableTimes,
  availableTimesByDriver,
  buildInitialSelections,
  filterDriversByDriverSearch,
  filterDriversByEmploymentType,
  filterDispatchDrivers,
  sortDriversForDispatch,
  validateLockSelections
} from "./dispatchBoardState";
import type { DispatchDriverDto, DispatchEquipmentWorkbench, DispatchRunDto } from "./types";

function driver(overrides: Partial<DispatchDriverDto> = {}): DispatchDriverDto {
  return {
    driverId: "driver-1",
    driverCode: "SLH001",
    name: "Test Driver",
    employmentType: "Employed",
    skills: "MarketRun",
    holidayDates: [],
    contractedDays: [],
    tachoData: {
      currentDutyDay: 3,
      shiftEndTimeUtc: "2026-09-09T17:00:00Z",
      weeklyWorkingTime: 30,
      dailyDrivingTime: 5,
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

function equipment(overrides: Partial<DispatchEquipmentWorkbench> = {}): DispatchEquipmentWorkbench {
  return {
    vehicles: [
      { id: "vehicle-tacho", registration: "AB12CDE", active: true },
      { id: "vehicle-2", registration: "XY99ZZZ", active: true }
    ],
    trailers: [{ id: "trailer-1", trailerNumber: "SLH1", type: "Standard curtainsider", active: true }],
    loads: [],
    ...overrides
  };
}

describe("smart Dispatch board state", () => {
  it("pre-populates a free driver's vehicle from Tacho last-used evidence", () => {
    const selections = buildInitialSelections([driver()], [run()], equipment());
    expect(selections["driver-1"]).toMatchObject({ runId: "", vehicleId: "vehicle-tacho", trailerId: "" });
  });

  it("preserves an existing allocation ahead of the Tacho vehicle suggestion", () => {
    const selections = buildInitialSelections([driver()], [run()], equipment({
      loads: [{ id: "run-1", driverId: "driver-1", vehicleId: "vehicle-2", trailerId: "trailer-1", plannedStartUtc: "2026-09-10T05:00:00Z" }]
    }));
    expect(selections["driver-1"]).toEqual({
      runId: "run-1",
      vehicleId: "vehicle-2",
      trailerId: "trailer-1",
      plannedStartTime: "2026-09-10T05:00:00Z",
      useReducedDailyRest: false
    });
  });

  it("replaces the persisted start when Get Times recomputes legal availability", () => {
    const calculated = [{
      driverId: "driver-1",
      availableFrom: "2026-09-10T04:00:00Z",
      requiredRestPeriod: 11,
      weeklyWorkingTimeUsed: 30,
      dailyDrivingTimeUsed: 5,
      wtdStatus: "ok"
    }];

    expect(applyAvailableTimes({ "driver-1": { runId: "run-1", vehicleId: "vehicle-tacho", trailerId: "" } }, calculated)["driver-1"].plannedStartTime)
      .toBe("2026-09-10T04:00:00Z");
    expect(applyAvailableTimes({ "driver-1": { runId: "run-5", vehicleId: "vehicle-tacho", trailerId: "", plannedStartTime: "2026-09-10T06:00:00Z" } }, calculated)["driver-1"].plannedStartTime)
      .toBe("2026-09-10T04:00:00Z");
    expect(availableTimesByDriver(calculated)["driver-1"].requiredRestPeriod).toBe(11);
  });

  it("does not report a stale rest choice after Run 5 is selected and Get Times is rerun", () => {
    const regularTimes = availableTimesByDriver([{
      driverId: "driver-1", availableFrom: "2026-09-10T04:00:00Z", requiredRestPeriod: 11,
      weeklyWorkingTimeUsed: 30, dailyDrivingTimeUsed: 5, wtdStatus: "ok"
    }]);
    const selection = applyAvailableTimes({
      "driver-1": { runId: "run-5", vehicleId: "vehicle-tacho", trailerId: "", useReducedDailyRest: false,
        plannedStartTime: "2026-09-10T06:00:00Z" }
    }, Object.values(regularTimes));

    expect(validateLockSelections([driver()], [run({ runId: "run-5", reference: "Run 5" })], equipment(), selection, regularTimes))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining("Rest choice changed") })]));
  });

  it("keeps drivers with allocated runs at the top while retaining subcontractors", () => {
    const drivers = [
      driver({ driverId: "free-employed", name: "Free Employed", employmentType: "Employed" }),
      driver({ driverId: "subbie", name: "Subbie Driver", employmentType: "Subcontractor" }),
      driver({ driverId: "allocated", name: "Allocated Driver", employmentType: "Employed" })
    ];
    const selections = {
      "free-employed": { runId: "", vehicleId: "", trailerId: "" },
      subbie: { runId: "", vehicleId: "", trailerId: "" },
      allocated: { runId: "run-1", vehicleId: "vehicle-2", trailerId: "" }
    };

    expect(sortDriversForDispatch(drivers, selections).map(item => item.driverId)).toEqual([
      "allocated",
      "free-employed",
      "subbie"
    ]);
  });

  it("keeps already allocated drivers visible ahead of the remaining active population", () => {
    const drivers = Array.from({ length: 25 }, (_, index) => driver({
      driverId: `driver-${String(index + 1).padStart(2, "0")}`,
      name: `Driver ${String(index + 1).padStart(2, "0")}`,
      employmentType: index % 5 === 0 ? "Subcontractor" : "Employed"
    }));
    const selections = Object.fromEntries(drivers.map(item => [
      item.driverId,
      { runId: item.driverId === "driver-25" ? "run-1" : "", vehicleId: "", trailerId: "" }
    ]));

    expect(filterDispatchDrivers(drivers, "all", selections, [run()], {}, []).map(item => item.driverId))
      .toEqual(["driver-25", ...drivers.slice(0, 24).map(item => item.driverId)]);
  });

  it("filters driver dispatch by driver name, code, skill, employment and location text", () => {
    const drivers = [
      driver({ driverId: "north", name: "Alex North", driverCode: "SLH101", employmentType: "Employed", skills: "MarketRun", trackingData: { lastStopName: "Lake Lane" } }),
      driver({ driverId: "agency", name: "Becky Cover", driverCode: "AG44", employmentType: "AgencyDay", skills: "Moffett", suggestedRunReference: "Run 18", trackingData: { lastStopName: "Natures Way" } })
    ];

    expect(filterDriversByDriverSearch(drivers, "becky").map(item => item.driverId)).toEqual(["agency"]);
    expect(filterDriversByDriverSearch(drivers, "AG44").map(item => item.driverId)).toEqual(["agency"]);
    expect(filterDriversByDriverSearch(drivers, "moffett").map(item => item.driverId)).toEqual(["agency"]);
    expect(filterDriversByDriverSearch(drivers, "lake").map(item => item.driverId)).toEqual(["north"]);
  });

  it("filters the board by employed, agency, casual and subcontractor", () => {
    const drivers = [
      driver({ driverId: "e", employmentType: "Employed" }),
      driver({ driverId: "a", employmentType: "Agency" }),
      driver({ driverId: "c", employmentType: "Casual" }),
      driver({ driverId: "s", employmentType: "Subcontractor" })
    ];

    expect(filterDriversByEmploymentType(drivers, "all")).toHaveLength(4);
    expect(filterDriversByEmploymentType(drivers, "employed").map(item => item.driverId)).toEqual(["e"]);
    expect(filterDriversByEmploymentType(drivers, "agency").map(item => item.driverId)).toEqual(["a"]);
    expect(filterDriversByEmploymentType(drivers, "casual").map(item => item.driverId)).toEqual(["c"]);
    expect(filterDriversByEmploymentType(drivers, "subcontractor").map(item => item.driverId)).toEqual(["s"]);
  });

  it("normalises agency variants into the agency filter", () => {
    const drivers = [
      driver({ driverId: "day", employmentType: "AgencyDay" }),
      driver({ driverId: "long", employmentType: "AgencyLong" })
    ];
    expect(filterDriversByEmploymentType(drivers, "agency").map(item => item.driverId)).toEqual(["day", "long"]);
  });

  it("surfaces lock validation against the exact driver row before calling the API", () => {
    const rows = validateLockSelections(
      [driver()],
      [run()],
      equipment(),
      { "driver-1": { runId: "run-1", vehicleId: "", trailerId: "" } },
      {}
    );

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ driverId: "driver-1", runId: "run-1", reason: "Select a vehicle before locking this run." }),
      expect.objectContaining({ driverId: "driver-1", runId: "run-1", reason: "Get Tacho available times before locking this driver." })
    ]));
  });

  it("blocks a selected start earlier than the Tacho-derived legal availability", () => {
    const times = availableTimesByDriver([{
      driverId: "driver-1",
      availableFrom: "2026-09-10T05:00:00Z",
      requiredRestPeriod: 11,
      weeklyWorkingTimeUsed: 30,
      dailyDrivingTimeUsed: 5,
      wtdStatus: "ok"
    }]);
    const rows = validateLockSelections(
      [driver()],
      [run()],
      equipment(),
      { "driver-1": { runId: "run-1", vehicleId: "vehicle-tacho", trailerId: "", plannedStartTime: "2026-09-10T04:59:00Z" } },
      times
    );

    expect(rows.some(row => row.reason.includes("earlier than the Tacho-derived available-from"))).toBe(true);
  });
});
