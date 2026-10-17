import { describe, expect, it } from "vitest";
import { findFinalRunSavings, type FinalCheckRun } from "./runPlannerFinalCheck";

const orders = [
  { id: "runcton", palletType: "Standard" },
  { id: "merston", palletType: "Standard" },
  { id: "groves", palletType: "Standard" },
  { id: "amazon", palletType: "Standard" },
  { id: "selsey", palletType: "Standard" },
  { id: "relief", palletType: "Euro" },
];

const line = (orderId: string, collectionSite: string, deliverySite: string, pallets: number) => ({ orderId, collectionSite, deliverySite, pallets });

describe("findFinalRunSavings", () => {
  it("finds the three-run split that removes a lightly loaded final run", () => {
    const runs: FinalCheckRun[] = [
      { key: "9", label: "RUN 9", period: "AM", complete: true, lines: [line("relief", "Runcton", "Atherstone", 19)] },
      { key: "11", label: "RUN 11", period: "AM", complete: true, lines: [
        line("runcton", "Runcton", "Latimer Park", 9),
        line("merston", "Merston", "Latimer Park", 6),
        line("groves", "Groves", "Latimer Park", 2),
        line("amazon", "Chichester", "Amazon", 2),
      ] },
      { key: "12", label: "RUN 12", period: "AM", complete: true, lines: [line("selsey", "Selsey", "Latimer Park", 11)] },
    ];

    const result = findFinalRunSavings(runs, orders);

    expect(result).toHaveLength(1);
    expect(result[0].sourceRunLabel).toBe("RUN 12");
    expect(result[0].movements).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromRunLabel: "RUN 11", toRunLabel: "RUN 9", pallets: 4, collectionSite: "Runcton" }),
      expect.objectContaining({ fromRunLabel: "RUN 12", toRunLabel: "RUN 11", pallets: 11, collectionSite: "Selsey" }),
    ]));
    expect(result[0].resultingUtilisation).toEqual(expect.arrayContaining([
      expect.objectContaining({ runLabel: "RUN 11", percent: 100 }),
    ]));
    expect(result[0].timingCheckRequired).toBe(true);
  });

  it("does not mix AM and PM work or use incomplete manual lines", () => {
    const runs: FinalCheckRun[] = [
      { key: "am", label: "RUN 1", period: "AM", complete: true, lines: [line("runcton", "Runcton", "Latimer Park", 10)] },
      { key: "pm", label: "RUN 2", period: "PM", complete: true, lines: [line("selsey", "Selsey", "Latimer Park", 10)] },
      { key: "manual", label: "RUN 3", period: "AM", complete: false, lines: [line("selsey", "Selsey", "Latimer Park", 3)] },
    ];

    expect(findFinalRunSavings(runs, orders)).toEqual([]);
  });

  it("offers a direct consolidation when the receiving run has capacity", () => {
    const runs: FinalCheckRun[] = [
      { key: "target", label: "RUN 1", period: "AM", complete: true, lines: [line("runcton", "Runcton", "Latimer Park", 12)] },
      { key: "source", label: "RUN 2", period: "AM", complete: true, lines: [line("selsey", "Selsey", "Latimer Park", 6)] },
    ];

    const result = findFinalRunSavings(runs, orders);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceRunKey: "source", targetRunKey: "target" });
    expect(result[0]).not.toHaveProperty("reliefRunKey");
    expect(result[0].resultingUtilisation[0].percent).toBeCloseTo(69.2, 1);
  });
});
