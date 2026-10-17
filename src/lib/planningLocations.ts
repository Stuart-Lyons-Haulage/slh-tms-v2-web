export type PlanningLocationLike = {
  collection?: string | null;
  destination?: string | null;
  originalDestination?: string | null;
};

function normalise(value: unknown) {
  return String(value ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
}

export function planningDeliveryLocation(order: PlanningLocationLike) {
  const collection = String(order.collection ?? "").trim();
  const candidate = String(order.originalDestination || order.destination || "").trim();
  if (!candidate) return "";

  const parts = candidate.split(/\s*(?:→|->)\s*/, 2);
  if (parts.length === 2 && normalise(parts[0]) === normalise(collection)) {
    return parts[1].trim();
  }

  return candidate;
}
