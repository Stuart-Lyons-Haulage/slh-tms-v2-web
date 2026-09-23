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
};

export type RunSuggestionSite = {
  name: string;
  externalCode: string;
  driverTextName?: string;
  aliases?: string;
  operationalRegion?: string;
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
};

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

      if (sameDestinationCount > 0) {
        score += 24 + Math.min((sameDestinationCount - 1) * 6, 18);
        reasons.push("Already delivering this destination");
        if (sameDestinationCount > 1) reasons.push(`Destination already appears ${sameDestinationCount} times`);
      }
      if (deliveries.has(collection)) {
        score += 12;
        reasons.push("Collects from an existing delivery");
      }
      if (collections.has(collection)) {
        score += 6;
        reasons.push("Same collection");
      }
      if (collections.has(destination)) {
        score += 3;
        reasons.push("Returns towards an existing collection");
      }
      if (direction && directions.has(direction)) {
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

      const availableForType = capacityForOrder(order, remainingCapacity);
      if (score > 0 && availableForType > 0 && order.outstandingPallets <= availableForType) {
        score += 3;
        reasons.push("Fits remaining capacity");
      } else if (score > 0 && order.outstandingPallets > availableForType) {
        score -= 8;
        reasons.push("Exceeds current capacity");
      }

      return { order, score, reasons };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score
      || (deliveryCounts.get(canonicalSiteKey(sites, right.order.destination)) || 0) - (deliveryCounts.get(canonicalSiteKey(sites, left.order.destination)) || 0)
      || left.order.outstandingPallets - right.order.outstandingPallets
      || left.order.reference.localeCompare(right.order.reference))
    .slice(0, limit);
}
