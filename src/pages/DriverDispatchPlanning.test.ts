import { afterEach, describe, expect, it } from "vitest";
import { firstCollectionStop, runDirection, setDispatchFocusedDriverIds, sortDispatchDrivers, suggestionRunLabel } from "./DriverDispatchPlanning";

function load(overrides: Record<string, unknown> = {}) {
  return {
    id: "load-1",
    reference: "Run 2 PM",
    rawReference: "PLAN-20260828-2",
    planningDate: "2026-08-28",
    status: "Draft",
    southbound: false,
    stops: [
      { id: "c", sequence: 1, name: "Collect · NWF-Runcton", latitude: 50.8, longitude: -0.7 },
      { id: "d", sequence: 2, name: "Deliver · Aldi-Stockton", latitude: 54.57, longitude: -1.31 },
    ],
    ...overrides,
  } as NonNullable<Parameters<typeof suggestionRunLabel>[0]>;
}

afterEach(() => setDispatchFocusedDriverIds(undefined));

describe("Driver Dispatch planning helpers", () => {
  it("labels an assistant run with its final destination", () => {
    expect(suggestionRunLabel(load())).toBe("Run 2 Aldi Stockton");
  });

  it("groups a run travelling materially north as Northern", () => {
    expect(runDirection(load())).toBe("Northern");
  });

  it("uses the first collection stop rather than a later delivery", () => {
    expect(firstCollectionStop(load())?.name).toBe("Collect · NWF-Runcton");
  });

  it("puts planned drivers above unallocated drivers so the planner can work down", () => {
    const rows = sortDispatchDrivers([
      { driverId: "free-b", displayName: "Brian", driverType: "Employed", assignedLoadId: undefined },
      { driverId: "planned-z", displayName: "Zed", driverType: "Subcontractor", assignedLoadId: "run-2" },
      { driverId: "free-a", displayName: "Adam", driverType: "Employed", assignedLoadId: undefined },
      { driverId: "planned-a", displayName: "Alice", driverType: "Employed", assignedLoadId: "run-1" },
    ]);

    expect(rows.map(row => row.driverId)).toEqual(["planned-a", "planned-z", "free-a", "free-b"]);
  });

  it("only returns drivers admitted by the rolling visibility service", () => {
    setDispatchFocusedDriverIds(["recent", "subbie"]);
    const rows = sortDispatchDrivers([
      { driverId: "recent", displayName: "Recent Driver", driverType: "Employed", assignedLoadId: undefined },
      { driverId: "stale", displayName: "Stale Driver", driverType: "Employed", assignedLoadId: undefined },
      { driverId: "subbie", displayName: "Subbie Driver", driverType: "Subcontractor", assignedLoadId: undefined }
    ]);
    expect(rows.map(row => row.driverId)).toEqual(["recent", "subbie"]);
  });

  it("falls back to the full list when visibility is unavailable", () => {
    setDispatchFocusedDriverIds(undefined);
    const rows = sortDispatchDrivers([
      { driverId: "recent", displayName: "Recent Driver", driverType: "Employed", assignedLoadId: undefined },
      { driverId: "stale", displayName: "Stale Driver", driverType: "Employed", assignedLoadId: undefined }
    ]);
    expect(rows).toHaveLength(2);
  });
});