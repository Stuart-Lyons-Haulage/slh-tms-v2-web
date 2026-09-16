import { describe, expect, it } from "vitest";
import app from "./App.tsx?raw";
import optimiser from "./components/OptimiserProposalReview.tsx?raw";
import control from "./pages/ControlCentre.tsx?raw";
import dashboard from "./pages/DashboardOperational.tsx?raw";
import imports from "./pages/ImportCentre.tsx?raw";
import master from "./pages/MasterDataHub.tsx?raw";
import review from "./pages/OrderReviewBulk.tsx?raw";
import palletControl from "./pages/PalletPlanningControl.tsx?raw";
import planner from "./pages/PlannerEnhanced.tsx?raw";
import runBuilder from "./pages/RunPlannerLive.tsx?raw";

describe("operations housekeeping contract", () => {
  it("keeps Planner focused on planning only", () => {
    expect(planner).not.toContain("SubcontractorQuickAdd");
    expect(planner).not.toContain("Automatic order intake");
    expect(planner).not.toContain("review-orders-link");
    expect(planner).not.toContain("Open Pallet Control");
    expect(planner).toContain("Add Run");
    expect(planner).toContain("Refresh");
  });

  it("removes pallet utilisation from the mixed-unit run builder and gives optimiser more time", () => {
    expect(runBuilder).not.toContain("/ 26 pallets");
    expect(runBuilder).not.toContain("simple-run-pallets");
    expect(optimiser).toContain("180000");
  });

  it("keeps Order Review scoped by a single parent planning date rather than loading every order", () => {
    expect(review).toContain("export function OrderReviewBulk({ date }: { date: string })");
    expect(review).toContain("planningDate=${encodeURIComponent(date)}");
    expect(review).not.toContain("pendingOrderDates");
    expect(review).not.toContain("api.staging(await accessToken(), 'PendingReview', 'order', 2000)");
  });

  it("keeps Pallet Order as three stacked event-driven boards with Site Master delivery headings", () => {
    expect(app).toContain("['/pallet-control', 'Pallet Order']");
    expect(palletControl).toContain('matrix("toPlan", "To Plan"');
    expect(palletControl).toContain('matrix("planned", "Planned"');
    expect(palletControl).toContain('matrix("summary", "Pallet Summary"');
    expect(palletControl).toContain("data.summary.ordered");
    expect(palletControl).toContain("pallet-control-stack");
    expect(palletControl).toContain("destinationLabels");
    expect(palletControl).toContain("pallet-destination-heading");
    expect(palletControl).not.toContain("vertical-destination");
    expect(palletControl).toContain("subscribePlanningChanges");
    expect(palletControl).toContain("30_000");
    expect(palletControl).not.toContain("2000");
    expect(palletControl).toContain("Trays / Crates");
    expect(palletControl).toContain("Trolleys");
    expect(palletControl).not.toContain("Current orders");
  });

  it("removes destructive master uploads and keeps a CSV contingency import", () => {
    expect(master).not.toContain("MasterDataResetImportPanel");
    expect(master).not.toContain("MasterDataUploadSmall");
    expect(imports).toContain("Master data CSV");
  });

  it("uses SQL as the sole master-data write authority and keeps master controls usable", () => {
    expect(master).toContain("SQL is the single operational master");
    expect(master).toContain("SQL is authoritative");
    expect(master).not.toContain("pointerEvents: 'none'");
    expect(master).not.toContain("Lists is the editable master-data authority");
  });

  it("keeps Imports in Admin navigation and makes Control Centre one page", () => {
    expect(app).toContain("['/planner-import', 'Imports']");
    expect(control).not.toContain("useState");
    expect(control).toContain("OperationsControlClean");
    expect(control).toContain("AdminIntegrationSyncControls");
  });

  it("uses lightweight global review counts rather than downloading the review queue", () => {
    expect(app).toContain("/api/v1/staging/count?status=PendingReview&entityType=order");
    expect(app).toContain("120_000");
    expect(app).not.toContain("api.staging(await accessToken(), 'PendingReview', 'order', 2000)");
  });

  it("expands Dashboard into health, attention and feed freshness", () => {
    expect(dashboard).toContain("Today's attention");
    expect(dashboard).toContain("System feeds");
    expect(dashboard).toContain("Operational health");
  });
});