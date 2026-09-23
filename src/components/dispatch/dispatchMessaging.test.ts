import { describe, expect, it } from "vitest";
import type { RunDispatchDto } from "../../types/dto/dispatch";
import { buildDispatchText, canUnassignDispatchRun, dispatchActionForStatus } from "./dispatchMessaging";

const dispatch: RunDispatchDto = {
  reference: "Run 4 PM",
  planningDate: "2026-09-10",
  status: "Allocated",
  driver: { displayName: "Dan Driver", employeeNumber: "D001" },
  vehicle: { registration: "AB12 CDE", fuelPin: "4826" },
  trailer: { trailerNumber: "TRL-01" },
  stops: [
    {
      sequence: 1,
      name: "Collect · Runcton",
      address: "Runcton, Chichester",
      order: { reference: "PO-123", customerCode: "NWF", pallets: 18 }
    },
    {
      sequence: 2,
      name: "Deliver · Birmingham Market",
      address: "Birmingham",
      order: { reference: "MKT-1", customerCode: "MKT", marketName: "Birmingham Wholesale Market", stallNumber: "A12", driverInstructions: "Call on arrival" }
    }
  ]
};

describe("authoritative Smart Dispatch messaging", () => {
  it("only exposes Dispatch once the selected run is locked to that driver", () => {
    expect(dispatchActionForStatus(false, "No Run")).toBe("allocate");
    expect(dispatchActionForStatus(true, "Awaiting Dispatch")).toBe("dispatch");
    expect(dispatchActionForStatus(true, "Sent Awaiting Response")).toBe("amend");
    expect(dispatchActionForStatus(true, "Confirmed")).toBe("amend");
  });

  it("keeps an explicit unassign option for an allocated run", () => {
    expect(canUnassignDispatchRun(false, "No Run")).toBe(false);
    expect(canUnassignDispatchRun(true, "Awaiting Dispatch")).toBe(true);
    expect(canUnassignDispatchRun(true, "Sent Awaiting Response")).toBe(true);
    expect(canUnassignDispatchRun(true, "Confirmed")).toBe(true);
  });

  it("builds the editable driver text with route, reference and market detail", () => {
    const text = buildDispatchText("Run 4 PM", dispatch, "17:30");
    expect(text).toContain("SLH Run 4 PM");
    expect(text).toContain("Driver: Dan Driver");
    expect(text).toContain("Planned start: 17:30");
    expect(text).toContain("Vehicle: AB12 CDE");
    expect(text).toContain("Fuel PIN: 4826");
    expect(text).toContain("Trailer: TRL-01");
    expect(text).toContain("Ref: PO-123");
    expect(text).toContain("Pallets: 18");
    expect(text).toContain("Market: Birmingham Wholesale Market · Stall A12");
    expect(text).toContain("Notes: Call on arrival");
    expect(text).toContain("Please reply to confirm receipt.");
  });
});
