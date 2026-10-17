import { describe, expect, it } from "vitest";
import type { PlannerCsvPayload } from "./plannerCsvImport";
import { plannerPayloadToBetaComparison } from "./betaOptimiser";

describe("plannerPayloadToBetaComparison", () => {
  it("keeps all collections ahead of linked deliveries for each planner run", () => {
    const payload: PlannerCsvPayload = {
      schema: "slh-planner-plan-v1",
      planningDate: "2026-09-09",
      exceptions: [],
      runs: [{
        runRef: "LYONS-20260909-RUN-001",
        plannerRun: "Run 1",
        planningDate: "2026-09-09",
        includeInImport: true,
        reconciliationStatus: "CSV direct import",
        capacityStatus: "Green",
        mixedUtilisationPercent: 50,
        stops: [
          { sequence: 1, collectionSite: "NWF Drayton", deliverySite: "Darlington", sourceRow: 2 },
          { sequence: 2, collectionSite: "Runcton", deliverySite: "Leeds", sourceRow: 3 }
        ]
      }]
    };

    const request = plannerPayloadToBetaComparison(payload);

    expect(request.planningDate).toBe("2026-09-09");
    expect(request.routes).toHaveLength(1);
    expect(request.routes[0].reference).toBe("Run 1");
    expect(request.routes[0].stops).toEqual([
      { name: "NWF Drayton", orderKey: "2", reference: undefined, pallets: undefined, role: "Collection" },
      { name: "Runcton", orderKey: "3", reference: undefined, pallets: undefined, role: "Collection" },
      { name: "Darlington", orderKey: "2", reference: undefined, pallets: undefined, role: "Delivery" },
      { name: "Leeds", orderKey: "3", reference: undefined, pallets: undefined, role: "Delivery" }
    ]);
  });

  it("does not benchmark planner runs excluded from import", () => {
    const payload: PlannerCsvPayload = {
      schema: "slh-planner-plan-v1",
      planningDate: "2026-09-09",
      exceptions: [],
      runs: [
        {
          runRef: "LYONS-20260909-RUN-001",
          plannerRun: "Run 1",
          planningDate: "2026-09-09",
          includeInImport: true,
          reconciliationStatus: "CSV direct import",
          capacityStatus: "Green",
          mixedUtilisationPercent: 50,
          stops: [{ sequence: 1, collectionSite: "Runcton", deliverySite: "Leeds", sourceRow: 2 }]
        },
        {
          runRef: "LYONS-20260909-RUN-002",
          plannerRun: "Run 2",
          planningDate: "2026-09-09",
          includeInImport: false,
          reconciliationStatus: "Excluded",
          capacityStatus: "Green",
          mixedUtilisationPercent: 50,
          stops: [{ sequence: 1, collectionSite: "Selsey", deliverySite: "Cardiff", sourceRow: 3 }]
        }
      ]
    };

    const request = plannerPayloadToBetaComparison(payload);

    expect(request.routes.map(route => route.reference)).toEqual(["Run 1"]);
  });

  it("carries PO, pallets and collection/delivery role so the uploaded Lyons plan can be reconciled to TMS orders", () => {
    const payload: PlannerCsvPayload = {
      schema: "slh-planner-plan-v1",
      planningDate: "2026-09-09",
      exceptions: [],
      runs: [{
        runRef: "LYONS-20260909-RUN-001",
        plannerRun: "Run 1",
        planningDate: "2026-09-09",
        includeInImport: true,
        reconciliationStatus: "CSV direct import",
        capacityStatus: "Green",
        mixedUtilisationPercent: 50,
        stops: [{ sequence: 1, collectionSite: "Runcton", deliverySite: "Leeds", pallets: 9, reference: "PO-7788", sourceRow: 7 }]
      }]
    };

    const request = plannerPayloadToBetaComparison(payload);

    expect(request.routes[0].stops).toEqual([
      { name: "Runcton", orderKey: "7", reference: "PO-7788", pallets: 9, role: "Collection" },
      { name: "Leeds", orderKey: "7", reference: "PO-7788", pallets: 9, role: "Delivery" }
    ]);
  });
});