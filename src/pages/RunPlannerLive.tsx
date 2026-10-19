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
import { findFinalRunSavings, type FinalCheckLine, type FinalCheckRun } from "./runPlannerFinalCheck";
import { suggestJobsForRun, suggestionConfidencePercent, type RunSuggestionLine, type RunSuggestionSite } from "./runPlannerSuggestions";
import { RunPlannerLine } from "./RunPlannerLine";

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
type RunDraft = { key: string; loadId?: string; period: Period; nightOut: boolean; doubleStackingApproved: boolean; operationalAmendment: string; relayEnabled: boolean; handoverSite: string; handoverAfterStopSequence: string; lines: RunLine[] };

const blankLine = (): RunLine => ({ key: crypto.randomUUID(), collectionSite: "", deliverySite: "", pallets: "", note: "" });
const blankRun = (key: string): RunDraft => ({
  key,
  period: "",
  nightOut: false,
  doubleStackingApproved: false,
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
  const [dismissedPlanChecks, setDismissedPlanChecks] = useState(() => new Set<string>());
  const saveTimers = useRef<Record<string, number>>({});
  // Multiple order additions can happen before the first request returns. Keep
  // each run's allocation/stop writes in order so they cannot race each other.
  const quantitySaveQueues = useRef<Record<string, Promise<boolean>>>({});
  const quantitySaveFailures = useRef(new Set<string>());
  const mutationCounter = useRef(0);
  const refreshSequence = useRef(0);
  const loadsRef = useRef<Load[]>([]);
  const sitesRef = useRef<Site[]>([]);
  const dirtyRunKeys = useRef(new Set<string>());
  const dirtyRunVersions = useRef(new Map<string, number>());
  const runsRef = useRef(runs);
  const setPlannerRuns = (next: RunDraft[] | ((current: RunDraft[]) => RunDraft[])) => {
    const resolved = typeof next === "function" ? next(runsRef.current) : next;
    runsRef.current = resolved;
    setRuns(resolved);
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
        doubleStackingApproved: tagged(load.plannerNotes, "Double stacking approved").toLowerCase() === "yes",
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
    const refresh = () => {
      if (dirtyRunKeys.current.size > 0) return;
      void refreshAll().catch(() => undefined);
    };
    const stopPolling = startVisiblePolling(refresh, 60_000);
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
  const matchingLiveOrders = useCallback((collection: string, delivery: string) => {
    const collectionKey = normalise(collection);
    const deliveryKey = normalise(delivery);
    if (!collectionKey || !deliveryKey) return [];
    return orders.filter(order => normalise(order.collection) === collectionKey && normalise(order.destination) === deliveryKey);
  }, [orders]);
  const matchingAvailableOrders = useCallback((collection: string, delivery: string) =>
    effectiveOrders.filter(order => order.outstandingPallets > 0
      && normalise(order.collection) === normalise(collection)
      && normalise(order.destination) === normalise(delivery)), [effectiveOrders]);

  const visibleRuns = useMemo(
    () => periodFilter === "ALL" ? runs : runs.filter((run) => run.period === periodFilter || !run.period),
    [periodFilter, runs],
  );
  const amRunCount = runs.filter((run) => run.period === "AM").length;
  const pmRunCount = runs.filter((run) => run.period === "PM").length;
  const finalRunSavings = useMemo(() => {
    const checkerRuns: FinalCheckRun[] = runs.map((run, index) => {
      let complete = true;
      const lines = run.lines.flatMap<FinalCheckLine>((line) => {
        const hasContent = Boolean(line.collectionSite.trim() || line.deliverySite.trim() || line.pallets.trim());
        if (!hasContent) return [];
        const quantity = validPallets(line.pallets) || 0;
        const ids = lineOrderIds(line);
        if (!quantity || !ids.length) {
          complete = false;
          return [];
        }
        if (line.orderAllocations) {
          const allocations = ids.flatMap((orderId) => {
            const pallets = Math.max(line.orderAllocations?.[orderId] || 0, 0);
            return pallets > 0 ? [{ orderId, collectionSite: line.collectionSite, deliverySite: line.deliverySite, pallets }] : [];
          });
          if (allocations.reduce((sum, allocation) => sum + allocation.pallets, 0) !== quantity) complete = false;
          return allocations;
        }
        if (ids.length !== 1) {
          complete = false;
          return [];
        }
        return [{ orderId: ids[0], collectionSite: line.collectionSite, deliverySite: line.deliverySite, pallets: quantity }];
      });
      return { key: run.key, label: `RUN ${index + 1}`, period: run.period, complete, lines };
    });
    return findFinalRunSavings(checkerRuns, orders).filter((suggestion) => !dismissedPlanChecks.has(suggestion.id));
  }, [dismissedPlanChecks, orders, runs]);
  const newDraft = () => {
    const draft = blankRun(`shell-${date}-${crypto.randomUUID()}`);
    if (periodFilter !== "ALL") draft.period = periodFilter;
    return draft;
  };
  const updateRun = (key: string, updater: (run: RunDraft) => RunDraft) => {
    dirtyRunKeys.current.add(key);
    dirtyRunVersions.current.set(key, (dirtyRunVersions.current.get(key) ?? 0) + 1);
    // Keep the ref current synchronously as well as React state. Several jobs can
    // be added before React renders again, and each save must build from every
    // line already added to this run.
    const nextRuns = runsRef.current.map((run) => run.key === key ? updater(run) : run);
    setPlannerRuns(nextRuns);
  };
  const updateLine = (runKey: string, lineKey: string, patch: Partial<RunLine>) => updateRun(runKey, (run) => ({ ...run, lines: run.lines.map((line) => line.key === lineKey ? { ...line, ...patch } : line) }));
  const addSuggestedOrder = (run: RunDraft, order: PlanningOrder) => {
    const currentRun = runsRef.current.find((candidate) => candidate.key === run.key) || run;
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
    const nextLines = [...currentRun.lines.filter(line => lineOrderIds(line).length > 0 || line.collectionSite.trim() || line.deliverySite.trim() || line.pallets.trim()), nextLine];
    updateRun(run.key, current => ({ ...current, lines: nextLines }));
    if (currentRun.loadId) {
      void enqueuePersistQuantity(run.key, nextLine.key, currentRun.loadId, { [order.id]: quantity }, quantity, nextLines);
      const runReference = loads.find((load) => load.id === currentRun.loadId)?.reference;
      setMessage(`Saving ${order.reference} to ${runReference || "the run"}…`);
    } else {
      // Suggested jobs must use the same immediate server save as a selected
      // collection/delivery. Keeping only the React draft left Pallet Order
      // unaware of this job until the planner manually retried the run.
      setMessage(`Saving ${order.reference} to the new run…`);
      void createPlanningRun({ ...currentRun, lines: nextLines });
    }
  };
  const changeLineLocation = (runKey: string, line: RunLine, field: "collectionSite" | "deliverySite", value: string) => {
    const currentRun = runsRef.current.find((run) => run.key === runKey);
    if (!currentRun) return;
    const nextLine = { ...line, [field]: value, orderId: undefined, orderIds: undefined, orderAllocations: undefined } as RunLine;
    const nextLines = currentRun.lines.map((item) => item.key === line.key ? nextLine : item);
    updateRun(runKey, (run) => ({ ...run, lines: nextLines }));
    // Manual entry follows the same autosave path as a picker selection once
    // the typed route resolves to live work for the selected date.
    if (field !== "deliverySite" || currentRun.loadId) return;
    const matches = matchingAvailableOrders(nextLine.collectionSite, nextLine.deliverySite);
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
    const matches = matchingAvailableOrders(collection, destination);
    if (!matches.length) return;
    const outstanding = matches.reduce((sum, order) => sum + Math.max(order.outstandingPallets, 0), 0);
    const currentRun = runsRef.current.find((run) => run.key === runKey);
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
    return calculateRunCapacity(capacityLines, orders, 26, 33, run.doubleStackingApproved);
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
    // The key belongs to this save operation: retries reuse it, while a later
    // edit back to a previously used quantity must create a new ledger event.
    const idempotencyKey = crypto.randomUUID();
    return request<AllocationResult>("/api/v1/planning-control/allocations", access, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, loadId, date, pallets, idempotencyKey, note: "Auto-saved from live Run Planner" }) });
  }

  async function allocateBatch(entries: Array<[string, number]>, loadId: string, access: string) {
    const allocations = entries.map(([orderId, pallets]) => ({
      orderId,
      loadId,
      date,
      pallets,
      idempotencyKey: crypto.randomUUID(),
      note: "Auto-saved from live Run Planner",
    }));
    return request<AllocationResult[]>("/api/v1/planning-control/allocations/bulk", access, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(allocations),
    });
  }

  async function syncStops(loadId: string, lines: RunLine[], access: string) {
    const stops = buildStops(lines);
    if (!stops.length) {
      try { await updateRunStops(loadId, [], access); } catch { /* allocation zero remains authoritative */ }
      return;
    }
    await updateRunStops(loadId, stops, access);
  }

  // Every mutation that replaces the complete stop list must share the same
  // per-run queue. Otherwise a note edit or removal can race an order add and
  // persist an older snapshot over the newer route.
  function enqueueRunMutation(runKey: string, mutation: () => Promise<void>) {
    const previous = quantitySaveQueues.current[runKey] || Promise.resolve(true);
    const next = previous.catch(() => true).then(async () => {
      await mutation();
      return true;
    });
    quantitySaveQueues.current[runKey] = next;
    void next.then(
      () => { if (quantitySaveQueues.current[runKey] === next) delete quantitySaveQueues.current[runKey]; },
      () => { if (quantitySaveQueues.current[runKey] === next) delete quantitySaveQueues.current[runKey]; },
    );
    return next;
  }

  function notesForRun(run: RunDraft, period = run.period) {
    const current = loads.find((item) => item.id === run.loadId)?.plannerNotes;
    let notes = plannerTag(plannerTag(withPlannerPeriod(current, period), "Night out", run.nightOut ? "Yes" : "No"), "Operational amendment", run.operationalAmendment);
    notes = plannerTag(notes, "Double stacking approved", run.doubleStackingApproved ? "Yes" : "No");
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
    let createdRun: Load | undefined;
    try {
      const access = await token();
      const enteredLines = run.lines.filter((line) =>
        Boolean(line.collectionSite.trim() || line.deliverySite.trim() || line.pallets.trim()));
      const linkedLines = run.lines.map((line) => {
        const matches = matchingAvailableOrders(line.collectionSite, line.deliverySite);
        if (lineOrderIds(line).length || matches.length === 0) return line;
        return {
          ...line,
          orderId: matches[0].id,
          orderIds: matches.map((order) => order.id),
          orderAllocations: undefined,
        };
      });
      const unresolved = enteredLines.filter((line) =>
        !matchingAvailableOrders(line.collectionSite, line.deliverySite).length &&
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
        // Line quantities are allocated straight after creation; the allocation
        // updates the run's used spaces.
        palletSpacesUsed: 0,
        totalPalletSpaces: capacity.standardCapacity,
        capacityType: `Standard pallets · ${capacity.status} · ${capacity.utilisationPercent}%`,
        plannerNotes: notesForRun(run),
        stops,
      }, access);
      createdRun = created;
      // Keep the created run on screen even if one of the subsequent allocation
      // writes fails. The run and its stops are already live at this point.
      setLoads((current) => current.some((load) => load.id === created.id) ? current : [...current, created]);
      updateRun(run.key, (current) => ({ ...current, loadId: created.id, lines: linkedLines }));
      // The create response is the authoritative write result. Do not immediately
      // re-read the full run register here: that expensive read was the source
      // of gateway 504s after a successful run save.
      const confirmed = created;
      if (!confirmed?.id) throw new Error(`${created.reference} was accepted without a run id. The draft has been kept for retry.`);
      // Putting an order on a run plans its quantity straight away, so Pallet Order's
      // "To plan" drops the moment the run exists. Later edits replace these figures.
      const lineAllocations = new Map<string, number>();
      for (const line of linkedLines) {
        const ids = lineOrderIds(line);
        if (!ids.length) continue;
        if (line.orderAllocations) {
          for (const id of ids) lineAllocations.set(id, (lineAllocations.get(id) || 0) + Math.max(line.orderAllocations[id] || 0, 0));
          continue;
        }
        let remaining = validPallets(line.pallets) || 0;
        for (const id of ids) {
          const order = orders.find((item) => item.id === id);
          const quantity = ids.length === 1 ? remaining : Math.min(remaining, Math.max(order?.outstandingPallets ?? 0, 0));
          if (quantity > 0) lineAllocations.set(id, (lineAllocations.get(id) || 0) + quantity);
          remaining -= quantity;
        }
      }
      const allocationEntries = [...lineAllocations.entries()].filter(([, pallets]) => pallets > 0);
      if (allocationEntries.length === 1) await allocate(allocationEntries[0][0], created.id, allocationEntries[0][1], access);
      else if (allocationEntries.length > 1) await allocateBatch(allocationEntries, created.id, access);
      if (run.relayEnabled) await updateRunRelay(created.id, relayPayload(run), access);
      dirtyRunKeys.current.delete(run.key);
      signalPlanningChange();
      setMessage(`${created.reference} created and planned in Pallet Order.`);
      void refreshControl().catch(() => undefined);
      return created.id;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The save could not be completed.";
      setMessage(createdRun
        ? `${createdRun.reference} was created and kept, but its order allocations need retrying: ${reason}`
        : reason);
      if (createdRun) signalPlanningChange();
      return createdRun?.id;
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

  async function persistQuantity(runKey: string, lineKey: string, loadId: string, allocations: Record<string, number>, pallets: number, linesAfterEdit: RunLine[], persistStops = true) {
    const mutation = ++mutationCounter.current;
    const dirtyVersion = dirtyRunVersions.current.get(runKey) ?? 0;
    const key = `${runKey}:${lineKey}`;
    setBusyKey(key);
    try {
      const access = await token();
      // Save the whole consolidated row in one server transaction. This keeps
      // Pallet Control from seeing a partially-written row and removes the
      // repeated ledger reads that previously caused slow mobile saves/504s.
      const entries = Object.entries(allocations);
      // A quantity edit is a single allocation replacement. Use the proven
      // single-allocation endpoint for it; reserve the batch endpoint for
      // genuinely multi-order consolidated rows.
      if (entries.length === 1) {
        await allocate(entries[0][0], loadId, entries[0][1], access);
      } else {
        await allocateBatch(entries, loadId, access);
      }
      // Adding an order changes the route's stops. A quantity-only edit does not,
      // so avoid a second write that can time out after the allocation succeeded.
      if (persistStops) {
        // A queued save may have been created before the next clicks rendered.
        // Read the current run immediately before replacing its stop list so an
        // older snapshot cannot remove jobs added while this request was running.
        const latestLines = runsRef.current.find((run) => run.key === runKey)?.lines || linesAfterEdit;
        await syncStops(loadId, latestLines, access);
      }
      // Only clear the dirty marker after every save has succeeded. Keep newer
      // edits protected if they were made while this request was in flight.
      if (dirtyRunVersions.current.get(runKey) === dirtyVersion) dirtyRunKeys.current.delete(runKey);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pallet quantity could not be auto-saved.");
      if (mutation === mutationCounter.current) void refreshAll();
      return false;
    } finally { setBusyKey((current) => current === key ? undefined : current); }
  }

  function enqueuePersistQuantity(runKey: string, lineKey: string, loadId: string, allocations: Record<string, number>, pallets: number, linesAfterEdit: RunLine[], persistStops = true) {
    const previous = quantitySaveQueues.current[runKey] || Promise.resolve(true);
    if (!quantitySaveQueues.current[runKey]) quantitySaveFailures.current.delete(runKey);
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const saved = await persistQuantity(runKey, lineKey, loadId, allocations, pallets, linesAfterEdit, persistStops);
        if (!saved) quantitySaveFailures.current.add(runKey);
        return saved;
      });
    quantitySaveQueues.current[runKey] = next;
    void next.then(
      (saved) => {
        if (quantitySaveQueues.current[runKey] !== next) return;
        delete quantitySaveQueues.current[runKey];
        if (quantitySaveFailures.current.has(runKey) || !saved) return;
        quantitySaveFailures.current.delete(runKey);
        signalPlanningChange();
        setMessage(`Saved to Pallet Control · ${pallets} load unit${pallets === 1 ? "" : "s"} on this consolidated movement.`);
      },
      () => { if (quantitySaveQueues.current[runKey] === next) delete quantitySaveQueues.current[runKey]; },
    );
    return next;
  }

  function scheduleQuantity(run: RunDraft, line: RunLine, value: string) {
    const currentRun = runsRef.current.find((item) => item.key === run.key) || run;
    const currentLine = currentRun.lines.find((item) => item.key === line.key) || line;
    const pallets = validPallets(value);
    if (pallets === undefined) { updateLine(run.key, line.key, { pallets: value }); return; }
    const ids = lineOrderIds(currentLine);
    if (!ids.length || !currentRun.loadId) { updateLine(run.key, line.key, { pallets: value }); return; }
    const distributed = distributeQuantity(ids, pallets, currentRun.key);
    if (distributed.remaining > 0) {
      const maximum = pallets - distributed.remaining;
      setMessage(`Maximum available for this consolidated movement is ${maximum} load units.`);
      return;
    }
    const linesAfterEdit = currentRun.lines.map((item) => item.key === line.key ? { ...item, pallets: value, orderAllocations: distributed.allocations } : item);
    updateRun(run.key, (current) => ({ ...current, lines: linesAfterEdit }));
    const timerKey = `${run.key}:${line.key}`;
    if (saveTimers.current[timerKey]) window.clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = window.setTimeout(() => {
      delete saveTimers.current[timerKey];
      // Notify Pallet Order once the input has settled. The successful save
      // below emits again, so a refresh that races the request is followed by
      // the authoritative result without refreshing on every keystroke.
      signalPlanningChange();
      void enqueuePersistQuantity(currentRun.key, line.key, currentRun.loadId!, distributed.allocations, pallets, linesAfterEdit, false);
    }, 250);
  }

  async function persistLineNote(run: RunDraft, line: RunLine, note: string) {
    const currentRun = runsRef.current.find((item) => item.key === run.key) || run;
    const linesAfterEdit = currentRun.lines.map((item) => item.key === line.key ? { ...item, note } : item);
    updateRun(run.key, (current) => ({ ...current, lines: linesAfterEdit }));
    if (!currentRun.loadId || !lineOrderIds(line).length) return;
    const key = `${run.key}:${line.key}:note`;
    setBusyKey(key);
    try {
      await enqueueRunMutation(run.key, async () => {
        const latestLines = runsRef.current.find((item) => item.key === run.key)?.lines || linesAfterEdit;
        await syncStops(currentRun.loadId!, latestLines, await token());
      });
      dirtyRunKeys.current.delete(run.key); signalPlanningChange(); setMessage("Line note auto-saved.");
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Line note could not be saved."); }
    finally { setBusyKey((current) => current === key ? undefined : current); }
  }

  async function clearLine(run: RunDraft, line: RunLine) {
    const currentRun = runsRef.current.find((item) => item.key === run.key) || run;
    const timerKey = `${run.key}:${line.key}`;
    if (saveTimers.current[timerKey]) { window.clearTimeout(saveTimers.current[timerKey]); delete saveTimers.current[timerKey]; }
    const remaining = currentRun.lines.length === 1 ? [blankLine()] : currentRun.lines.filter((item) => item.key !== line.key);
    updateRun(run.key, (current) => ({ ...current, lines: remaining }));
    const ids = lineOrderIds(line);
    if (!ids.length || !currentRun.loadId) return;
    setBusyKey(timerKey);
    try {
      await enqueueRunMutation(run.key, async () => {
        const access = await token();
        for (const orderId of ids) await allocate(orderId, currentRun.loadId!, 0, access);
        const latestLines = runsRef.current.find((item) => item.key === run.key)?.lines || remaining;
        if (latestLines.some(item => lineOrderIds(item).length > 0)) {
          await syncStops(currentRun.loadId!, latestLines, access);
        } else {
          // Removing the final movement leaves a cancellation tombstone.
          await updateRunStatus(currentRun.loadId!, "Cancelled", access);
        }
      });
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
    {finalRunSavings.length > 0 && <details className="simple-plan-check" data-testid="planner-final-run-check">
      <summary><span><strong>Plan check</strong><small>{finalRunSavings.length} possible run saving{finalRunSavings.length === 1 ? "" : "s"}</small></span><span>Review</span></summary>
      <div className="simple-plan-check-list">{finalRunSavings.map((suggestion) => <article key={suggestion.id}>
        <div className="simple-plan-check-title"><span><strong>Could remove {suggestion.sourceRunLabel}</strong><small>Capacity-safe pallet move; route order and timing still need your confirmation.</small></span><button type="button" onClick={() => setDismissedPlanChecks((current) => new Set([...current, suggestion.id]))}>Dismiss</button></div>
        <ol>{suggestion.movements.map((movement, index) => <li key={`${movement.fromRunKey}:${movement.toRunKey}:${index}`}><strong>{movement.pallets} {movement.palletLabel}</strong> · {movement.collectionSite} → {movement.deliverySite} · {movement.fromRunLabel} to {movement.toRunLabel}</li>)}</ol>
        <div className="simple-plan-check-results">{suggestion.resultingUtilisation.map((result) => <span key={result.runKey}><strong>{result.runLabel}</strong> {result.percent}% full</span>)}<span className="timing-check">Timing confirmation required</span></div>
      </article>)}</div>
    </details>}
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
          const capacityRemaining = capacity.status === "Red"
            ? `Over by ${capacity.overStandardEquivalent.toFixed(1)} floor spaces`
            : `Space for ${capacity.euroRemaining} more Euro pallets · ${capacity.standardRemaining} Standard · ${capacity.trolleyRemaining} trolleys`;
          const suggestionLines: RunSuggestionLine[] = run.lines.map(line => ({ orderId: lineOrderIds(line)[0], collectionSite: line.collectionSite, deliverySite: line.deliverySite, pallets: line.pallets }));
          const suggestionSites: RunSuggestionSite[] = sites;
          const nextOrderSuggestions = suggestJobsForRun(suggestionLines, effectiveOrders, suggestionSites, { standard: capacity.standardRemaining, euro: capacity.euroRemaining });
          const builderWarnings = runBuilderWarnings(run, capacity, effectiveOrders, sites);
          return <article key={run.key} className={`simple-run-card ${activeKey === run.key ? "active" : ""}`} onClick={() => setActiveKey(run.key)}>
            <div className="simple-run-header"><div className="simple-run-heading"><strong>RUN {index + 1}{run.period ? ` ${run.period}` : ""}{run.nightOut ? " O/N" : ""}</strong><small>{run.loadId ? "Live" : "New"}</small><span className={`simple-run-capacity ${capacityStatus}`} title={`${capacityBreakdown} · ${usedCapacity.toFixed(1)} / ${totalCapacity} standard-equivalent spaces`}><i><b style={{ width: `${Math.min(utilisation, 100)}%` }} /></i><strong>{utilisation.toFixed(1)}%</strong></span><span className="simple-run-capacity-remaining" aria-label={capacityRemaining}>{capacityRemaining}</span><span className="simple-run-capacity-breakdown" aria-label={`Capacity: ${capacityBreakdown}`}><span>Std {capacity.standardPallets}/{capacity.standardCapacity} · {capacity.standardRemaining} left</span><span>Euro {capacity.euroPallets}/{capacity.euroCapacity} · {capacity.euroRemaining} left</span><span>Trolley {capacity.trolleys}/{capacity.trolleys + capacity.trolleyRemaining} · {capacity.trolleyRemaining} left</span><span>Tray/Crate {capacity.nonPalletUnits}</span>{capacity.unknownPallets ? <span>Unknown {capacity.unknownPallets}</span> : null}</span></div><div className="run-period-selector"><span>Period</span>{(["AM", "PM"] as const).map((period) => <button key={period} type="button" className={run.period === period ? "selected" : ""} onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, period })); void persistRunDetails(run, { period }); }}>{period}</button>)}</div></div>
            <div className="simple-run-details"><label className="simple-night-out"><input type="checkbox" checked={run.nightOut} onChange={(event) => { const nightOut = event.target.checked; updateRun(run.key, (current) => ({ ...current, nightOut })); void persistRunDetails(run, { nightOut }); }} /> Overnight / night-out confirmed</label><label className="simple-night-out"><input type="checkbox" checked={run.relayEnabled} onChange={(event) => { const relayEnabled = event.target.checked; updateRun(run.key, (current) => ({ ...current, relayEnabled })); void persistRunDetails(run, { relayEnabled }); }} /> Trailer swap / relay</label><label>Operational amendment<input value={run.operationalAmendment} placeholder="e.g. swap to trailer 123 / breakdown" onChange={(event) => updateRun(run.key, (current) => ({ ...current, operationalAmendment: event.target.value }))} onBlur={() => void persistRunDetails(run, { operationalAmendment: run.operationalAmendment })} /></label>{run.relayEnabled && <><label>Handover site<input list={`relay-sites-${run.key}`} value={run.handoverSite} placeholder="e.g. Cherwell Valley" onChange={(event) => updateRun(run.key, (current) => ({ ...current, handoverSite: event.target.value }))} onBlur={(event) => void persistRunDetails(run, { handoverSite: event.currentTarget.value })} /></label><label>Handover after stop<input type="number" min="1" value={run.handoverAfterStopSequence} placeholder="Optional" onChange={(event) => updateRun(run.key, (current) => ({ ...current, handoverAfterStopSequence: event.target.value }))} onBlur={(event) => void persistRunDetails(run, { handoverAfterStopSequence: event.currentTarget.value })} /></label><datalist id={`relay-sites-${run.key}`}>{sites.map(site => <option key={site.id} value={site.name} />)}</datalist></>}</div>
            {nextOrderSuggestions.length > 0 && <details className="simple-run-suggestions" aria-label={`Suggested next orders for ${run.key}`} onClick={(event) => event.stopPropagation()}><summary className="simple-run-suggestions-heading"><span><strong>Route suggestions</strong><small>{nextOrderSuggestions.length} sensible fit{nextOrderSuggestions.length === 1 ? "" : "s"} · mileage and direction checked</small></span><span className="simple-run-suggestion-hint">Show</span></summary><div className="simple-run-suggestion-list">{nextOrderSuggestions.map(item => { const confidencePercent = suggestionConfidencePercent(item.score); const confidence = confidencePercent >= 70 ? "high" : confidencePercent >= 45 ? "medium" : "low"; const loadType = item.order.palletType || item.order.loadUnitType; return <article key={item.order.id} className={`simple-run-suggestion confidence-${confidence}`}><div className="simple-run-suggestion-route"><span><small>From</small><strong>{item.order.collection}</strong></span><b aria-hidden="true">→</b><span><small>To</small><strong>{item.order.destination}</strong></span></div><div className="simple-run-suggestion-meta"><span><small>Load</small><strong>{item.order.outstandingPallets}{loadType ? ` ${loadType}` : ""}</strong></span>{item.connectorMiles != null && <span><small>Reposition</small><strong>~{Math.round(item.connectorMiles)} mi</strong></span>}<span><small>Fit</small><strong>{confidencePercent}%</strong></span></div><details><summary>Why?</summary><small>{item.reasons.join(" · ")}</small></details><button type="button" onClick={() => addSuggestedOrder(run, item.order)}>Add</button></article>; })}</div></details>}
            {builderWarnings.length > 0 && <aside className="simple-run-warnings" aria-label="Run builder checks"><strong>Planner checks</strong><ul>{builderWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></aside>}
            <div className="simple-run-columns"><span>Collection</span><span>Pallets</span><span>Delivery</span><span>Line note</span><span /></div>
            <div className="simple-run-lines">{run.lines.map((line, lineIndex) => (
              <RunPlannerLine
                key={line.key}
                run={run}
                line={line}
                lineIndex={lineIndex}
                effectiveOrders={effectiveOrders}
                sites={sites}
                liveCollections={liveCollections}
                availableOrders={availableOrders}
                busyKey={busyKey}
                openPicker={openPicker}
                setOpenPicker={setOpenPicker}
                changeLineLocation={changeLineLocation}
                scheduleQuantity={scheduleQuantity}
                chooseCollection={chooseCollection}
                chooseDelivery={chooseDelivery}
                updateLine={updateLine}
                persistLineNote={persistLineNote}
                clearLine={clearLine}
              />
            ))}</div>
            <div className="simple-run-footer"><div className="simple-line-actions"><button type="button" onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, lines: [...current.lines, blankLine()] })); }}>+ Add line</button>{!run.loadId && <button type="button" className="primary" disabled={Boolean(busyKey)} onClick={(event) => { event.stopPropagation(); void createPlanningRun(run); }}>{saving ? "Saving…" : "Retry save"}</button>}</div><small>{saving ? "Saving…" : run.loadId ? "✓ Live · available in Pallet Order" : "Select a valid collection and delivery to auto-save this run"}</small></div>
          </article>;
        })}
        <button className="simple-add-run" type="button" onClick={() => { const draft = newDraft(); setPlannerRuns((current) => [...current, draft]); setActiveKey(draft.key); }}>+ Add another run</button>
      </div>


    </div>
  </section>;
}

