import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reviewSource = readFileSync(new URL("./OrderReviewBulk.tsx", import.meta.url), "utf8");
const controlSource = readFileSync(new URL("./OrderControl.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("./DashboardOperational.tsx", import.meta.url), "utf8");
const drawerSource = readFileSync(new URL("../components/SourceEmailEvidenceDrawer.tsx", import.meta.url), "utf8");

describe("Order Review source email evidence", () => {
  it("offers source evidence directly from flagged bookings", () => {
    expect(reviewSource).toContain("Review source email");
    expect(reviewSource).toContain("SourceEmailEvidenceDrawer");
    expect(reviewSource).toContain("bulk-row-warning");
    expect(reviewSource).toContain("setSourceEmailStagingId(row.item.id)");
  });

  it("loads retained email evidence inside the TMS instead of requiring Outlook", () => {
    expect(drawerSource).toContain("/api/v1/order-intake/source-email/");
    expect(drawerSource).toContain("Email body");
    expect(drawerSource).toContain("Attachments");
    expect(drawerSource).not.toContain("Open original in Outlook");
  });

  it("normalises legacy recipient and attachment shapes before array operations", () => {
    expect(drawerSource).toContain("function normaliseArray<T>");
    expect(drawerSource).toContain("normaliseArray<Recipient>(items).map");
    expect(drawerSource).toContain("normaliseArray<Attachment>(evidence?.attachments).filter");
    expect(drawerSource).toContain("JSON.parse(trimmed)");
  });

  it("opens the exact source email when an Order Review attention item is clicked", () => {
    expect(dashboardSource).toContain("date=${encodeURIComponent(date)}&reviewId=");
    expect(dashboardSource).toContain("&sourceEmail=1");
    expect(controlSource).toContain('searchParams.get("reviewId")');
    expect(controlSource).toContain('searchParams.get("sourceEmail") === "1"');
    expect(controlSource).toContain("SourceEmailEvidenceDrawer");
  });
});
