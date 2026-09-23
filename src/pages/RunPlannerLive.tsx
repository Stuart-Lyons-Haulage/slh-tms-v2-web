import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type Load, type Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { startVisiblePolling } from "../lib/visiblePolling";
import { RunJobSuggestions } from "../components/RunJobSuggestions";
import "../simple-planner.css";
import { createRun, listRuns, updateRunStops } from '../api/runs';

type Period = "" | "AM" | "PM";
type PeriodFilter = "ALL" | "AM" | "PM";
type Allocation = { loadId: string; loadReference?: string; pallets: number };
type PlanningOrder = {
  id: string;
  reference: string;
  customerCode: string;
  orderedPallets: number;
  plannedPallets: number;
  outstandingPallets: number;
  collection: string;
  destination: string;
  source?: string;
  temperature?: string;
  palletType?: string;
  loadUnitType?: string;
  allocations: Allocation[];
};
type PlanningControlData = {
  date: string;
  generatedAtUtc: string;
  orders: PlanningOrder[];
  summary: { ordered: number; planned: number; outstanding: number };
};
type AllocationResult = {
  orderId: string;
  loadId: string;
  allocatedToRun: number;
  plannedPallets: number;
  orderedPallets: number;
  outstandingPallets: number;
  overplannedPallets: number;
};
type RunLine = {
  key: string;
  orderId?: string;
  orderIds?: string[];
  orderAllocations?: Record<string, number>;
  collectionSite: string;
  deliverySite: string;
  pallets: string;
  note: string;
};
type RunDraft = { key: string; loadId?: string; period: Period; nightOut: boolean; operationalAmendment: string; lines: RunLine[] };
type OrderClusterKey = "markets" | "south-to-north" | "southbound" | "northbound" | "south-local" | "midlands" | "east" | "west-wales" | "other";
type PlanningMovement = {
  key: string;
  collection: string;
  destination: string;
  orderedPallets: number;
  outstandingPallets: number;
  orders: PlanningOrder[];
};
type OrderCluster = { key: OrderClusterKey; label: string; note: string; movements: PlanningMovement[]; pallets: number };

const blankLine = (): RunLine => ({ key: crypto.randomUUID(), collectionSite: "", deliverySite: "", pallets: "", note: "" });
const blankRun = (key: string): RunDraft => ({
  key,
  period: "",
  nightOut: false,
  operationalAmendment: "",
  lines: [blankLine()],
});
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const normalise = (value: unknown) => String(value ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
const tagged = (notes: string | undefined, label: string) => (notes || "")
  .split("·")
  .map((part) => part.trim())
  .find((part) => part.toLowerCase().startsWith(`${label}:`.toLowerCase()))
  ?.slice(label.length + 1)
  .trim() || "";
const periodFromLoad = (load: Load): Period => {
  const period = tagged(load.plannerNotes, "Planner period").toUpperCase();
  return period === "AM" || period === "PM" ? period : "";
};
const overnightFromLoad = (load: Load) => Boolean(load.overnight || load.nightOutRequired || plannerBoolean(load.plannerNotes, "Night out") || /\b(?:O\/N|overnight)\b/i.test(load.plannerNotes || ""));
const withPlannerPeriod = (notes: string | undefined, period: Period) => {
  const parts = (notes || "").split("·").map((part) => part.trim()).filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith("planner period:"))
    .filter((part) => !part.toLowerCase().startsWith("route/job:"));
  return period ? [`Planner period: ${period}`, ...parts].join(" · ") : parts.join(" · ");
};
const plannerTag = (notes: string | undefined, label: string, value: string) => {
  const parts = (notes || "").split("·").map((part) => part.trim()).filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  return value.trim() ? [`${label}: ${value.trim()}`, ...parts].join(" · ") : parts.join(" · ");
};
const plannerBoolean = (notes: string | undefined, label: string) => tagged(notes, label).toLowerCase() === "yes";
const siteFor = (sites: Site[], value: string) => {
  const target = normalise(value);
  if (!target) return undefined;
  return sites.find((site) =>
    [site.name, site.driverTextName, site.externalCode, ...(site.aliases || "").split(/[,;|]/)]
      .some((candidate) => normalise(candidate) === target));
};
const plannerSiteName = (sites: Site[], value: string) => {
  const site = siteFor(sites, value);
  if (site) return site.name?.trim() || site.driverTextName?.trim() || value;
  const key = normalise(value);
  if (/MORRISONS(?:FRUIT)?STOCKTON\d*/.test(key)) return "Morrisons Stockton";
  return value;
};
const stopFromSite = (sites: Site[], value: string) => {
  const site = siteFor(sites, value);
  return { address: site?.collectionAddress, latitude: site?.latitude, longitude: site?.longitude };
};
const runRef = (date: string, number: number) => `RUN-${date.replaceAll("-", "")}-${String(number).padStart(2, "0")}`;
const canonicalRegion = (value?: string) => normalise(value);
const SOUTH_REGIONS = new Set(["LONDON", "SOUTHEAST", "SOUTHWEST"]);
const NORTH_REGIONS = new Set(["NORTH"]);

function regionForSite(sites: Site[], value: string) {
  return canonicalRegion(siteFor(sites, value)?.operationalRegion);
}

function matchesMarket(value: string, marketNames: string[]) {
  if (/\bmarket\b/i.test(value)) return true;
  const key = normalise(value);
  return Boolean(key) && marketNames.some((market) => {
    const marketKey = normalise(market);
    return marketKey.length >= 3 && (key === marketKey || key.includes(marketKey) || marketKey.includes(key));
  });
}

function clusterForOrder(order: PlanningOrder, sites: Site[], marketNames: string[]): OrderClusterKey {
  if (matchesMarket(order.collection, marketNames) || matchesMarket(order.destination, marketNames)) return "markets";
  const collectionRegion = regionForSite(sites, order.collection);
  const destinationRegion = regionForSite(sites, order.destination);
  const collectionSouth = SOUTH_REGIONS.has(collectionRegion);
  const destinationSouth = SOUTH_REGIONS.has(destinationRegion);
  const destinationNorth = NORTH_REGIONS.has(destinationRegion);
  if (collectionSouth && destinationNorth) return "south-to-north";
  if (!collectionSouth && destinationSouth) return "southbound";
  if (destinationNorth) return "northbound";
  if (collectionSouth && destinationSouth) return "south-local";
  if (destinationRegion === "MIDLANDS") return "midlands";
  if (destinationRegion === "EAST") return "east";
  if (destinationRegion === "WESTWALES") return "west-wales";
  return "other";
}

function orderTypeLabel(order: PlanningOrder, sites: Site[], marketNames: string[]) {
  const evidence = `${order.source || ""} ${order.collection} ${order.destination}`;
  if (/\bback\s*load\b/i.test(evidence)) return "Backload";
  if (clusterForOrder(order, sites, marketNames) === "markets" || /\bmarket\b/i.test(evidence)) return "Market";
  if (/\btransfer\b/i.test(evidence)) return "Transfer";
  if (/\breturn(?:s)?\b/i.test(evidence)) return "Return";
  if (/\bpre[-\s]?load\b/i.test(evidence)) return "Preload";
  const source = String(order.source || "").trim();
  if (source && source.length <= 24 && !/mail|email|import|parser|workbook|csv/i.test(source)) return source;
  return "Delivery";
}

function movementKey(order: PlanningOrder, sites: Site[], marketNames: string[]) {
  const collection = normalise(plannerSiteName(sites, order.collection));
  const destination = normalise(plannerSiteName(sites, order.destination));
  const handling = [normalise(order.temperature), normalise(order.palletType), normalise(order.loadUnitType)].join("|");
  // Market orders stay separate unless richer stall/stand identity is available on the planning row.
  const marketIdentity = clusterForOrder(order, sites, marketNames) === "markets" ? `|MARKET|${order.id}` : "";
  return `${collection}|${destination}|${handling}${marketIdentity}`;
}

function lineOrderIds(line: RunLine) {
  return line.orderIds?.length ? line.orderIds : line.orderId ? [line.orderId] : [];
}

function validPallets(value: string) {
  const pallets = Number(value);
  return Number.isInteger(pallets) && pallets >= 0 ? pallets : undefined;
}

const CLUSTER_DEFINITIONS: Array<{ key: OrderClusterKey; label: string; note: string }> = [
  { key: "south-to-north", label: "South → North", note: "Northbound work originating in London, South East or South West" },
  { key: "northbound", label: "Northbound", note: "Other work whose destination is in the North" },
  { key: "southbound", label: "Southbound", note: "Work heading into London, South East or South West" },
  { key: "markets", label: "Markets", note: "Market work kept together regardless of direction" },
  { key: "south-local", label: "South / Local", note: "South-origin work remaining within the southern regions" },
  { key: "midlands", label: "Midlands", note: "Work whose destination is in the Midlands" },
  { key: "east", label: "East", note: "Work whose destination is in the East" },
  { key: "west-wales", label: "West / Wales", note: "Work whose destination is in West / Wales" },
  { key: "other", label: "Other / Region not mapped", note: "Orders needing Site Master region or market mapping" },
];

export function RunPlannerLive({ planningDate }: { planningDate?: string } = {}) {
  const token = useAccessToken();
  const dateIsExternallyControlled = Boolean(planningDate);
  const [date, setDate] = useState(planningDate || localDate());
  const [control, setControl] = useState<PlanningControlData>();
  const [loads, setLoads] = useState<Load[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [marketNames, setMarketNames] = useState<string[]>([]);
  const [runs, setRuns] = useState<RunDraft[]>(() => [blankRun(`shell-${localDate()}-1`)]);
  const [activeKey, setActiveKey] = useState(runs[0].key);
  const [busyKey, setBusyKey] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [query, setQuery] = useState("");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("ALL");
  const saveTimers = useRef<Record<string, number>>({});
  const mutationCounter = useRef(0);

  const consolidateLines = useCallback((rawLines: RunLine[], ordersById: Map<string, PlanningOrder>) => {
    const groups = new Map<string, RunLine>();
    for (const line of rawLines) {
      if (!line.orderId) {
        groups.set(line.key, line);
        continue;
      }
      const order = ordersById.get(line.orderId);
      const market = order ? /\bmarket\b/i.test(`${order.source || ""} ${order.collection} ${order.destination}`) : false;
      const key = order
        ? `${normalise(line.collectionSite)}|${normalise(line.deliverySite)}|${normalise(order.temperature)}|${normalise(order.palletType)}|${normalise(order.loadUnitType)}${market ? `|${order.id}` : ""}`
        : line.key;
      const pallets = validPallets(line.pallets) || 0;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { ...line, orderIds: [line.orderId], orderAllocations: { [line.orderId]: pallets } });
        continue;
      }
      const ids = [...new Set([...lineOrderIds(existing), line.orderId])];
      groups.set(key, {
        ...existing,
        orderIds: ids,
        orderAllocations: { ...(existing.orderAllocations || {}), [line.orderId]: pallets },
        pallets: String((validPallets(existing.pallets) || 0) + pallets),
        note: [existing.note, line.note].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(" · "),
      });
    }
    return [...groups.values()];
  }, []);

  const hydrate = useCallback((nextControl: PlanningControlData, nextLoads: Load[], nextSites: Site[]) => {
    const ordered = [...nextLoads].sort((left, right) => String(left.reference).localeCompare(String(right.reference)));
    if (!ordered.length) {
      const shell = blankRun(`shell-${date}-1`);
      setRuns([shell]);
      setActiveKey(shell.key);
      return;
    }
    const ordersById = new Map(nextControl.orders.map((order) => [order.id, order]));
    const drafts = ordered.map((load) => {
      const seenOrderIds = new Set<string>();
      const sequencedLines = [...load.stops]
        .filter((stop) => Boolean(stop.orderId) && /^deliver/i.test(stop.name))
        .sort((left, right) => left.sequence - right.sequence)
        .flatMap((stop) => {
          const orderId = stop.orderId;
          if (!orderId || seenOrderIds.has(orderId)) return [];
          const order = ordersById.get(orderId);
          const allocation = order?.allocations.find((item) => item.loadId === load.id && item.pallets > 0);
          if (!order || !allocation) return [];
          seenOrderIds.add(order.id);
          return [{ key: `${load.id}-${order.id}`, orderId: order.id, collectionSite: plannerSiteName(nextSites, order.collection), deliverySite: plannerSiteName(nextSites, order.destination), pallets: String(allocation.pallets), note: stop.plannerNote || "" }];
        });
      const unsequencedLines = nextControl.orders.flatMap((order) => {
        if (seenOrderIds.has(order.id)) return [];
        const allocation = order.allocations.find((item) => item.loadId === load.id && item.pallets > 0);
        return allocation ? [{ key: `${load.id}-${order.id}`, orderId: order.id, collectionSite: plannerSiteName(nextSites, order.collection), deliverySite: plannerSiteName(nextSites, order.destination), pallets: String(allocation.pallets), note: load.stops.find((stop) => stop.orderId === order.id && /^deliver/i.test(stop.name))?.plannerNote || "" }] : [];
      });
      const lines = consolidateLines([...sequencedLines, ...unsequencedLines], ordersById);
      return {
        key: load.id,
        loadId: load.id,
        period: periodFromLoad(load),
        nightOut: overnightFromLoad(load),
        operationalAmendment: tagged(load.plannerNotes, "Operational amendment"),
        lines: lines.length ? lines : [blankLine()],
      } satisfies RunDraft;
    });
    setRuns(drafts);
    setActiveKey((current) => drafts.some((run) => run.key === current) ? current : drafts[0].key);
  }, [consolidateLines, date]);

  const refreshAll = useCallback(async () => {
    const access = await token();
    const nextControl = await request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, access);
    const [loadsResult, sitesResult, marketsResult] = await Promise.allSettled([listRuns(date, access), api.sites(access), api.marketContacts(access)]);
    const safeLoads = loadsResult.status === "fulfilled" && Array.isArray(loadsResult.value) ? loadsResult.value : [];
    const safeSites = sitesResult.status === "fulfilled" && Array.isArray(sitesResult.value) ? sitesResult.value : [];
    const safeMarkets = marketsResult.status === "fulfilled" && Array.isArray(marketsResult.value) ? marketsResult.value : [];
    setControl(nextControl);
    setLoads(safeLoads);
    setSites(safeSites);
    setMarketNames([...new Set(safeMarkets.map((item) => String(item.market || "").trim()).filter(Boolean))]);
    if (loadsResult.status === "rejected" || sitesResult.status === "rejected" || marketsResult.status === "rejected") setMessage("Planner loaded the approved pallet balance. Some run, site or market master data is temporarily unavailable.");
    hydrate(nextControl, safeLoads, safeSites);
  }, [date, hydrate, token]);

  const refreshControl = useCallback(async () => {
    const nextControl = await request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, await token());
    setControl(nextControl);
  }, [date, token]);

  useEffect(() => {
    void refreshAll().catch((error) => setMessage(error instanceof Error ? error.message : "Planner data could not be refreshed."));
    return () => {
      Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
      saveTimers.current = {};
    };
  }, [refreshAll]);

  useEffect(() => {
    const refresh = () => void refreshControl().catch(() => undefined);
    const stopPolling = startVisiblePolling(refresh, 30_000);
    const unsubscribe = subscribePlanningChanges(refresh);
    return () => { stopPolling(); unsubscribe(); };
  }, [refreshControl]);

  const orders = useMemo(() => control?.orders || [], [control]);

  const effectiveOrders = useMemo(() => {
    const localByOrder = new Map<string, number>();
    const localLoadIds = new Set(runs.flatMap((run) => run.loadId ? [run.loadId] : []));
    for (const run of runs) {
      for (const line of run.lines) {
        const ids = lineOrderIds(line);
        if (!ids.length) continue;
        if (line.orderAllocations) {
          for (const id of ids) localByOrder.set(id, (localByOrder.get(id) || 0) + Math.max(line.orderAllocations[id] || 0, 0));
        } else if (line.orderId) {
          localByOrder.set(line.orderId, (localByOrder.get(line.orderId) || 0) + (validPallets(line.pallets) || 0));
        }
      }
    }
    return orders.map((order) => {
      const plannedOutsideThisPlanner = order.allocations.filter((allocation) => !localLoadIds.has(allocation.loadId)).reduce((sum, allocation) => sum + Math.max(allocation.pallets, 0), 0);
      const locallyPlanned = localByOrder.get(order.id) || 0;
      const plannedPallets = plannedOutsideThisPlanner + locallyPlanned;
      return { ...order, plannedPallets, outstandingPallets: Math.max(order.orderedPallets - plannedPallets, 0) };
    });
  }, [orders, runs]);

  const summary = useMemo(() => effectiveOrders.reduce((totals, order) => ({ ordered: totals.ordered + order.orderedPallets, planned: totals.planned + order.plannedPallets, outstanding: totals.outstanding + order.outstandingPallets }), { ordered: 0, planned: 0, outstanding: 0 }), [effectiveOrders]);

  const visible = useMemo(() => effectiveOrders
    .filter((order) => order.outstandingPallets > 0)
    .filter((order) => !query.trim() || [order.reference, order.customerCode, order.collection, order.destination, order.source].some((value) => String(value || "").toLowerCase().includes(query.toLowerCase())))
    .sort((left, right) => left.collection.localeCompare(right.collection) || left.destination.localeCompare(right.destination) || left.reference.localeCompare(right.reference)), [effectiveOrders, query]);

  const movements = useMemo(() => {
    const grouped = new Map<string, PlanningMovement>();
    for (const order of visible) {
      const key = movementKey(order, sites, marketNames);
      const existing = grouped.get(key);
      if (existing) {
        existing.orders.push(order);
        existing.orderedPallets += order.orderedPallets;
        existing.outstandingPallets += order.outstandingPallets;
      } else {
        grouped.set(key, { key, collection: plannerSiteName(sites, order.collection), destination: plannerSiteName(sites, order.destination), orderedPallets: order.orderedPallets, outstandingPallets: order.outstandingPallets, orders: [order] });
      }
    }
    return [...grouped.values()].sort((a, b) => a.collection.localeCompare(b.collection) || a.destination.localeCompare(b.destination));
  }, [marketNames, sites, visible]);

  const orderClusters = useMemo<OrderCluster[]>(() => CLUSTER_DEFINITIONS.map((definition) => {
    const clusterMovements = movements.filter((movement) => clusterForOrder(movement.orders[0], sites, marketNames) === definition.key);
    return { ...definition, movements: clusterMovements, pallets: clusterMovements.reduce((total, movement) => total + movement.outstandingPallets, 0) };
  }).filter((cluster) => cluster.movements.length > 0), [marketNames, movements, sites]);

  const active = runs.find((run) => run.key === activeKey) || runs[0];
  const visibleRuns = useMemo(
    () => periodFilter === "ALL" ? runs : runs.filter((run) => run.period === periodFilter || !run.period),
    [periodFilter, runs],
  );
  const amRunCount = runs.filter((run) => run.period === "AM").length;
  const pmRunCount = runs.filter((run) => run.period === "PM").length;
  const newDraft = () => {
    const draft = blankRun(`shell-${date}-${crypto.randomUUID()}`);
    if (periodFilter !== "ALL") draft.period = periodFilter;
    return draft;
  };
  const updateRun = (key: string, updater: (run: RunDraft) => RunDraft) => setRuns((current) => current.map((run) => run.key === key ? updater(run) : run));
  const updateLine = (runKey: string, lineKey: string, patch: Partial<RunLine>) => updateRun(runKey, (run) => ({ ...run, lines: run.lines.map((line) => line.key === lineKey ? { ...line, ...patch } : line) }));
  const runTotal = (run: RunDraft) => run.lines.reduce((sum, line) => sum + (validPallets(line.pallets) || 0), 0);

  function buildStops(lines: RunLine[]) {
    return lines.filter((line) => (validPallets(line.pallets) || 0) > 0 && lineOrderIds(line).length > 0).flatMap((line) => {
      const collection = stopFromSite(sites, line.collectionSite);
      const delivery = stopFromSite(sites, line.deliverySite);
      return lineOrderIds(line).flatMap((orderId) => [
        { name: `Collect · ${line.collectionSite}`, ...collection },
        { orderId, name: `Deliver · ${line.deliverySite}`, ...delivery, plannerNote: line.note.trim() || undefined },
      ]);
    });
  }

  async function allocate(orderId: string, loadId: string, pallets: number, access: string) {
    return request<AllocationResult>("/api/v1/planning-control/allocations", access, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, loadId, date, pallets, note: "Auto-saved from live Run Planner" }) });
  }

  async function syncStops(loadId: string, lines: RunLine[], access: string) {
    const stops = buildStops(lines);
    if (!stops.length) {
      try { await updateRunStops(loadId, [], access); } catch { /* allocation zero remains authoritative */ }
      return;
    }
    await updateRunStops(loadId, stops, access);
  }

  function notesForRun(run: RunDraft, period = run.period) {
    const current = loads.find((item) => item.id === run.loadId)?.plannerNotes;
    return plannerTag(plannerTag(withPlannerPeriod(current, period), "Night out", run.nightOut ? "Yes" : "No"), "Operational amendment", run.operationalAmendment);
  }

  async function persistRunDetails(run: RunDraft, patch: Partial<RunDraft>) {
    if (!run.loadId) return;
    const next = { ...run, ...patch };
    const load = loads.find((item) => item.id === run.loadId);
    try {
      await request(`/api/v1/loads/${run.loadId}/utilisation`, await token(), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ palletSpacesUsed: runTotal(run), totalPalletSpaces: load?.totalPalletSpaces ?? 26, capacityType: load?.capacityType ?? "Standard pallets", depotSplits: load?.depotSplits, temperatureC: load?.temperatureC, plannerNotes: notesForRun(next) }) });
      signalPlanningChange();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Run details could not be auto-saved."); }
  }

  function maxForOrder(orderId: string, runKey: string) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return 0;
    const plannedOnOtherVisibleRuns = runs.filter((run) => run.key !== runKey).flatMap((run) => run.lines).reduce((sum, line) => sum + (line.orderAllocations?.[orderId] || (line.orderId === orderId ? validPallets(line.pallets) || 0 : 0)), 0);
    const representedLoadIds = new Set(runs.flatMap((run) => run.loadId ? [run.loadId] : []));
    const plannedOnOtherServerRuns = order.allocations.filter((allocation) => !representedLoadIds.has(allocation.loadId)).reduce((sum, allocation) => sum + Math.max(allocation.pallets, 0), 0);
    return Math.max(order.orderedPallets - plannedOnOtherVisibleRuns - plannedOnOtherServerRuns, 0);
  }

  function distributeQuantity(orderIds: string[], pallets: number, runKey: string) {
    let remaining = pallets;
    const allocations: Record<string, number> = {};
    for (const orderId of orderIds) {
      const capacity = maxForOrder(orderId, runKey);
      const quantity = Math.min(remaining, capacity);
      allocations[orderId] = quantity;
      remaining -= quantity;
    }
    return { allocations, remaining };
  }

  async function persistQuantity(runKey: string, lineKey: string, loadId: string, allocations: Record<string, number>, pallets: number, linesAfterEdit: RunLine[]) {
    const mutation = ++mutationCounter.current;
    const key = `${runKey}:${lineKey}`;
    setBusyKey(key);
    try {
      const access = await token();
      await Promise.all(Object.entries(allocations).map(([orderId, quantity]) => allocate(orderId, loadId, quantity, access)));
      if (pallets === 0) await syncStops(loadId, linesAfterEdit, access);
      signalPlanningChange();
      setMessage(`Auto-saved · ${pallets} pallet${pallets === 1 ? "" : "s"} on this consolidated movement.`);
      void refreshControl().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pallet quantity could not be auto-saved.");
      if (mutation === mutationCounter.current) void refreshAll();
    } finally { setBusyKey((current) => current === key ? undefined : current); }
  }

  function scheduleQuantity(run: RunDraft, line: RunLine, value: string) {
    const pallets = validPallets(value);
    if (pallets === undefined) { updateLine(run.key, line.key, { pallets: value }); return; }
    const ids = lineOrderIds(line);
    if (!ids.length || !run.loadId) { updateLine(run.key, line.key, { pallets: value }); return; }
    const distributed = distributeQuantity(ids, pallets, run.key);
    if (distributed.remaining > 0) {
      const maximum = pallets - distributed.remaining;
      setMessage(`Maximum available for this consolidated movement is ${maximum} pallets.`);
      return;
    }
    const linesAfterEdit = run.lines.map((item) => item.key === line.key ? { ...item, pallets: value, orderAllocations: distributed.allocations } : item);
    updateRun(run.key, (current) => ({ ...current, lines: linesAfterEdit }));
    const timerKey = `${run.key}:${line.key}`;
    if (saveTimers.current[timerKey]) window.clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = window.setTimeout(() => {
      delete saveTimers.current[timerKey];
      void persistQuantity(run.key, line.key, run.loadId!, distributed.allocations, pallets, linesAfterEdit);
    }, 250);
  }

  async function persistLineNote(run: RunDraft, line: RunLine, note: string) {
    const linesAfterEdit = run.lines.map((item) => item.key === line.key ? { ...item, note } : item);
    updateRun(run.key, (current) => ({ ...current, lines: linesAfterEdit }));
    if (!run.loadId || !lineOrderIds(line).length) return;
    const key = `${run.key}:${line.key}:note`;
    setBusyKey(key);
    try { await syncStops(run.loadId, linesAfterEdit, await token()); signalPlanningChange(); setMessage("Line note auto-saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Line note could not be saved."); }
    finally { setBusyKey((current) => current === key ? undefined : current); }
  }

  async function addMovement(movement: PlanningMovement) {
    if (!active || movement.outstandingPallets <= 0) return;
    if (!active.loadId && busyKey) return;
    const orderIds = movement.orders.map((order) => order.id);
    const movementIdentity = movement.key;
    const existingLine = active.lines.find((line) => {
      const first = effectiveOrders.find((order) => lineOrderIds(line).includes(order.id));
      return first ? movementKey(first, sites, marketNames) === movementIdentity : false;
    });
    const initialAllocations = Object.fromEntries(movement.orders.map((order) => [order.id, order.outstandingPallets]));
    let nextLines: RunLine[];
    if (existingLine) {
      const mergedIds = [...new Set([...lineOrderIds(existingLine), ...orderIds])];
      const mergedAllocations = { ...(existingLine.orderAllocations || {}), ...initialAllocations };
      const mergedTotal = Object.values(mergedAllocations).reduce((sum, value) => sum + Math.max(value, 0), 0);
      nextLines = active.lines.map((line) => line.key === existingLine.key ? { ...line, orderIds: mergedIds, orderAllocations: mergedAllocations, pallets: String(mergedTotal) } : line);
    } else {
      const line: RunLine = { key: crypto.randomUUID(), orderId: orderIds[0], orderIds, orderAllocations: initialAllocations, collectionSite: movement.collection, deliverySite: movement.destination, pallets: String(movement.outstandingPallets), note: "" };
      const blankIndex = active.lines.findIndex((item) => !item.orderId && !item.collectionSite && !item.deliverySite && !item.pallets);
      nextLines = blankIndex >= 0 ? active.lines.map((item, index) => index === blankIndex ? line : item) : [...active.lines, line];
    }
    updateRun(active.key, (run) => ({ ...run, lines: nextLines }));
    const creatingRun = !active.loadId;
    if (creatingRun) setBusyKey(active.key);
    try {
      const access = await token();
      let loadId = active.loadId;
      if (!loadId) {
        const index = Math.max(runs.findIndex((run) => run.key === active.key), 0);
        const existingReferences = new Set(loads.map((load) => load.reference.toUpperCase()));
        let number = index + 1;
        while (existingReferences.has(runRef(date, number).toUpperCase())) number += 1;
        const created = await createRun({ reference: runRef(date, number), planningDate: date, palletSpacesUsed: runTotal({ ...active, lines: nextLines }), totalPalletSpaces: 26, capacityType: "Standard pallets", plannerNotes: notesForRun(active), stops: buildStops(nextLines) }, access);
        loadId = created.id;
        setLoads((current) => current.some((load) => load.id === created.id) ? current : [...current, created]);
        updateRun(active.key, (run) => ({ ...run, loadId }));
      }
      const persisted = nextLines.find((line) => line === existingLine || line.key === existingLine?.key) || nextLines.find((line) => lineOrderIds(line).some((id) => orderIds.includes(id)));
      const allocations = persisted?.orderAllocations || initialAllocations;
      await Promise.all([
        ...Object.entries(allocations).map(([orderId, quantity]) => allocate(orderId, loadId!, quantity, access)),
        syncStops(loadId!, nextLines, access),
      ]);
      signalPlanningChange();
      setMessage(`${movement.outstandingPallets} pallet${movement.outstandingPallets === 1 ? "" : "s"} added. ${movement.orders.length > 1 ? `${movement.orders.length} source orders consolidated into one movement.` : ""} Any balance remains in Pallet Order.`);
      void refreshControl().catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Movement could not be added to the run.");
      await refreshAll().catch(() => undefined);
    } finally { if (creatingRun) setBusyKey(undefined); }
  }

  async function addOrder(order: PlanningOrder) {
    const movement = movements.find((item) => item.orders.some((candidate) => candidate.id === order.id)) || { key: movementKey(order, sites, marketNames), collection: plannerSiteName(sites, order.collection), destination: plannerSiteName(sites, order.destination), orderedPallets: order.orderedPallets, outstandingPallets: order.outstandingPallets, orders: [order] };
    await addMovement(movement);
  }

  async function clearLine(run: RunDraft, line: RunLine) {
    const timerKey = `${run.key}:${line.key}`;
    if (saveTimers.current[timerKey]) { window.clearTimeout(saveTimers.current[timerKey]); delete saveTimers.current[timerKey]; }
    const remaining = run.lines.length === 1 ? [blankLine()] : run.lines.filter((item) => item.key !== line.key);
    updateRun(run.key, (current) => ({ ...current, lines: remaining }));
    const ids = lineOrderIds(line);
    if (!ids.length || !run.loadId) return;
    setBusyKey(timerKey);
    try {
      const access = await token();
      await Promise.all(ids.map((orderId) => allocate(orderId, run.loadId!, 0, access)));
      await syncStops(run.loadId, remaining, access);
      signalPlanningChange();
      setMessage("Movement removed from the run and its remaining pallets returned to Pallet Order.");
      void refreshControl().catch(() => undefined);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Movement could not be removed from the run."); await refreshAll().catch(() => undefined); }
    finally { setBusyKey(undefined); }
  }

  function resetForDate(nextDate: string) {
    Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
    saveTimers.current = {};
    setDate(nextDate);
    setMessage(undefined);
    const shell = blankRun(`shell-${nextDate}-1`);
    setRuns([shell]);
    setActiveKey(shell.key);
  }

  useEffect(() => { if (planningDate && planningDate !== date) resetForDate(planningDate); }, [date, planningDate]);

  const poolBlocked = Boolean(active && !active.loadId && busyKey);

  return <section className="simple-planner">
    <div className="simple-planner-toolbar">
      {dateIsExternallyControlled ? <span><strong>{date}</strong><small> plan date</small></span> : <label>Plan date <input type="date" value={date} onChange={(event) => resetForDate(event.target.value)} /></label>}
      <button onClick={() => void refreshAll()} disabled={Boolean(busyKey)}>Refresh</button>
      <button className="primary" onClick={() => { const draft = newDraft(); setRuns((current) => [...current, draft]); setActiveKey(draft.key); }}>+ Add run</button>
      <div className="run-period-selector" role="tablist" aria-label="Planner period"><span>View</span><button type="button" className={periodFilter === "ALL" ? "selected" : ""} onClick={() => setPeriodFilter("ALL")}>All ({runs.length})</button><button type="button" className={periodFilter === "AM" ? "selected" : ""} onClick={() => setPeriodFilter("AM")}>AM ({amRunCount})</button><button type="button" className={periodFilter === "PM" ? "selected" : ""} onClick={() => setPeriodFilter("PM")}>PM / O/N ({pmRunCount})</button></div>
      <div className="simple-planner-summary"><span><strong>{summary.planned}</strong><small>planned</small></span><span><strong>{summary.outstanding}</strong><small>remaining</small></span></div>
    </div>

    {message && <p className="notice inline-notice simple-planner-notice">{message}</p>}

    <div className="simple-planner-layout">
      <div className="simple-run-builder">
        <div className="simple-section-heading"><div><p className="eyebrow">Run builder</p><h2>{visibleRuns.length} run{visibleRuns.length === 1 ? "" : "s"}</h2></div><small>AM is daytime work. PM / O/N covers routes that continue past midnight. Same collection/delivery movements are consolidated.</small></div>
        {visibleRuns.map((run) => {
          const index = runs.indexOf(run);
          const saving = busyKey === run.key || busyKey?.startsWith(`${run.key}:`);
          const load = loads.find((item) => item.id === run.loadId);
          return <article key={run.key} className={`simple-run-card ${activeKey === run.key ? "active" : ""}`} onClick={() => setActiveKey(run.key)}>
            <div className="simple-run-header"><div><strong>RUN {index + 1}{run.period ? ` ${run.period}` : ""}{run.nightOut ? " O/N" : ""}</strong><small>{run.loadId ? "Live" : "New"}</small></div><div className="run-period-selector"><span>Period</span>{(["AM", "PM"] as const).map((period) => <button key={period} type="button" className={run.period === period ? "selected" : ""} onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, period })); void persistRunDetails(run, { period }); }}>{period}</button>)}</div></div>
            <div className="simple-run-details"><label className="simple-night-out"><input type="checkbox" checked={run.nightOut} onChange={(event) => { const nightOut = event.target.checked; updateRun(run.key, (current) => ({ ...current, nightOut })); void persistRunDetails(run, { nightOut }); }} /> Overnight / night-out confirmed</label><label>Operational amendment<input value={run.operationalAmendment} placeholder="e.g. swap to trailer 123 / breakdown" onChange={(event) => updateRun(run.key, (current) => ({ ...current, operationalAmendment: event.target.value }))} onBlur={() => void persistRunDetails(run, { operationalAmendment: run.operationalAmendment })} /></label></div>
            <div className="simple-run-columns"><span>Collection</span><span>Pallets</span><span>Delivery</span><span>Line note</span><span /></div>
            <div className="simple-run-lines">{run.lines.map((line, lineIndex) => {
              const refs = lineOrderIds(line).map((id) => effectiveOrders.find((order) => order.id === id)?.reference).filter(Boolean);
              return <div className="simple-run-line" key={line.key} title={refs.length > 1 ? `${refs.length} source orders: ${refs.join(", ")}` : refs[0]}>
                <span className="simple-line-number">{lineIndex + 1}</span>
                <input value={line.collectionSite} readOnly={lineOrderIds(line).length > 0} onChange={(event) => updateLine(run.key, line.key, { collectionSite: event.target.value })} placeholder="Collection" />
                <input className="simple-pallet-input" type="number" min="0" inputMode="numeric" value={line.pallets} onChange={(event) => scheduleQuantity(run, line, event.target.value)} placeholder="0" />
                <input value={line.deliverySite} readOnly={lineOrderIds(line).length > 0} onChange={(event) => updateLine(run.key, line.key, { deliverySite: event.target.value })} placeholder="Delivery" />
                <input value={line.note} onChange={(event) => updateLine(run.key, line.key, { note: event.target.value })} onBlur={(event) => void persistLineNote(run, line, event.currentTarget.value)} placeholder={refs.length > 1 ? `${refs.length} orders consolidated` : "Facility / load-line note"} />
                <button type="button" className="simple-clear-line" aria-label={`Clear line ${lineIndex + 1}`} disabled={busyKey === `${run.key}:${line.key}`} onClick={(event) => { event.stopPropagation(); void clearLine(run, line); }}>×</button>
              </div>;
            })}</div>
            <div className="simple-run-footer"><div className="simple-line-actions"><button type="button" onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, lines: [...current.lines, blankLine()] })); }}>+ Add line</button></div><small>{saving ? "Saving…" : run.loadId ? "✓ Auto-saved" : "Choose an order to start this run"}</small></div>
            {load && activeKey === run.key && <RunJobSuggestions lines={run.lines} orders={effectiveOrders} sites={sites} remainingCapacity={Math.max((load.totalPalletSpaces ?? 26) - runTotal(run), 0)} busy={poolBlocked} onAdd={(orderId) => { const order = effectiveOrders.find((item) => item.id === orderId); if (order) void addOrder(order); }} />}
          </article>;
        })}
        <button className="simple-add-run" type="button" onClick={() => { const draft = newDraft(); setRuns((current) => [...current, draft]); setActiveKey(draft.key); }}>+ Add another run</button>
      </div>

      <aside className="simple-order-pool">
        <div className="simple-order-header"><div><p className="eyebrow">Orders to plan</p><h2>Available now</h2></div><strong>{movements.length}</strong></div>
        <input className="simple-order-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, site or customer…" />
        <p className="simple-order-help">Matching collection → delivery orders are merged into one planning movement. Original order references remain underneath for audit. Any unplanned balance remains here and in Pallet Order.</p>
        <div className="simple-order-list">
          {orderClusters.map((cluster) => <section key={cluster.key} style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-end", padding: "8px 2px 4px", borderBottom: "1px solid var(--border, #d0d7de)" }}><div><strong style={{ display: "block" }}>{cluster.label}</strong><small title={cluster.note}>{cluster.movements.length} movement{cluster.movements.length === 1 ? "" : "s"}</small></div><div style={{ textAlign: "right" }}><strong style={{ display: "block", fontSize: "1.15rem" }}>{cluster.pallets}</strong><small>pallets remaining</small></div></div>
            {cluster.movements.map((movement) => <button key={movement.key} className="simple-order-card" type="button" disabled={poolBlocked} onClick={() => void addMovement(movement)} title={movement.orders.map((order) => order.reference).join(", ")}>
              <span><small>{orderTypeLabel(movement.orders[0], sites, marketNames)} · Collection{movement.orders.length > 1 ? ` · ${movement.orders.length} orders` : ""}</small><strong>{movement.collection}</strong></span>
              <span className="simple-order-pallets"><strong>{movement.outstandingPallets}</strong><small>of {movement.orderedPallets}</small></span>
              <span><small>Delivery</small><strong>{movement.destination}</strong></span>
            </button>)}
          </section>)}
          {!movements.length && <p>All current orders are fully planned.</p>}
        </div>
      </aside>
    </div>
  </section>;
}
