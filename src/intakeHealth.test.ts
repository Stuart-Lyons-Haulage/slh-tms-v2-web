import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("mailbox intake health and review performance", () => {
  it("shows the intake health panel in Operations Control, not Order Review", () => {
    const control = source("./pages/OrderControl.tsx");
    const operations = source("./pages/OperationsControlClean.tsx");
    const panel = source("./components/IntakeHealthPanel.tsx");
    expect(control).not.toContain("<IntakeHealthPanel />");
    expect(operations).toContain("<IntakeHealthPanel />");
    expect(panel).toContain('/api/v2/intake-health');
    expect(panel).toContain("Mapping exceptions");
    expect(panel).toContain("Orders extracted");
  });

  it("uses one retained Order Control date for review and approved jobs", () => {
    const control = source("./pages/OrderControl.tsx");
    expect(control).toContain('searchParams.get("date") || localDate()');
    expect(control).toContain("<OrderReviewBulk date={selectedDate} />");
    expect(control).toContain("<JobsOperational date={selectedDate} />");
    expect(control).not.toContain("Info mailbox → load review → live planning");
  });

  it("uses the lightweight paged Order Review queue and never requests 2000 staging rows", () => {
    const review = source("./pages/OrderReviewBulk.tsx");
    expect(review).toContain('/api/v2/staging/queue?status=PendingReview&entityType=order&page=');
    expect(review).toContain("planningDate=${encodeURIComponent(date)}");
    expect(review).toContain("const queuePageSize = 100");
    expect(review).not.toContain('api.staging(await token(), "PendingReview", "order", 2000)');
  });
});
