import { describe, expect, it } from "vitest";
import { canUnassignDispatchRun, dispatchActionForStatus } from "./dispatchMessaging";

describe("authoritative Smart Dispatch actions", () => {
  it("only exposes Dispatch once the selected run is locked to that driver", () => {
    expect(dispatchActionForStatus(false, "No Run")).toBe("allocate");
    expect(dispatchActionForStatus(true, "Awaiting Dispatch")).toBe("dispatch");
    expect(dispatchActionForStatus(true, "Sent Awaiting Response")).toBe("dispatch");
    expect(dispatchActionForStatus(true, "Confirmed")).toBe("dispatch");
  });

  it("keeps an explicit unassign option for an allocated run", () => {
    expect(canUnassignDispatchRun(false, "No Run")).toBe(false);
    expect(canUnassignDispatchRun(true, "Awaiting Dispatch")).toBe(true);
    expect(canUnassignDispatchRun(true, "Sent Awaiting Response")).toBe(true);
    expect(canUnassignDispatchRun(true, "Confirmed")).toBe(true);
  });

});
