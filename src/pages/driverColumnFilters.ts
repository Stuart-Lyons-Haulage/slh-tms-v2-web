import type { Driver } from "../lib/api";

export type DriverColumnKey =
  | "employeeNumber"
  | "displayName"
  | "mobileNumber"
  | "driverType"
  | "driverGroup"
  | "skills"
  | "coding"
  | "northEligible"
  | "preloadEligible"
  | "tachoName"
  | "tachoCardNumber"
  | "tachoMasterDriverId"
  | "tachoDriveAvailableTodayMinutes"
  | "tachoDriveAvailableWeekMinutes"
  | "tachoWorkAvailableWeekMinutes"
  | "lastTachoSyncUtc"
  | "drivingLicenceNumber"
  | "licenceExpiry"
  | "licenceStatus"
  | "notes"
  | "active";

export type DriverColumnFilters = Record<DriverColumnKey, string>;

export const driverColumnKeys: DriverColumnKey[] = [
  "employeeNumber", "displayName", "mobileNumber", "driverType", "driverGroup", "skills", "coding", "northEligible",
  "preloadEligible", "tachoName", "tachoCardNumber", "tachoMasterDriverId", "tachoDriveAvailableTodayMinutes",
  "tachoDriveAvailableWeekMinutes", "tachoWorkAvailableWeekMinutes", "lastTachoSyncUtc", "drivingLicenceNumber",
  "licenceExpiry", "licenceStatus", "notes", "active",
];

export function emptyDriverColumnFilters(): DriverColumnFilters {
  return Object.fromEntries(driverColumnKeys.map((key) => [key, ""])) as DriverColumnFilters;
}

function minutes(input?: number | null) {
  if (input == null) return "";
  return `${Math.floor(input / 60)}h ${String(Math.abs(input % 60)).padStart(2, "0")}m`;
}

function dateTime(input?: string | null) {
  if (!input) return "";
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : `${input} ${parsed.toLocaleString("en-GB")}`;
}

function yesNo(input?: boolean) {
  return input ? "Yes" : "No";
}

export function driverColumnValue(driver: Driver, key: DriverColumnKey) {
  switch (key) {
    case "northEligible": return yesNo(driver.northEligible);
    case "preloadEligible": return yesNo(driver.preloadEligible);
    case "active": return yesNo(driver.active);
    case "tachoDriveAvailableTodayMinutes": return minutes(driver.tachoDriveAvailableTodayMinutes);
    case "tachoDriveAvailableWeekMinutes": return minutes(driver.tachoDriveAvailableWeekMinutes);
    case "tachoWorkAvailableWeekMinutes": return minutes(driver.tachoWorkAvailableWeekMinutes);
    case "lastTachoSyncUtc": return dateTime(driver.lastTachoSyncUtc);
    case "licenceExpiry": return dateTime(driver.licenceExpiry);
    default: return String(driver[key] ?? "");
  }
}

export function filterDrivers(drivers: Driver[], globalFilter: string, columnFilters: DriverColumnFilters) {
  const globalQuery = globalFilter.trim().toLowerCase();
  return drivers.filter((driver) => {
    const values = driverColumnKeys.map((key) => driverColumnValue(driver, key).toLowerCase());
    if (globalQuery && !values.some((candidate) => candidate.includes(globalQuery))) return false;

    return driverColumnKeys.every((key) => {
      const query = columnFilters[key].trim().toLowerCase();
      return !query || driverColumnValue(driver, key).toLowerCase().includes(query);
    });
  });
}
