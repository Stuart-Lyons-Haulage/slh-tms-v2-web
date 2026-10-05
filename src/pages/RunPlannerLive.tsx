import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type Load, type Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { startVisiblePolling } from "../lib/visiblePolling";
import "../simple-planner.css";
import { createRun, listRuns, updateRunRelay, updateRunStatus, updateRunStops } from '../api/runs';
import { planningDeliveryLocation } from "../lib/planningLocations";
import { tomorrowIsoDate } from "../lib/dateUtils";
import { calculateRunCapacity } from "./runPlannerCapacity";
import { suggestJobsForRun, suggestionConfidencePercent, type RunSuggestionLine, type RunSuggestionSite } from "./runPlannerSuggestions";

type Period = "" | "AM" | "PM";
type PeriodFilter = "ALL" | "AM" | "PM";
type Allocation = { loadId: string; loadReference?: string; pallets: number };
type PlanningOrder = {
  id: string;
  reference: string;
  lineNote?: string;
  customerCode: string;
  orderedPallets: number;
  plannedPallets: number;
  outstandingPallets: number;
  collection: string;
  destination: string;
  originalDestination?: string;
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
type RunDraft = { key: string; loadId?: string; period: Period; nightOut: boolean; operationalAmendment: string; relayEnabled: boolean; handoverSite: string; handoverAfterStopSequence: string; lines: RunLine[] };

const blankLine = (): RunLine => ({ key: crypto.randomUUID(), collectionSite: "", deliverySite: "", pallets: "", note: "" });
const blankRun = (key: string): RunDraft => ({
  key,
  period: "",
  nightOut: false,
  operationalAmendment: "",
  relayEnabled: false,
  handoverSite: "",
  handoverAfterStopSequence: "",
  lines: [blankLine()],
});
const localDate = tomorrowIsoDate;
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
const normalisePlanningControl = (data: PlanningControlData): PlanningControlData => ({
  ...data,
  orders: data.orders.map(order => ({ ...order, destination: planningDeliveryLocation(order) })),
});
const siteFor = (sites: Site[], value: string) => {
  const target = normalise(value);
  if (!target) return undefined;
  return sites.find((site) =>
    [site.name, site.driverTextName, site.externalCode, ...(site.aliases || "").split(/[,;|]/)]
      .some((candidate) => normalise(candidate) === target));
};
const stopFromSite = (sites: Site[], value: string) => {
  const site = siteFor(sites, value);
  return { address: site?.collectionAddress, latitude: site?.latitude, longitude: site?.longitude };
};
const runRef = (date: string, number: number) => `RUN-${date.replaceAll("-", "")}-${String(number).padStart(2, "0")}`;
function lineOrderIds(line: RunLine) {
  return line.orderIds?.length ? line.orderIds : line.orderId ? [line.orderId] : [];
}

function cleanLineNote(value?: string) {
  return (value || "")
    .split("·")
    .map(part => part.trim())
    .filter(part => part && !/^ref\s*:/i.test(part))
    .join(" · ");
}

function orderLineNote(order: PlanningOrder) {
  return cleanLineNote(order.lineNote);
}

function mergedOrderLineNote(...values: Array<string | undefined>) {
  const parts = values
    .flatMap(value => cleanLineNote(value).split("·"))
    .map(value => value.trim())
    .filter(Boolean);
  return [...new Map(parts.map(value => [normalise(value), value])).values()].join(" · ");
}

function validPallets(value: string) {
  const pallets = Number(value);
  return Number.isInteger(pallets) && pallets >= 0 ? pallets : undefined;
}

function runBuilderWarnings(run: RunDraft, capacity: ReturnType<typeof calculateRunCapacity>, effectiveOrders: PlanningOrder[], sites: Site[]) {
  const warnings: string[] = [];
  if (capacity.status === "Red") warnings.push("Capacity exceeds the current trailer basis.");
  if (capacity.unknownPallets > 0) warnings.push(`${capacity.unknownPallets} load unit${capacity.unknownPallets === 1 ? " is" : "s are"} not classified as Standard, Euro, trolley or tray/crate.`);
  if (run.period === "PM" && !run.nightOut) warnings.push("PM work is selected; confirm whether a night-out is required before dispatch.");
  if (run.relayEnabled && !run.handoverSite.trim()) warnings.push("Trailer swap is enabled; add the handover site before Dispatch or Samsara export.");
  run.lines.forEach((line, index) => {
    const hasContent = Boolean(line.collectionSite.trim() || line.deliverySite.trim() || line.pallets.trim());
    if (!hasContent) return;
    const ids = lineOrderIds(line);
    const matches = effectiveOrders.filter(order => normalise(order.collection) === normalise(line.collectionSite) && normalise(order.destination) === normalise(line.deliverySite));
    if (!ids.length && matches.length === 0) warnings.push(`Line ${index + 1} does not match a live order for this date.`);
    const collection = siteFor(sites, line.collectionSite);
    const delivery = siteFor(sites, line.deliverySite);
    if (collection && (collection.latitude == null || collection.longitude == null)) warnings.push(`Line ${index + 1} collection is missing mapped coordinates.`);
    if (delivery && (delivery.latitude == null || delivery.longitude == null)) warnings.push(`Line ${index + 1} delivery is missing mapped coordinates.`);
  });
  return [...new Set(warnings)];
}

export function RunPlannerLive({ planningDate }: { planningDate?: string } = {}) {
  const token = useAccessToken();
  const dateIsExternallyControlled = Boolean(planningDate);
  const [date, setDate] = useState(planningDate || localDate());
  const [control, setControl] = useState<PlanningControlData>();
  const [loads, setLoads] = useState<Load[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [runs, setRuns] = useState<RunDraft[]>(() => [blankRun(`shell-${localDate()}-1`)]);
  const [activeKey, setActiveKey] = useState(runs[0].key);
  const [busyKey, setBusyKey] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [openPicker, setOpenPicker] = useState<string>();
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("ALL");
  const saveTimers = useRef<Record<string, number>>({});
  const mutationCounter = useRef(0);
  const refreshSequence = useRef(0);
  const loadsRef = useRef<Load[]>([]);
  const sitesRef = useRef<Site[]>([]);
  const dirtyRunKeys = useRef(new Set<string>());
  const runsRef = useRef(runs);
  const setPlannerRuns = (next: RunDraft[] | ((current: RunDraft[]) => RunDraft[])) => {
    setRuns((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      runsRef.current = resolved;
      return resolved;
    });
  };

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
        note: mergedOrderLineNote(
          existing.note,
          line.note,
          ...ids.map(id => ordersById.get(id)).filter((order): order is PlanningOrder => Boolean(order)).map(orderLineNote),
        ),
      });
    }
    return [...groups.values()];
  }, []);

  const hydrate = useCallback((nextControl: PlanningControlData, nextLoads: Load[]) => {
    const ordered = [...nextLoads].sort((left, right) => String(left.reference).localeCompare(String(right.reference)));
    const drafts = ordered.length === 0 ? [] : (() => {
      const ordersById = new Map(nextControl.orders.map((order) => [order.id, order]));
      return ordered.map((load) => {
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
          return [{ key: `${load.id}-${order.id}`, orderId: order.id, collectionSite: order.collection.trim(), deliverySite: order.destination.trim(), pallets: String(allocation.pallets), note: mergedOrderLineNote(stop.plannerNote, orderLineNote(order)) }];
        });
      const unsequencedLines = nextControl.orders.flatMap((order) => {
        if (seenOrderIds.has(order.id)) return [];
        const allocation = order.allocations.find((item) => item.loadId === load.id && item.pallets > 0);
        return allocation ? [{ key: `${load.id}-${order.id}`, orderId: order.id, collectionSite: order.collection.trim(), deliverySite: order.destination.trim(), pallets: String(allocation.pallets), note: mergedOrderLineNote(load.stops.find((stop) => stop.orderId === order.id && /^deliver/i.test(stop.name))?.plannerNote, orderLineNote(order)) }] : [];
      });
      const lines = consolidateLines([...sequencedLines, ...unsequencedLines], ordersById);
      return {
        key: load.id,
        loadId: load.id,
        period: periodFromLoad(load),
        nightOut: overnightFromLoad(load),
        operationalAmendment: tagged(load.plannerNotes, "Operational amendment"),
        relayEnabled: load.relayPlan?.enabled === true,
        handoverSite: load.relayPlan?.handoverSite || tagged(load.plannerNotes, "Handover site"),
        handoverAfterStopSequence: load.relayPlan?.handoverAfterStopSequence ? String(load.relayPlan.handoverAfterStopSequence) : "",
        lines: lines.length ? lines : [blankLine()],
      } satisfies RunDraft;
      });
    })();

    // Event-driven refreshes must update saved runs without deleting a run the
    // planner is currently typing. Unsaved drafts have no loadId yet, so they
    // are safe to carry forward alongside the refreshed server projection.
    const currentByKey = new Map(runsRef.current.map((run) => [run.key, run]));
    const projected = drafts.map((draft) => dirtyRunKeys.current.has(draft.key) ? currentByKey.get(draft.key) || draft : draft);
    const unsaved = runsRef.current.filter((run) => !run.loadId && !projected.some((draft) => draft.key === run.key));
    const nextRuns = projected.length > 0
      ? [...projected, ...unsaved]
      : (unsaved.length > 0 ? unsaved : [blankRun(`shell-${date}-1`)]);
    setPlannerRuns(nextRuns);
    setActiveKey((current) => nextRuns.some((run) => run.key === current) ? current : nextRuns[0].key);
  }, [consolidateLines, date]);

  const refreshAll = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const access = await token();
    const nextControl = normalisePlanningControl(await request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, access));
    const [loadsResult, sitesResult] = await Promise.allSettled([listRuns(date, access), api.sites(access)]);
    // A failed or out-of-order refresh must never turn a populated planner into an
    // empty one. Keep the last authoritative projection until a successful response
    // replaces it; this is especially important immediately after creating a run.
    if (sequence !== refreshSequence.current) return;
    const loadsOk = loadsResult.status === "fulfilled" && Array.isArray(loadsResult.value);
    const sitesOk = sitesResult.status === "fulfilled" && Array.isArray(sitesResult.value);
    const safeLoads = loadsOk ? loadsResult.value : loadsRef.current;
    const safeSites = sitesOk ? sitesResult.value : sitesRef.current;
    setControl(nextControl);
    setLoads(safeLoads);
    setSites(safeSites);
    loadsRef.current = safeLoads;
    sitesRef.current = safeSites;
    if (!loadsOk || !sitesOk) {
      setMessage("Planner kept the last saved runs while run or site data was temporarily unavailable. Refresh to retry.");
      return;
    }
    hydrate(nextControl, safeLoads);
  }, [date, hydrate, token]);

  const refreshControl = useCallback(async () => {
    const nextControl = normalisePlanningControl(await request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, await token()));
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
    const refresh = () => void refreshAll().catch(() => undefined);
    const stopPolling = startVisiblePolling(refresh, 30_000);
    const unsubscribe = subscribePlanningChanges(refresh);
    return () => { stopPolling(); unsubscribe(); };
  }, [refreshAll]);

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

  // The route builder must start from live work for the selected day. Site Master
  // remains useful for addresses/geocoding, but must not be the source of the
  // collection and delivery choices shown to the planner.
  const availableOrders = useMemo(() => effectiveOrders.filter(order => order.outstandingPallets > 0), [effectiveOrders]);
  const liveCollections = useMemo(() => [...new Set(availableOrders.map(order => order.collection.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right)), [availableOrders]);
  const matchingOrders = useCallback((collection: string, delivery: string) => {
    const collectionKey = normalise(collection);
    const deliveryKey = normalise(delivery);
    if (!collectionKey || !deliveryKey) return [];
    return availableOrders.filter(order => normalise(order.collection) === collectionKey && normalise(order.destination) === deliveryKey);
  }, [availableOrders]);

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
  const updateRun = (key: string, updater: (run: RunDraft) => RunDraft) => {
    dirtyRunKeys.current.add(key);
    setPlannerRuns((current) => current.map((run) => run.key === key ? updater(run) : run));
  };
  const updateLine = (runKey: string, lineKey: string, patch: Partial<RunLine>) => updateRun(runKey, (run) => ({ ...run, lines: run.lines.map((line) => line.key === lineKey ? { ...line, ...patch } : line) }));
  const addSuggestedOrder = (run: RunDraft, order: PlanningOrder) => {
    const quantity = run.loadId
      ? distributeQuantity([order.id], order.outstandingPallets, run.key).allocations[order.id] || 0
      : order.outstandingPallets;
    if (quantity <= 0) {
      setMessage(`${order.reference} does not fit the remaining capacity on this run.`);
      return;
    }
    const nextLine: RunLine = {
      ...blankLine(),
      collectionSite: order.collection,
      deliverySite: order.destination,
      pallets: String(quantity),
      orderId: order.id,
      orderIds: [order.id],
      orderAllocations: { [order.id]: quantity },
      note: orderLineNote(order),
    };
    const nextLines = [...run.lines.filter(line => lineOrderIds(line).length > 0 || line.collectionSite.trim() || line.deliverySite.trim() || line.pallets.trim()), nextLine];
    updateRun(run.key, current => ({ ...current, lines: nextLines }));
    if (run.loadId) void persistQuantity(run.key, nextLine.key, run.loadId, { [order.id]: quantity }, quantity, nextLines);
    setMessage(`${order.reference} added to ${run.loadId ? "the live run and saved" : "the draft run"}.`);
  };
  const changeLineLocation = (runKey: string, line: RunLine, field: "collectionSite" | "deliverySite", value: string) => {
    const currentRun = runs.find((run) => run.key === runKey);
    if (!currentRun) return;
    const nextLine = { ...line, [field]: value, orderId: undefined, orderIds: undefined, orderAllocations: undefined } as RunLine;
    const nextLines = currentRun.lines.map((item) => item.key === line.key ? nextLine : item);
    updateRun(runKey, (run) => ({ ...run, lines: nextLines }));
    // Manual entry follows the same autosave path as a picker selection once
    // the typed route resolves to live work for the selected date.
    if (field !== "deliverySite" || currentRun.loadId) return;
    const matches = matchingOrders(nextLine.collectionSite, nextLine.deliverySite);
    if (!matches.length) return;
    const linkedLine: RunLine = {
      ...nextLine,
      collectionSite: matches[0].collection.trim(),
      deliverySite: matches[0].destination.trim(),
      pallets: String(matches.reduce((sum, order) => sum + Math.max(order.outstandingPallets, 0), 0)),
      orderId: matches[0].id,
      orderIds: matches.map((order) => order.id),
    };
    const linkedLines = currentRun.lines.map((item) => item.key === line.key ? linkedLine : item);
    updateRun(runKey, (run) => ({ ...run, lines: linkedLines }));
    void createPlanningRun({ ...currentRun, lines: linkedLines });
  };
  const chooseCollection = (runKey: string, lineKey: string, value: string) => {
    const source = availableOrders.find((order) => normalise(order.collection) === normalise(value));
    updateLine(runKey, lineKey, { collectionSite: source?.collection.trim() || value, deliverySite: "", pallets: "", orderId: undefined, orderIds: undefined, orderAllocations: undefined });
  };
  const chooseDelivery = (runKey: string, lineKey: string, collection: string, destination: string) => {
    const matches = matchingOrders(collection, destination);
    if (!matches.length) return;
    const outstanding = matches.reduce((sum, order) => sum + Math.max(order.outstandingPallets, 0), 0);
    const currentRun = runs.find((run) => run.key === runKey);
    const currentLine = currentRun?.lines.find((line) => line.key === lineKey);
    if (!currentRun || !currentLine) return;
    const nextLine: RunLine = {
      ...currentLine,
      collectionSite: matches[0].collection.trim(),
      deliverySite: matches[0].destination.trim(),
      pallets: String(outstanding),
      orderId: matches[0].id,
      orderIds: matches.map((order) => order.id),
      orderAllocations: undefined,
    };
    const nextLines = currentRun.lines.map((line) => line.key === lineKey ? nextLine : line);
    updateRun(runKey, (run) => ({ ...run, lines: nextLines }));
    // Selecting a valid route is the save point for a new run. The server run
    // must exist before Pallet Control can allocate against it.
    if (!currentRun.loadId) void createPlanningRun({ ...currentRun, lines: nextLines });
  };
  const runCapacity = (run: RunDraft) => {
    const capacityLines = run.lines.flatMap((line) => {
      const ids = lineOrderIds(line);
      if (!ids.length) return [];
      if (line.orderAllocations) {
        return ids.map((orderId) => ({
          orderId,
          collectionSite: line.collectionSite,
          deliverySite: line.deliverySite,
          pallets: String(Math.max(line.orderAllocations?.[orderId] || 0, 0)),
        }));
      }
      if (ids.length === 1) return [{ orderId: ids[0], collectionSite: line.collectionSite, deliverySite: line.deliverySite, pallets: line.pallets }];

      // Older consolidated lines may not have the per-order allocation map.
      // Split their visible quantity across the source orders so each order's
      // pallet/load-unit type is still represented in the capacity calculation.
      let remaining = validPallets(line.pallets) || 0;
      return ids.flatMap((orderId) => {
        const order = orders.find((item) => item.id === orderId);
        const quantity = Math.min(remaining, Math.max(order?.outstandingPallets || order?.orderedPallets || 0, 0));
        remaining -= quantity;
        return quantity > 0 ? [{ orderId, collectionSite: line.collectionSite, deliverySite: line.deliverySite, pallets: String(quantity) }] : [];
      });
    });
    return calculateRunCapacity(capacityLines, orders);
  };

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
    let notes = plannerTag(plannerTag(withPlannerPeriod(current, period), "Night out", run.nightOut ? "Yes" : "No"), "Operational amendment", run.operationalAmendment);
    notes = plannerTag(notes, "Handover site", run.relayEnabled ? run.handoverSite : "");
    return plannerTag(notes, "Trailer swap", run.relayEnabled ? "Yes" : "");
  }

  function relayPayload(run: RunDraft) {
    return {
      enabled: run.relayEnabled,
      handoverSite: run.relayEnabled ? run.handoverSite : null,
      handoverAfterStopSequence: run.relayEnabled && run.handoverAfterStopSequence.trim() ? Number(run.handoverAfterStopSequence) : null,
    };
  }

  async function createPlanningRun(run: RunDraft) {
    if (run.loadId || busyKey) return run.loadId;
    setBusyKey(run.key);
    setMessage(undefined);
    try {
      const access = await token();
      const enteredLines = run.lines.filter((line) =>
        Boolean(line.collectionSite.trim() || line.deliverySite.trim() || line.pallets.trim()));
      const linkedLines = run.lines.map((line) => {
        const matches = matchingOrders(line.collectionSite, line.deliverySite);
        if (lineOrderIds(line).length || matches.length === 0) return line;
        return {
          ...line,
          orderId: matches[0].id,
          orderIds: matches.map((order) => order.id),
          orderAllocations: undefined,
        };
      });
      const unresolved = enteredLines.filter((line) =>
        !matchingOrders(line.collectionSite, line.deliverySite).length &&
        !lineOrderIds(line).length);
      if (unresolved.length > 0) {
        setMessage("Choose a live collection and delivery from the selected date before creating this run. The draft has been kept.");
        return undefined;
      }
      const stops = buildStops(linkedLines);
      if (stops.length === 0) {
        setMessage("Enter a collection, delivery and quantity for at least one live order. The draft has been kept.");
        return undefined;
      }
      updateRun(run.key, (current) => ({ ...current, lines: linkedLines }));
      const index = Math.max(runs.findIndex((item) => item.key === run.key), 0);
      const existingReferences = new Set(loads.map((load) => load.reference.toUpperCase()));
      let number = index + 1;
      while (existingReferences.has(runRef(date, number).toUpperCase())) number += 1;
      const capacity = runCapacity({ ...run, lines: linkedLines });
      const created = await createRun({
        reference: runRef(date, number),
        planningDate: date,
        palletSpacesUsed: capacity.standardEquivalentUsed,
        totalPalletSpaces: capacity.standardCapacity,
        capacityType: `Standard pallets · ${capacity.status} · ${capacity.utilisationPercent}%`,
        plannerNotes: notesForRun(run),
        stops,
      }, access);
      const confirmed = (await listRuns(date, access)).find((item) => item.id === created.id);
      if (!confirmed) throw new Error(`${created.reference} was accepted but could not be confirmed in the saved run list. It was not made available for allocation.`);
      if (run.relayEnabled) await updateRunRelay(created.id, relayPayload(run), access);
      setLoads((current) => current.some((load) => load.id === created.id) ? current : [...current, created]);
      updateRun(run.key, (current) => ({ ...current, loadId: created.id }));
      dirtyRunKeys.current.delete(run.key);
      signalPlanningChange();
      setMessage(`${created.reference} created. It is now available in Pallet Order for allocation.`);
      return created.id;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Run could not be created.");
      return undefined;
    } finally {
      setBusyKey((current) => current === run.key ? undefined : current);
    }
  }

  async function persistRunDetails(run: RunDraft, patch: Partial<RunDraft>) {
    if (!run.loadId) return;
    const next = { ...run, ...patch };
    const load = loads.find((item) => item.id === run.loadId);
    try {
      const capacity = runCapacity(next);
      await request(`/api/v1/loads/${run.loadId}/utilisation`, await token(), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ palletSpacesUsed: capacity.standardEquivalentUsed, totalPalletSpaces: capacity.standardCapacity, capacityType: `Standard pallets · ${capacity.status} · ${capacity.utilisationPercent}%`, depotSplits: load?.depotSplits, temperatureC: load?.temperatureC, plannerNotes: notesForRun(next) }) });
      if (patch.relayEnabled !== undefined || patch.handoverSite !== undefined || patch.handoverAfterStopSequence !== undefined)
        await updateRunRelay(run.loadId, relayPayload(next), await token());
      dirtyRunKeys.current.delete(run.key);
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
      dirtyRunKeys.current.delete(runKey);
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
      // Notify Pallet Order once the input has settled. The successful save
      // below emits again, so a refresh that races the request is followed by
      // the authoritative result without refreshing on every keystroke.
      signalPlanningChange();
      void persistQuantity(run.key, line.key, run.loadId!, distributed.allocations, pallets, linesAfterEdit);
    }, 250);
  }

  async function persistLineNote(run: RunDraft, line: RunLine, note: string) {
    const linesAfterEdit = run.lines.map((item) => item.key === line.key ? { ...item, note } : item);
    updateRun(run.key, (current) => ({ ...current, lines: linesAfterEdit }));
    if (!run.loadId || !lineOrderIds(line).length) return;
    const key = `${run.key}:${line.key}:note`;
    setBusyKey(key);
    try { await syncStops(run.loadId, linesAfterEdit, await token()); dirtyRunKeys.current.delete(run.key); signalPlanningChange(); setMessage("Line note auto-saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Line note could not be saved."); }
    finally { setBusyKey((current) => current === key ? undefined : current); }
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
      if (remaining.some(item => lineOrderIds(item).length > 0)) {
        await syncStops(run.loadId, remaining, access);
      } else {
        // Removing the final movement removes the planning run. Persist a cancellation
        // tombstone so Dispatch and audit recovery cannot continue to show the old run.
        await updateRunStatus(run.loadId, "Cancelled", access);
      }
      dirtyRunKeys.current.delete(run.key);
      signalPlanningChange();
      setMessage("Movement removed from the run and its remaining pallets returned to Pallet Order.");
      void refreshControl().catch(() => undefined);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Movement could not be removed from the run."); await refreshAll().catch(() => undefined); }
    finally { setBusyKey(undefined); }
  }

  const resetForDate = useCallback((nextDate: string) => {
    Object.values(saveTimers.current).forEach((id) => window.clearTimeout(id));
    saveTimers.current = {};
    setDate(nextDate);
    setMessage(undefined);
    const shell = blankRun(`shell-${nextDate}-1`);
    setPlannerRuns([shell]);
    setActiveKey(shell.key);
  }, []);

  useEffect(() => { if (planningDate && planningDate !== date) resetForDate(planningDate); }, [date, planningDate, resetForDate]);

  return <section className="simple-planner">
    <div className="simple-planner-toolbar">
      {dateIsExternallyControlled ? <span><strong>{date}</strong><small> plan date</small></span> : <label>Plan date <input type="date" value={date} onChange={(event) => resetForDate(event.target.value)} /></label>}
      <button onClick={() => void refreshAll()} disabled={Boolean(busyKey)}>Refresh</button>
      <button className="primary" onClick={() => { const draft = newDraft(); setPlannerRuns((current) => [...current, draft]); setActiveKey(draft.key); }}>+ Add run</button>
      <div className="run-period-selector" role="tablist" aria-label="Planner period"><span>View</span><button type="button" className={periodFilter === "ALL" ? "selected" : ""} onClick={() => setPeriodFilter("ALL")}>All ({runs.length})</button><button type="button" className={periodFilter === "AM" ? "selected" : ""} onClick={() => setPeriodFilter("AM")}>AM ({amRunCount})</button><button type="button" className={periodFilter === "PM" ? "selected" : ""} onClick={() => setPeriodFilter("PM")}>PM / O/N ({pmRunCount})</button></div>
      <div className="simple-planner-summary"><span><strong>{summary.planned}</strong><small>planned</small></span><span><strong>{summary.outstanding}</strong><small>remaining</small></span></div>
    </div>

    {message && <p className="notice inline-notice simple-planner-notice">{message}</p>}
    <div className="simple-planner-layout">
      <div className="simple-run-builder">
        <div className="simple-section-heading"><div><p className="eyebrow">Run builder</p><h2>{visibleRuns.length} run{visibleRuns.length === 1 ? "" : "s"}</h2></div><small>Collection and delivery choices come from live jobs for the selected day. Choose both to link the line to the matching order(s).</small></div>
        {visibleRuns.map((run) => {
          const index = runs.indexOf(run);
          const saving = busyKey === run.key || busyKey?.startsWith(`${run.key}:`);
          const capacity = runCapacity(run);
          const usedCapacity = capacity.standardEquivalentUsed;
          const totalCapacity = capacity.standardCapacity;
          const utilisation = capacity.utilisationPercent;
          const capacityStatus = capacity.status.toLowerCase();
          const capacityBreakdown = `Std ${capacity.standardPallets}/${capacity.standardCapacity} · Euro ${capacity.euroPallets}/${capacity.euroCapacity} · Trolley ${capacity.trolleys} · Tray/Crate ${capacity.nonPalletUnits}${capacity.unknownPallets ? ` · Unknown ${capacity.unknownPallets}` : ""}`;
          const suggestionLines: RunSuggestionLine[] = run.lines.map(line => ({ orderId: lineOrderIds(line)[0], collectionSite: line.collectionSite, deliverySite: line.deliverySite, pallets: line.pallets }));
          const suggestionSites: RunSuggestionSite[] = sites;
          const nextOrderSuggestions = suggestJobsForRun(suggestionLines, effectiveOrders, suggestionSites, { standard: capacity.standardRemaining, euro: capacity.euroRemaining });
          const builderWarnings = runBuilderWarnings(run, capacity, effectiveOrders, sites);
          return <article key={run.key} className={`simple-run-card ${activeKey === run.key ? "active" : ""}`} onClick={() => setActiveKey(run.key)}>
            <div className="simple-run-header"><div className="simple-run-heading"><strong>RUN {index + 1}{run.period ? ` ${run.period}` : ""}{run.nightOut ? " O/N" : ""}</strong><small>{run.loadId ? "Live" : "New"}</small><span className={`simple-run-capacity ${capacityStatus}`} title={`${capacityBreakdown} · ${usedCapacity.toFixed(1)} / ${totalCapacity} standard-equivalent spaces`}><i><b style={{ width: `${Math.min(utilisation, 100)}%` }} /></i><strong>{utilisation.toFixed(1)}%</strong></span><span className="simple-run-capacity-breakdown" aria-label={`Capacity: ${capacityBreakdown}`}><span>Std {capacity.standardPallets}/{capacity.standardCapacity}</span><span>Euro {capacity.euroPallets}/{capacity.euroCapacity}</span><span>Trolley {capacity.trolleys}</span><span>Tray/Crate {capacity.nonPalletUnits}</span>{capacity.unknownPallets ? <span>Unknown {capacity.unknownPallets}</span> : null}</span></div><div className="run-period-selector"><span>Period</span>{(["AM", "PM"] as const).map((period) => <button key={period} type="button" className={run.period === period ? "selected" : ""} onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, period })); void persistRunDetails(run, { period }); }}>{period}</button>)}</div></div>
            <div className="simple-run-details"><label className="simple-night-out"><input type="checkbox" checked={run.nightOut} onChange={(event) => { const nightOut = event.target.checked; updateRun(run.key, (current) => ({ ...current, nightOut })); void persistRunDetails(run, { nightOut }); }} /> Overnight / night-out confirmed</label><label className="simple-night-out"><input type="checkbox" checked={run.relayEnabled} onChange={(event) => { const relayEnabled = event.target.checked; updateRun(run.key, (current) => ({ ...current, relayEnabled })); void persistRunDetails(run, { relayEnabled }); }} /> Trailer swap / relay</label><label>Operational amendment<input value={run.operationalAmendment} placeholder="e.g. swap to trailer 123 / breakdown" onChange={(event) => updateRun(run.key, (current) => ({ ...current, operationalAmendment: event.target.value }))} onBlur={() => void persistRunDetails(run, { operationalAmendment: run.operationalAmendment })} /></label>{run.relayEnabled && <><label>Handover site<input list={`relay-sites-${run.key}`} value={run.handoverSite} placeholder="e.g. Cherwell Valley" onChange={(event) => updateRun(run.key, (current) => ({ ...current, handoverSite: event.target.value }))} onBlur={(event) => void persistRunDetails(run, { handoverSite: event.currentTarget.value })} /></label><label>Handover after stop<input type="number" min="1" value={run.handoverAfterStopSequence} placeholder="Optional" onChange={(event) => updateRun(run.key, (current) => ({ ...current, handoverAfterStopSequence: event.target.value }))} onBlur={(event) => void persistRunDetails(run, { handoverAfterStopSequence: event.currentTarget.value })} /></label><datalist id={`relay-sites-${run.key}`}>{sites.map(site => <option key={site.id} value={site.name} />)}</datalist></>}</div>
            {nextOrderSuggestions.length > 0 && <section className="simple-run-suggestions" aria-label={`Suggested next orders for ${run.key}`} onClick={(event) => event.stopPropagation()}><div className="simple-run-suggestions-heading"><div><strong>Suggested next orders</strong><small>Compact route options based on fit, direction and remaining capacity.</small></div><span className="simple-run-suggestion-hint">Check before adding</span></div><div className="simple-run-suggestion-list">{nextOrderSuggestions.map(item => { const confidencePercent = suggestionConfidencePercent(item.score); const confidence = confidencePercent >= 70 ? "high" : confidencePercent >= 45 ? "medium" : "low"; const loadType = item.order.palletType || item.order.loadUnitType; return <article key={item.order.id} className={`simple-run-suggestion confidence-${confidence}`}><div className="simple-run-suggestion-route"><span><small>From</small><strong>{item.order.collection}</strong></span><b aria-hidden="true">→</b><span><small>To</small><strong>{item.order.destination}</strong></span></div><div className="simple-run-suggestion-meta"><span><small>Pallets</small><strong>{item.order.outstandingPallets}{loadType ? ` ${loadType}` : ""}</strong></span><span><small>Confidence</small><strong>{confidencePercent}%</strong></span></div><details><summary>Why?</summary><small>{item.reasons.join(" · ")}</small></details><button type="button" onClick={() => addSuggestedOrder(run, item.order)}>Add</button></article>; })}</div></section>}
            {builderWarnings.length > 0 && <aside className="simple-run-warnings" aria-label="Run builder checks"><strong>Planner checks</strong><ul>{builderWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></aside>}
            <div className="simple-run-columns"><span>Collection</span><span>Pallets</span><span>Delivery</span><span>Line note</span><span /></div>
            <div className="simple-run-lines">{run.lines.map((line, lineIndex) => {
              const refs = lineOrderIds(line).map((id) => effectiveOrders.find((order) => order.id === id)?.reference).filter(Boolean);
              const matches = matchingOrders(line.collectionSite, line.deliverySite);
              const typedRoute = Boolean(line.collectionSite.trim() || line.deliverySite.trim());
              const collectionSuggestions = liveCollections.filter((collection) => !line.collectionSite || normalise(collection).includes(normalise(line.collectionSite))).slice(0, 8);
              const deliveryByName = new Map<string, { destination: string; pallets: number }>();
              availableOrders.filter((order) => normalise(order.collection) === normalise(line.collectionSite)).forEach((order) => {
                const destination = order.destination.trim();
                const current = deliveryByName.get(normalise(destination));
                deliveryByName.set(normalise(destination), { destination, pallets: (current?.pallets || 0) + Math.max(order.outstandingPallets, 0) });
              });
              const deliverySuggestions = [...deliveryByName.values()].sort((left, right) => left.destination.localeCompare(right.destination));
              return <div className="simple-run-line" key={line.key} title={refs.length > 1 ? `${refs.length} source orders: ${refs.join(", ")}` : refs[0]}>
                <span className="simple-line-number">{lineIndex + 1}</span>
                <div className="simple-picker"><input autoComplete="off" value={line.collectionSite} onFocus={() => setOpenPicker(`${run.key}:${line.key}:collection`)} onBlur={() => window.setTimeout(() => setOpenPicker((current) => current === `${run.key}:${line.key}:collection` ? undefined : current), 120)} onChange={(event) => changeLineLocation(run.key, line, "collectionSite", event.target.value)} placeholder="Start typing live collection…" />{openPicker === `${run.key}:${line.key}:collection` && line.collectionSite && collectionSuggestions.length > 0 && normalise(collectionSuggestions[0]) !== normalise(line.collectionSite) ? <div className="simple-picker-options">{collectionSuggestions.map((collection) => <button type="button" key={collection} onMouseDown={(event) => event.preventDefault()} onClick={() => { chooseCollection(run.key, line.key, collection); setOpenPicker(undefined); }}>{collection}</button>)}</div> : null}</div>
                <input className="simple-pallet-input" type="number" min="0" inputMode="numeric" value={line.pallets} onChange={(event) => scheduleQuantity(run, line, event.target.value)} placeholder="0" />
                <div className="simple-picker"><input autoComplete="off" value={line.deliverySite} onFocus={() => setOpenPicker(`${run.key}:${line.key}:delivery`)} onBlur={() => window.setTimeout(() => setOpenPicker((current) => current === `${run.key}:${line.key}:delivery` ? undefined : current), 120)} onChange={(event) => changeLineLocation(run.key, line, "deliverySite", event.target.value)} placeholder="Choose delivery from this collection…" />{openPicker === `${run.key}:${line.key}:delivery` && deliverySuggestions.length > 0 && <div className="simple-picker-options delivery-options">{deliverySuggestions.map((choice) => <button type="button" key={choice.destination} onMouseDown={(event) => event.preventDefault()} onClick={() => { chooseDelivery(run.key, line.key, line.collectionSite, choice.destination); setOpenPicker(undefined); }}><span>{choice.destination}</span><small>{choice.pallets} pallet{choice.pallets === 1 ? "" : "s"}</small></button>)}</div>}</div>
                <input value={line.note} onChange={(event) => updateLine(run.key, line.key, { note: event.target.value })} onBlur={(event) => void persistLineNote(run, line, event.currentTarget.value)} placeholder={refs.length > 1 ? `${refs.length} orders consolidated` : "Facility / load-line note"} />
                <button type="button" className="simple-clear-line" aria-label={`Clear line ${lineIndex + 1}`} disabled={busyKey === `${run.key}:${line.key}`} onClick={(event) => { event.stopPropagation(); void clearLine(run, line); }}>×</button>
                {typedRoute && <small className={`simple-line-match ${matches.length ? "matched" : "unmatched"}`}>
                  {matches.length
                    ? `${matches.length} live order${matches.length === 1 ? "" : "s"} · ${matches.reduce((sum, order) => sum + order.outstandingPallets, 0)} available`
                    : "No live order matches this collection and delivery for the selected date"}
                </small>}
              </div>;
            })}</div>
            <div className="simple-run-footer"><div className="simple-line-actions"><button type="button" onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, lines: [...current.lines, blankLine()] })); }}>+ Add line</button>{!run.loadId && <button type="button" className="primary" disabled={Boolean(busyKey)} onClick={(event) => { event.stopPropagation(); void createPlanningRun(run); }}>{saving ? "Saving…" : "Retry save"}</button>}</div><small>{saving ? "Saving…" : run.loadId ? "✓ Live · available in Pallet Order" : "Select a valid collection and delivery to auto-save this run"}</small></div>
          </article>;
        })}
        <button className="simple-add-run" type="button" onClick={() => { const draft = newDraft(); setPlannerRuns((current) => [...current, draft]); setActiveKey(draft.key); }}>+ Add another run</button>
      </div>


    </div>
  </section>;
}
