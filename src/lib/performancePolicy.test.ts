import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { effectivePollingDelay } from "./pollingPolicy";
import { startVisiblePolling } from "./visiblePolling";

function source(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("SLH TMS performance policy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps operational background cadences at the agreed levels", () => {
    expect(effectivePollingDelay("/", 20_000)).toBe(30_000);
    expect(effectivePollingDelay("/driver-dispatch", 20_000)).toBe(60_000);
    expect(effectivePollingDelay("/dashboard", 20_000)).toBe(60_000);
    expect(effectivePollingDelay("/staging", 20_000)).toBe(60_000);
    expect(effectivePollingDelay("/warehouse", 30_000)).toBe(120_000);
    expect(effectivePollingDelay("/communications", 30_000)).toBe(120_000);
    expect(effectivePollingDelay("/operations-wallboard", 20_000)).toBe(600_000);
    expect(effectivePollingDelay("/live-runs", 20_000)).toBe(600_000);
    expect(effectivePollingDelay("/compliance", 20_000)).toBe(900_000);
    expect(effectivePollingDelay("/control-centre", 20_000)).toBe(600_000);
  });

  it("makes Planner and Pallet Control event-driven without remount refreshes", () => {
    const pallet = source("../pages/PalletPlanningControl.tsx");
    const plannerShell = source("../pages/PlannerEnhanced.tsx");
    const planner = source("../pages/RunPlannerLive.tsx");
    expect(pallet).toContain("subscribePlanningChanges");
    expect(pallet).toContain("30_000");
    expect(pallet).not.toContain("2000");
    expect(pallet).not.toContain("2_000");
    expect(planner).toContain("subscribePlanningChanges");
    expect(planner).toContain("30_000");
    expect(plannerShell).not.toContain("serverRevision");
    expect(plannerShell).not.toContain("subscribeServerPlanningChanges");
  });


  it("does not run routine polling while hidden and refreshes once on resume", async () => {
    vi.useFakeTimers();
    const documentEvents = new EventTarget();
    let visibilityState: "visible" | "hidden" = "hidden";
    Object.defineProperty(documentEvents, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    const documentStub = documentEvents as EventTarget & { readonly visibilityState: "visible" | "hidden" };
    const windowEvents = new EventTarget();
    const windowStub = Object.assign(windowEvents, {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    vi.stubGlobal("document", documentStub);
    vi.stubGlobal("window", windowStub);

    const refresh = vi.fn();
    const stop = startVisiblePolling(refresh, 60_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).not.toHaveBeenCalled();

    visibilityState = "visible";
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    windowEvents.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });
});