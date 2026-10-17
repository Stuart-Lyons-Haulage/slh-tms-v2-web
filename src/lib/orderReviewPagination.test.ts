import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("Order Review pagination", () => {
  it("uses the server-paged lightweight queue and caps each page at 100", () => {
    const review = source("../pages/OrderReviewBulk.tsx");
    expect(review).toContain("/api/v1/staging/queue?status=PendingReview&entityType=order&page=");
    expect(review).toContain("const queuePageSize = 100");
    expect(review).toContain("queue.data?.records");
    expect(review).not.toContain("api.staging(await token(), \"PendingReview\", \"order\", 100)");
    expect(review).not.toContain("api.staging(await token(), \"PendingReview\", \"order\", 2000)");
  });

  it("loads the complete staged payload only when edit is opened", () => {
    const review = source("../pages/OrderReviewBulk.tsx");
    expect(review).toContain("const detail = await request<StagedImport>(`/api/v1/staging/${row.item.id}`");
    expect(review).toContain("setDraft(parsedDetail.payload)");
  });

  it("removes the unused legacy 2000-row Order Review implementation", () => {
    let legacyExists = true;
    try {
      readFileSync(new URL("../pages/OrderReviewOperational.tsx", import.meta.url), "utf8");
    } catch {
      legacyExists = false;
    }
    expect(legacyExists).toBe(false);
  });
});
