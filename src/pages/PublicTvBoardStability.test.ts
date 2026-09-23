import { describe, expect, it } from "vitest";
import { stabiliseTvRuns } from "./publicTvBoardStabilityLogic";

describe("public TV stability", () => {
  it("changes a final on-site run from dwell to ARRIVED and uses its arrival time", () => {
    const result = stabiliseTvRuns([{
      id: "run-6",
      nextStop: "Morrisons-Gadbrook",
      finalStop: "Morrisons-Gadbrook",
      siteArrivalUtc: "2026-08-26T13:43:00Z",
      dwellState: "OnSite",
      liveDwellMinutes: 67,
      state: "SITE DELAY",
      stateDetail: "time on site 67 min",
    }], new Map(), 1_000);

    expect(result[0].state).toBe("ARRIVED");
    expect(result[0].etaUtc).toBe("2026-08-26T13:43:00Z");
    expect(result[0].etaSource).toBe("Arrived");
    expect(result[0].liveDwellMinutes).toBeUndefined();
  });

  it("keeps an ETA through one sparse refresh", () => {
    const cache = new Map();
    stabiliseTvRuns([{ id: "run-22", etaUtc: "2026-08-26T21:19:00Z", etaSource: "Live", state: "AT RISK" }], cache, 1_000);
    const result = stabiliseTvRuns([{ id: "run-22", etaSource: "Unavailable", state: "MOVING" }], cache, 21_000);

    expect(result[0].etaUtc).toBe("2026-08-26T21:19:00Z");
    expect(result[0].etaSource).toBe("Live");
  });
});
