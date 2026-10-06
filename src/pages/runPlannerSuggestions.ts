export type RunSuggestionLine = {
  orderId?: string;
  collectionSite: string;
  deliverySite: string;
  pallets?: string;
};

export type RunSuggestionOrder = {
  id: string;
  reference: string;
  collection: string;
  destination: string;
  outstandingPallets: number;
  palletType?: string;
  loadUnitType?: string;
};

export type RunSuggestionSite = {
  name: string;
  externalCode: string;
  driverTextName?: string;
  aliases?: string;
  operationalRegion?: string;
  latitude?: number;
  longitude?: number;
  active?: boolean;
};

export type RunHistoryStop = {
  sequence: number;
  name: string;
};

export type RunHistoryRecord = {
  planningDate: string;
  status: string;
  stops: RunHistoryStop[];
};

export type RunHistoryAffinity = Map<string, number>;
export type RemainingCapacity = number | { standard: number; euro: number };

export type RunJobSuggestion<TOrder extends RunSuggestionOrder = RunSuggestionOrder> = {
  order: TOrder;
  score: number;
  reasons: string[];
  connectorMiles?: number;
};

// The scoring signals below add up to 91 at their strongest. Keep the raw
// score for sorting, but expose a bounded percentage to planners.
const MAX_SUGGESTION_SCORE = 91;

export function suggestionConfidencePercent(score: number) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round((score / MAX_SUGGESTION_SCORE) * 100)));
}

const normalise = (value: unknown) => String(value ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();

function siteFor(sites: RunSuggestionSite[], value: string) {
  const target = normalise(value);
  if (!target) return undefined;
  return sites.find((site) => [
    site.name,
    site.driverTextName,
    site.externalCode,
    ...(site.aliases || "").split(/[,;|]/),
  ].some((candidate) => normalise(candidate) === target));
}

function canonicalSiteKey(sites: RunSuggestionSite[], value: string) {
  const site = siteFor(sites, value);
  if (site) return normalise(site.name || site.driverTextName || site.externalCode);
  const key = normalise(value);
  if (/MORRISONS(?:FRUIT)?STOCKTON\d*/.test(key)) return "MORRISONSSTOCKTON";
  return key;
}

function regionFor(sites: RunSuggestionSite[], value: string) {
  return normalise(siteFor(sites, value)?.operationalRegion);
}

function haversineMiles(left?: RunSuggestionSite, right?: RunSuggestionSite) {
  if (left?.latitude == null || left.longitude == null || right?.latitude == null || right.longitude == null) return undefined;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthMiles = 3958.7613;
  const dLat = radians(right.latitude - left.latitude);
  const dLon = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeKey(sites: RunSuggestionSite[], collection: string, destination: string) {
  return `${canonicalSiteKey(sites, collection)}->${canonicalSiteKey(sites, destination)}`;
}

function pairKey(left: string, right: string) {
  return left < right ? `${left}||${right}` : `${right}||${left}`;
}

function stopLocation(name: string, prefix: "collect" | "deliver") {
  const match = name.match(new RegExp(`^${prefix}\\s*[·:-]?\\s*(.+)$`, "i"));
  return match?.[1]?.trim() || "";
}

function routesFromHistoryRun(run: RunHistoryRecord, sites: RunSuggestionSite[]) {
  const stops = [...run.stops].sort((left, right) => left.sequence - right.sequence);
  const routes: string[] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const collection = stopLocation(stops[index].name, "collect");
    const destination = stopLocation(stops[index + 1].name, "deliver");
    if (!collection || !destination) continue;
    routes.push(routeKey(sites, collection, destination));
    index += 1;
  }
  return [...new Set(routes.filter((route) => !route.startsWith("->") && !route.endsWith("->")))];
}

function capacityForOrder(order: RunSuggestionOrder, remaining: RemainingCapacity) {
  if (typeof remaining === "number") return Math.max(remaining, 0);
  const type = String(order.palletType || "").toLowerCase();
  if (type.includes("euro")) return Math.max(remaining.euro, 0);
  if (type.includes("standard") || type.includes("std")) return Math.max(remaining.standard, 0);
  return Math.min(Math.max(remaining.standard, 0), Math.max(remaining.euro, 0));
}

export function buildHistoricalRouteAffinity(
  runs: RunHistoryRecord[],
  sites: RunSuggestionSite[],
  beforeDate = new Date().toISOString().slice(0, 10),
  lookbackDays = 90,
): RunHistoryAffinity {
  const before = new Date(`${beforeDate}T23:59:59`);
  const earliest = new Date(before);
  earliest.setDate(earliest.getDate() - lookbackDays);
  const affinity: RunHistoryAffinity = new Map();

  for (const run of runs) {
    if (/cancel/i.test(run.status)) continue;
    const runDate = new Date(`${run.planningDate}T12:00:00`);
    if (Number.isNaN(runDate.valueOf()) || runDate > before || runDate < earliest) continue;
    const routes = routesFromHistoryRun(run, sites);
    for (let left = 0; left < routes.length; left += 1) {
      for (let right = left + 1; right < routes.length; right += 1) {
        const key = pairKey(routes[left], routes[right]);
        affinity.set(key, (affinity.get(key) || 0) + 1);
      }
    }
  }

  return affinity;
}

export function suggestJobsForRun<TOrder extends RunSuggestionOrder>(
  lines: RunSuggestionLine[],
  candidates: TOrder[],
  sites: RunSuggestionSite[],
  remainingCapacity: RemainingCapacity,
  limit = 6,
  historicalAffinity: RunHistoryAffinity = new Map(),
): RunJobSuggestion<TOrder>[] {
  const usedLines = lines.filter((line) => line.orderId || line.collectionSite.trim() || line.deliverySite.trim());
  if (!usedLines.length) return [];

  const currentOrderIds = new Set(usedLines.flatMap((line) => line.orderId ? [line.orderId] : []));
  const collections = new Set(usedLines.map((line) => canonicalSiteKey(sites, line.collectionSite)).filter(Boolean));
  const deliveryCounts = new Map<string, number>();
  usedLines.forEach((line) => {
    const key = canonicalSiteKey(sites, line.deliverySite);
    if (key) deliveryCounts.set(key, (deliveryCounts.get(key) || 0) + 1);
  });
  const deliveries = new Set(deliveryCounts.keys());
  const collectionRegions = new Set(usedLines.map((line) => regionFor(sites, line.collectionSite)).filter(Boolean));
  const deliveryRegions = new Set(usedLines.map((line) => regionFor(sites, line.deliverySite)).filter(Boolean));
  const directions = new Set(usedLines.map((line) => {
    const from = regionFor(sites, line.collectionSite);
    const to = regionFor(sites, line.deliverySite);
    return from && to ? `${from}->${to}` : "";
  }).filter(Boolean));
  const currentRoutes = [...new Set(usedLines.map((line) => routeKey(sites, line.collectionSite, line.deliverySite)).filter(Boolean))];
  const lastLine = usedLines.at(-1);
  const lastDeliverySite = lastLine ? siteFor(sites, lastLine.deliverySite) : undefined;

  return candidates
    .filter((order) => order.outstandingPallets > 0 && !currentOrderIds.has(order.id))
    .map((order) => {
      let score = 0;
      const reasons: string[] = [];
      const collection = canonicalSiteKey(sites, order.collection);
      const destination = canonicalSiteKey(sites, order.destination);
      const collectionRegion = regionFor(sites, order.collection);
      const destinationRegion = regionFor(sites, order.destination);
      const direction = collectionRegion && destinationRegion ? `${collectionRegion}->${destinationRegion}` : "";
      const sameDestinationCount = deliveryCounts.get(destination) || 0;
      const collectionSite = siteFor(sites, order.collection);
      const destinationSite = siteFor(sites, order.destination);
      const connectorMiles = haversineMiles(lastDeliverySite, collectionSite);
      const nearbyContinuation = connectorMiles != null && connectorMiles <= 35;
      const sameLane = Boolean(direction && directions.has(direction));
      const sameCollection = collections.has(collection);
      const sameDestinationCollectionMiles = sameDestinationCount > 0
        ? Math.min(...usedLines
          .filter((line) => canonicalSiteKey(sites, line.deliverySite) === destination)
          .map((line) => haversineMiles(siteFor(sites, line.collectionSite), collectionSite) ?? Number.POSITIVE_INFINITY))
        : Number.POSITIVE_INFINITY;
      const sameCollectionDestinationMiles = sameCollection
        ? Math.min(...usedLines
          .filter((line) => canonicalSiteKey(sites, line.collectionSite) === collection)
          .map((line) => haversineMiles(siteFor(sites, line.deliverySite), destinationSite) ?? Number.POSITIVE_INFINITY))
        : Number.POSITIVE_INFINITY;
      const coherentSharedCollection = sameCollection
        && (sameCollectionDestinationMiles <= 60 || (!Number.isFinite(sameCollectionDestinationMiles) && sameLane));
      const coherentSharedDestination = sameDestinationCount > 0
        && (sameDestinationCollectionMiles <= 60 || !Number.isFinite(sameDestinationCollectionMiles));

      if (coherentSharedDestination) {
        score += 24 + Math.min((sameDestinationCount - 1) * 6, 18);
        reasons.push("Already delivering this destination");
        if (sameDestinationCount > 1) reasons.push(`Destination already appears ${sameDestinationCount} times`);
      }
      if (deliveries.has(collection)) {
        score += 12;
        reasons.push("Collects from an existing delivery");
      }
      if (coherentSharedCollection) {
        score += 6;
        reasons.push("Same collection");
      }
      if (collections.has(destination)) {
        score += 3;
        reasons.push("Returns towards an existing collection");
      }
      if (sameLane) {
        score += 4;
        reasons.push("Same directional flow");
      } else {
        if (collectionRegion && collectionRegions.has(collectionRegion)) {
          score += 2;
          reasons.push("Same collection region");
        }
        if (destinationRegion && deliveryRegions.has(destinationRegion)) {
          score += 3;
          reasons.push("Same delivery region");
        }
      }

      const candidateRoute = routeKey(sites, order.collection, order.destination);
      const historicalCount = currentRoutes.reduce((best, currentRoute) => Math.max(
        best,
        currentRoute === candidateRoute ? 0 : historicalAffinity.get(pairKey(candidateRoute, currentRoute)) || 0,
      ), 0);
      if (historicalCount > 0) {
        score += Math.min(historicalCount * 2, 12);
        reasons.push(`Planned with this flow ${historicalCount} time${historicalCount === 1 ? "" : "s"} recently`);
      }

      if (nearbyContinuation && !deliveries.has(collection)) {
        score += connectorMiles! <= 15 ? 8 : 4;
        reasons.push(`Approx. ${Math.round(connectorMiles!)} mile reposition from the current final delivery`);
      } else if (connectorMiles != null && connectorMiles > 75 && !sameDestinationCount && !coherentSharedCollection) {
        score -= 12;
        reasons.push(`Approx. ${Math.round(connectorMiles)} mile reposition makes this a weak fit`);
      }

      const availableForType = capacityForOrder(order, remainingCapacity);
      const hasLogisticalFit = (sameDestinationCount > 0 && coherentSharedDestination)
        || deliveries.has(collection)
        || coherentSharedCollection
        || sameLane
        || historicalCount > 0
        || nearbyContinuation;
      if (hasLogisticalFit && score > 0 && availableForType > 0 && order.outstandingPallets <= availableForType) {
        score += 3;
        reasons.push("Fits remaining capacity");
      } else if (hasLogisticalFit && score > 0 && order.outstandingPallets > availableForType) {
        score -= 8;
        reasons.push("Exceeds current capacity");
      }

      return { order, score, reasons, connectorMiles };
    })
    .filter((item) => item.score > 0 && item.reasons.some((reason) =>
      reason === "Already delivering this destination"
      || reason === "Collects from an existing delivery"
      || reason === "Same collection"
      || reason === "Same directional flow"
      || reason.startsWith("Planned with this flow")
      || reason.includes("mile reposition from")))
    .sort((left, right) => right.score - left.score
      || (deliveryCounts.get(canonicalSiteKey(sites, right.order.destination)) || 0) - (deliveryCounts.get(canonicalSiteKey(sites, left.order.destination)) || 0)
      || (left.connectorMiles ?? Number.POSITIVE_INFINITY) - (right.connectorMiles ?? Number.POSITIVE_INFINITY)
      || left.order.reference.localeCompare(right.order.reference))
    .slice(0, limit);
}
