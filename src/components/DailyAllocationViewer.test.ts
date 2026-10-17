import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DailyAllocationViewer.tsx", import.meta.url), "utf8");

describe("Dashboard Driver Dispatch mirror", () => {
  it("reads the same workbench and status sources as Driver Dispatch", () => {
    expect(source).toContain('/api/v1/driver-dispatch?date=');
    expect(source).toContain('/api/v1/driver-dispatch-status?date=');
    expect(source).not.toContain('driverAssignments(');
  });

  it("is read-only and mirrors the operational Dispatch columns", () => {
    for (const heading of ["Driver", "Type / skills", "Code", "Day", "Vehicle", "Trailer", "Run", "Status"]) {
      expect(source).toContain(`<th>${heading}</th>`);
    }
    expect(source).not.toContain("Allocate</button>");
    expect(source).not.toContain("Save allocation</button>");
  });

  it("does not hammer the dispatch workbench while the dashboard is open", () => {
    expect(source).toContain("30_000");
    expect(source).toContain('document.visibilityState === "visible"');
    expect(source).not.toContain("10_000");
  });

  it("uses the operational lifecycle while retaining safe legacy fallbacks", () => {
    expect(source).toContain('if (status?.operationalStatus) return status.operationalStatus');
    expect(source).toContain('if (!assigned) return "No Run"');
    expect(source).toContain('return "Dispatched"');
    expect(source).toContain('return "Awaiting Dispatch"');
    for (const status of ["Dispatched", "Working", "Completed"]) {
      expect(source).toContain(status);
    }
    expect(source).toContain("driverConfirmed");
  });
});