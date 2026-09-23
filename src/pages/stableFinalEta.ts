function dateKey(value?: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : undefined;
}

export function stableFinalEta(candidate: string | undefined, fallback: string | undefined, deadline: string | undefined, previous: string | undefined) {
  const candidateMs = candidate ? Date.parse(candidate) : Number.NaN;
  if (!Number.isFinite(candidateMs)) return previous || fallback;
  const now = Date.now();
  const deadlineDay = dateKey(deadline);
  const candidateDay = dateKey(candidate);
  const fallbackMs = fallback ? Date.parse(fallback) : Number.NaN;
  const fallbackDay = dateKey(fallback);
  const previousDay = dateKey(previous);
  // Do not allow a transient overnight calculation to replace a same-day ETA.
  if (deadlineDay && candidateDay !== deadlineDay && (fallbackDay === deadlineDay || previousDay === deadlineDay)) {
    return previous && previousDay === deadlineDay ? previous : fallback;
  }
  // If Run Timing briefly serves an old/past candidate while the live delivery-ETA
  // feed already has a fresh future route, the fresh live route must win. Returning
  // `previous` here used to pin an expired ETA indefinitely (for example 07:24 at
  // midday even though the truck had since departed another geofence).
  if (Number.isFinite(fallbackMs) && fallbackMs > now && candidateMs < now - 15 * 60_000) {
    return fallback;
  }
  return candidate;
}
