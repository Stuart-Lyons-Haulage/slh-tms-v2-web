import { describe, expect, it } from "vitest";
import { mergeAuthoritativeFinalTiming, retainLastUsefulTvEtas } from "./publicTvFinalTiming";

describe("public TV authoritative final timing", () => {
  it("replaces the fallback TV ETA with the cumulative run-timing final ETA", () => {
    const runs = [{
      id: "run-6",
      finalStop: "Morrisons-Gadbrook",
      etaTarget: "Morrisons-Gadbrook",
      etaUtc: "2026-08-26T16:40:00Z",
      etaSource: "Planned",
      state: "MOVING",
    }];

    const result = mergeAuthoritativeFinalTiming(runs, {
      planningDate: "2026-08-26",
      geofenceAvailable: true,
      records: [{
        loadId: "run-6",
        completed: false,
        finalEtaUtc: "2026-08-26T15:18:00Z",
        finalEtaSource: "Geofence",
      }],
    });

    expect(result[0]).toMatchObject({
      etaUtc: "2026-08-26T15:18:00Z",
      etaSource: "Live",
      etaTarget: "Morrisons-Gadbrook",
    });
  });

  it("does not reintroduce a completed timing record or overwrite an ARRIVED time", () => {
    const runs = [{
      id: "run-9",
      finalStop: "Final customer",
      etaTarget: "Final customer",
      etaUtc: "2026-08-26T14:43:00Z",
      etaSource: "Arrived",
      state: "ARRIVED",
    }];

    const result = mergeAuthoritativeFinalTiming(runs, {
      planningDate: "2026-08-26",
      geofenceAvailable: true,
      records: [{
        loadId: "run-9",
        completed: true,
        finalEtaUtc: "2026-08-26T14:55:00Z",
        finalEtaSource: "Geofence",
      }],
    });

    expect(result[0]).toMatchObject({
      etaUtc: "2026-08-26T14:43:00Z",
      etaSource: "Arrived",
      state: "ARRIVED",
    });
  });

  it("keeps the last live ETA when a lightweight TV refresh temporarily falls back to planned timing", () => {
    const previous = [{
      id: "run-6",
      finalStop: "Morrisons-Gadbrook",
      etaTarget: "Morrisons-Gadbrook",
      etaUtc: "2026-08-26T15:18:00Z",
      etaSource: "Live",
      state: "MOVING",
    }];
    const current = [{
      id: "run-6",
      finalStop: "Morrisons-Gadbrook",
      etaTarget: "Morrisons-Gadbrook",
      etaUtc: "2026-08-26T16:40:00Z",
      etaSource: "Planned",
      state: "MOVING",
    }];

    const result = retainLastUsefulTvEtas(current, previous);

    expect(result[0]).toMatchObject({
      etaUtc: "2026-08-26T15:18:00Z",
      etaSource: "Live",
    });
  });

  it("never restores a row that the live TV feed has removed", () => {
    const previous = [{
      id: "run-9",
      etaUtc: "2026-08-26T14:43:00Z",
      etaSource: "Arrived",
      state: "ARRIVED",
    }];

    expect(retainLastUsefulTvEtas([], previous)).toEqual([]);
  });
});
