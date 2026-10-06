import { describe, expect, it } from "vitest";
import { isIgnorableAgencyStatus } from "./Staffing";

describe("agency workbook status normalisation", () => {
  it("ignores provider rest, cancellation, and non-availability codes", () => {
    for (const status of ["R", "RES", "REST", "CANCELLED", "N/A", "NOT AVAILABLE"]) {
      expect(isIgnorableAgencyStatus(status)).toBe(true);
    }
  });

  it("ignores weekday and spreadsheet date labels", () => {
    expect(isIgnorableAgencyStatus("THURSDAY")).toBe(true);
    expect(isIgnorableAgencyStatus("THU NOV 06 2025 00:00:00 GMT+0000 (GMT+00:00)")).toBe(true);
  });

  it("keeps genuinely unknown values visible for review", () => {
    expect(isIgnorableAgencyStatus("MAYBE AVAILABLE")).toBe(false);
  });
});
