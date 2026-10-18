import { request } from "./api";
import { shiftIsoDate } from "./workingDate";
import { todayIsoDate } from "./dateUtils";

/**
 * Orders waiting for review, per collection date, from a week back to a fortnight ahead.
 * The header badge and Today both need it; this keeps one copy for 30 seconds and shares
 * a request already on its way, so the two never ask the server separately.
 */
export type ReviewCounts = Record<string, number>;

const FRESH_MS = 30_000;
let cached: { at: number; day: string; counts: ReviewCounts } | undefined;
let inFlight: Promise<ReviewCounts> | undefined;

export function pendingReviewCounts(token: () => Promise<string>, options: { force?: boolean } = {}): Promise<ReviewCounts> {
  const day = todayIsoDate();
  if (!options.force && cached && cached.day === day && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.counts);
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const counts = await request<ReviewCounts>(`/api/v1/staging/queue/date-counts?from=${shiftIsoDate(day, -7)}&to=${shiftIsoDate(day, 14)}`, await token());
      cached = { at: Date.now(), day, counts };
      return counts;
    } finally { inFlight = undefined; }
  })();
  return inFlight;
}

/** Only the dates between from and to (inclusive). */
export function countsBetween(counts: ReviewCounts, from: string, to: string): ReviewCounts {
  return Object.fromEntries(Object.entries(counts).filter(([date]) => date >= from && date <= to));
}
