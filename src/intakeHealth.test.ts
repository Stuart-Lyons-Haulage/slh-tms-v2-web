import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("mailbox intake health and review performance", () => {
  it("shows the intake health panel inside Load Review", () => {
    const control = source("./pages/OrderControl.tsx");
    const panel = source("./components/IntakeHealthPanel.tsx");
    expect(control).toContain("<IntakeHealthPanel />");
    expect(panel).toContain('/api/v1/intake-health');
    expect(panel).toContain("Mapping exceptions");
    expect(panel).toContain("Orders extracted");
  });

  it("keeps the active Order Review queue bounded and never requests 2000 rows", () => {
    const review = source("./pages/OrderReviewBulk.tsx");
    expect(review).toContain('api.staging(await token(), "PendingReview", "order", 100)');
    expect(review).not.toContain('"order", 2000');
  });
});
