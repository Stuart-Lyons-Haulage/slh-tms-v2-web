import { afterEach, describe, expect, it, vi } from "vitest";
import { request, type StagedImport } from "./api";

type StagingQueuePage = {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  records: StagedImport[];
};

describe("staging queue API contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves the paged staging queue envelope from the API client", async () => {
    const record: StagedImport = {
      id: "11111111-1111-1111-1111-111111111111",
      entityType: "order",
      idempotencyKey: "email:message-1:order-1",
      payloadJson: JSON.stringify({ poNumber: "PO-1", collectionDate: "2026-09-15" }),
      status: "PendingReview",
      source: "Email Intake",
      receivedAtUtc: "2026-09-15T08:00:00Z",
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ page: 1, pageSize: 100, total: 215, hasMore: true, records: [record] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    const result = await request<StagingQueuePage>("/api/v2/staging/queue?status=PendingReview&entityType=order&page=1&pageSize=100", "token");

    expect(result).toEqual({ page: 1, pageSize: 100, total: 215, hasMore: true, records: [record] });
    expect(Array.isArray(result)).toBe(false);
    expect(result.records).toHaveLength(1);
  });
});
