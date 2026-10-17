import { describe, expect, it } from "vitest";
import type { Driver } from "../lib/api";
import { filterDrivers, type DriverColumnFilters } from "./driverColumnFilters";

const emptyFilters: DriverColumnFilters = {
  employeeNumber: "", displayName: "", mobileNumber: "", driverType: "", driverGroup: "", skills: "", coding: "",
  northEligible: "", preloadEligible: "", tachoName: "", tachoCardNumber: "", tachoMasterDriverId: "",
  tachoDriveAvailableTodayMinutes: "", tachoDriveAvailableWeekMinutes: "", tachoWorkAvailableWeekMinutes: "",
  lastTachoSyncUtc: "", drivingLicenceNumber: "", licenceExpiry: "", licenceStatus: "", notes: "", active: "",
};

const drivers: Driver[] = [
  {
    id: "one", employeeNumber: "SLH-001", displayName: "Alex North", mobileNumber: "07000111111", driverType: "Class 1",
    driverGroup: "Days", skills: "Moffett", coding: "A1", northEligible: true, preloadEligible: false, tachoName: "NORTH ALEX",
    tachoCardNumber: "GB12345678", tachoMasterDriverId: "42", tachoDriveAvailableTodayMinutes: 300,
    tachoDriveAvailableWeekMinutes: 1200, tachoWorkAvailableWeekMinutes: 1800, lastTachoSyncUtc: "2026-08-22T08:30:00Z",
    drivingLicenceNumber: "NORTH123", licenceExpiry: "2027-06-30", licenceStatus: "Valid", notes: "ADR", active: true,
  },
  {
    id: "two", employeeNumber: "SLH-002", displayName: "Blair South", mobileNumber: "07000222222", driverType: "Class 2",
    driverGroup: "Nights", skills: "Tail lift", coding: "B2", northEligible: false, preloadEligible: true, tachoName: "SOUTH BLAIR",
    tachoCardNumber: "GB87654321", tachoMasterDriverId: "84", tachoDriveAvailableTodayMinutes: 120,
    tachoDriveAvailableWeekMinutes: 600, tachoWorkAvailableWeekMinutes: 900, lastTachoSyncUtc: "2026-08-20T17:15:00Z",
    drivingLicenceNumber: "SOUTH456", licenceExpiry: "2026-12-01", licenceStatus: "Review", notes: "Agency cover", active: false,
  },
];

describe("filterDrivers", () => {
  it("filters independently by every visible driver data column", () => {
    // Regression caught: a rendered column has an input but its value is not included in filtering.
    const cases: Array<[keyof DriverColumnFilters, string, string]> = [
      ["employeeNumber", "001", "one"], ["displayName", "alex", "one"], ["mobileNumber", "1111", "one"],
      ["driverType", "class 1", "one"], ["driverGroup", "days", "one"], ["skills", "moffett", "one"],
      ["coding", "a1", "one"], ["northEligible", "yes", "one"], ["preloadEligible", "yes", "two"],
      ["tachoName", "north", "one"], ["tachoCardNumber", "345678", "one"], ["tachoMasterDriverId", "42", "one"],
      ["tachoDriveAvailableTodayMinutes", "5h 00m", "one"], ["tachoDriveAvailableWeekMinutes", "20h", "one"],
      ["tachoWorkAvailableWeekMinutes", "30h", "one"], ["lastTachoSyncUtc", "22/08/2026", "one"],
      ["drivingLicenceNumber", "north123", "one"], ["licenceExpiry", "30/06/2027", "one"],
      ["licenceStatus", "valid", "one"], ["notes", "adr", "one"], ["active", "no", "two"],
    ];

    for (const [column, query, expectedId] of cases) {
      expect(filterDrivers(drivers, "", { ...emptyFilters, [column]: query }).map((driver) => driver.id), column).toEqual([expectedId]);
    }
  });

  it("combines global and column filters", () => {
    expect(filterDrivers(drivers, "south", { ...emptyFilters, active: "no" }).map((driver) => driver.id)).toEqual(["two"]);
    expect(filterDrivers(drivers, "north", { ...emptyFilters, active: "no" })).toEqual([]);
  });
});
