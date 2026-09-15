import { describe, expect, it } from "vitest";
import { installOrderReviewRecovery, isPagedStagingQueueRequest, normaliseListPayload, shouldRewriteListPayload } from "./orderReviewRecovery";

describe("normaliseListPayload", () => {
  it("keeps array responses unchanged", () => {
    const rows = [{ id: "1" }, { id: "2" }];
    expect(normaliseListPayload(rows)).toBe(rows);
  });

  it("can still read legacy envelopes for deliberate local callers", () => {
    expect(normaliseListPayload({ items: [{ id: "1" }] })).toEqual([{ id: "1" }]);
    expect(normaliseListPayload({ records: [{ id: "2" }] })).toEqual([{ id: "2" }]);
    expect(normaliseListPayload({ data: [{ id: "3" }] })).toEqual([{ id: "3" }]);
  });

  it("returns an empty list for malformed non-array payloads", () => {
    expect(normaliseListPayload({ unexpected: true })).toEqual([]);
    expect(normaliseListPayload(null)).toEqual([]);
    expect(normaliseListPayload("bad response")).toEqual([]);
  });
});

describe("Order Review recovery endpoint handling", () => {
  it("does not rewrite the paged staging queue envelope used by Email Intake V2", () => {
    const url = "/api/v1/staging/queue?status=PendingReview&entityType=order&page=1&pageSize=100";

    expect(isPagedStagingQueueRequest(url)).toBe(true);
    expect(shouldRewriteListPayload(url)).toBe(false);
  });

  it("does not rewrite legacy staging or master-data list endpoints", () => {
    expect(shouldRewriteListPayload("/api/v1/staging?status=PendingReview&entityType=order")).toBe(false);
    expect(shouldRewriteListPayload("/api/v1/operational-master-data/sites/search?q=coop")).toBe(false);
    expect(shouldRewriteListPayload("/api/v1/operational-master-data/geofences/search?q=coop")).toBe(false);
  });

  it("keeps the compatibility installer as a no-op", () => {
    expect(() => installOrderReviewRecovery()).not.toThrow();
  });
});
