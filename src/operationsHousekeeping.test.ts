import { describe, expect, it } from "vitest";
import app from "./App.tsx?raw";
import optimiser from "./components/OptimiserProposalReview.tsx?raw";
import dashboard from "./pages/DashboardOperational.tsx?raw";
import master from "./pages/MasterDataHub.tsx?raw";
import pages from "./pages/Pages.tsx?raw";
import integrations from "./components/AdminIntegrationSyncControls.tsx?raw";
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

  it("moves governed master imports into Admin Imports and keeps Master Data maintenance-only", () => {
    expect(master).not.toContain("MasterDataResetImportPanel");
    expect(master).not.toContain("MasterDataUploadSmall");
    expect(master).not.toContain("MasterDataCsvImport");
    expect(pages).toContain("import { MasterDataCsvImport }");
    expect(app).toContain('path="/admin/imports" element={<StagingQueue masterOnly />}');
    expect(app).toContain('path="/staging" element={<StagingQueue ordersOnly />}');
  });

  it("uses SQL as the sole master-data write authority and keeps master controls usable", () => {
    expect(master).toContain("SQL is the single operational master");
    expect(master).toContain("Admin → Imports");
    expect(master).not.toContain("pointerEvents: 'none'");
    expect(master).not.toContain("Lists is the editable master-data authority");
  });

  it("keeps Admin focused on API feeds, order intake rules and master imports only", () => {
    expect(app).not.toContain("Admin Home");
    expect(app).not.toContain("RoadRunner Review");
    expect(app).toContain("['/admin/integrations', 'API Feeds']");
    expect(app).toContain("['/admin/imports', 'Imports']");
    expect(app).toContain('path="/admin" element={<Navigate to="/admin/integrations" replace />}');
    expect(integrations).toContain("API Feeds & Integrations");
    expect(integrations).toContain("single TMS source for external API/feed health");
  });

  it("keeps Planner Builder full-width and leaves order selection to Pallet Order", () => {
    expect(runBuilder).not.toContain('className="simple-order-pool"');
    expect(runBuilder).toContain('datalist id="planner-site-options"');
    expect(runBuilder).toContain('list="planner-site-options"');
    expect(runBuilder).toContain("Use Pallet Order on the second screen to allocate work");
    expect(runBuilder).toContain("orderLineNote(order)");
    expect(runBuilder).toContain("mergedOrderLineNote");
  });



  it("keeps Dashboard focused on daily transport control and feed freshness", () => {
    expect(dashboard).toContain("Daily transport control");
    expect(dashboard).toContain("System feeds");
    expect(dashboard).toContain("Data freshness");
    expect(dashboard).toContain("Planner Builder");
    expect(dashboard).toContain("Master Data");
    expect(dashboard).toContain("Compliance");
  });
});
