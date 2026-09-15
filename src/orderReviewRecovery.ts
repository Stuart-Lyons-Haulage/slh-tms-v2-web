type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normaliseListPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["items", "records", "results", "data", "value"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function isPagedStagingQueueRequest(url: string) {
  return url.includes("/api/v1/staging/queue");
}

export function shouldRewriteListPayload() {
  return false;
}

export function installOrderReviewRecovery() {
  // Intentionally left as a no-op compatibility export.
  // Order Review now consumes the API contract directly. Do not patch window.fetch here.
}
