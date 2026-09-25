import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, request, type Load, type Site } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { startVisiblePolling } from "../lib/visiblePolling";
import "../simple-planner.css";
import { createRun, listRuns, updateRunStatus, updateRunStops } from '../api/runs';
import { planningDeliveryLocation } from "../lib/planningLocations";

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
type RunDraft = { key: string; loadId?: string; period: Period; nightOut: boolean; operationalAmendment: string; lines: RunLine[] };

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
function lineOrderIds(line: RunLine) {
  return line.orderIds?.length ? line.orderIds : line.orderId ? [line.orderId] : [];
}

function orderLineNote(order: PlanningOrder) {
  return order.lineNote?.trim() || `Ref: ${order.reference}`;
}

function mergeLineNotes(...values: Array<string | undefined>) {
  const parts = values
    .flatMap(value => (value || "").split("·"))
    .map(value => value.trim())
    .filter(Boolean);
  return [...new Map(parts.map(value => [normalise(value), value])).values()].join(" · ");
}

function validPallets(value: string) {
  const pallets = Number(value);
  return Number.isInteger(pallets) && pallets >= 0 ? pallets : undefined;
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
        note: mergeLineNotes(
          existing.note,
          line.note,
          ...ids.map(id => ordersById.get(id)).filter((order): order is PlanningOrder => Boolean(order)).map(orderLineNote),
        ),
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
          return [{ key: `${load.id}-${order.id}`, orderId: order.id, collectionSite: plannerSiteName(nextSites, order.collection), deliverySite: plannerSiteName(nextSites, order.destination), pallets: String(allocation.pallets), note: mergeLineNotes(stop.plannerNote, orderLineNote(order)) }];
        });
      const unsequencedLines = nextControl.orders.flatMap((order) => {
        if (seenOrderIds.has(order.id)) return [];
        const allocation = order.allocations.find((item) => item.loadId === load.id && item.pallets > 0);
        return allocation ? [{ key: `${load.id}-${order.id}`, orderId: order.id, collectionSite: plannerSiteName(nextSites, order.collection), deliverySite: plannerSiteName(nextSites, order.destination), pallets: String(allocation.pallets), note: mergeLineNotes(load.stops.find((stop) => stop.orderId === order.id && /^deliver/i.test(stop.name))?.plannerNote, orderLineNote(order)) }] : [];
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
    const nextControl = normalisePlanningControl(await request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, access));
    const [loadsResult, sitesResult] = await Promise.allSettled([listRuns(date, access), api.sites(access)]);
    const safeLoads = loadsResult.status === "fulfilled" && Array.isArray(loadsResult.value) ? loadsResult.value : [];
    const safeSites = sitesResult.status === "fulfilled" && Array.isArray(sitesResult.value) ? sitesResult.value : [];
    setControl(nextControl);
    setLoads(safeLoads);
    setSites(safeSites);
    if (loadsResult.status === "rejected" || sitesResult.status === "rejected") setMessage("Planner loaded the approved pallet balance. Some run or site master data is temporarily unavailable.");
    hydrate(nextControl, safeLoads, safeSites);
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
  const canonicaliseSiteEntry = (runKey: string, lineKey: string, field: "collectionSite" | "deliverySite", value: string) => {
    const site = siteFor(sites, value);
    if (site) updateLine(runKey, lineKey, { [field]: site.name?.trim() || site.driverTextName?.trim() || value });
  };
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

  async function createPlanningRun(run: RunDraft) {
    if (run.loadId || busyKey) return run.loadId;
    setBusyKey(run.key);
    setMessage(undefined);
    try {
      const access = await token();
      const index = Math.max(runs.findIndex((item) => item.key === run.key), 0);
      const existingReferences = new Set(loads.map((load) => load.reference.toUpperCase()));
      let number = index + 1;
      while (existingReferences.has(runRef(date, number).toUpperCase())) number += 1;
      const created = await createRun({
        reference: runRef(date, number),
        planningDate: date,
        palletSpacesUsed: runTotal(run),
        totalPalletSpaces: 26,
        capacityType: "Standard pallets",
        plannerNotes: notesForRun(run),
        stops: buildStops(run.lines),
      }, access);
      setLoads((current) => current.some((load) => load.id === created.id) ? current : [...current, created]);
      updateRun(run.key, (current) => ({ ...current, loadId: created.id }));
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

  return <section className="simple-planner">
    <div className="simple-planner-toolbar">
      {dateIsExternallyControlled ? <span><strong>{date}</strong><small> plan date</small></span> : <label>Plan date <input type="date" value={date} onChange={(event) => resetForDate(event.target.value)} /></label>}
      <button onClick={() => void refreshAll()} disabled={Boolean(busyKey)}>Refresh</button>
      <button className="primary" onClick={() => { const draft = newDraft(); setRuns((current) => [...current, draft]); setActiveKey(draft.key); }}>+ Add run</button>
      <div className="run-period-selector" role="tablist" aria-label="Planner period"><span>View</span><button type="button" className={periodFilter === "ALL" ? "selected" : ""} onClick={() => setPeriodFilter("ALL")}>All ({runs.length})</button><button type="button" className={periodFilter === "AM" ? "selected" : ""} onClick={() => setPeriodFilter("AM")}>AM ({amRunCount})</button><button type="button" className={periodFilter === "PM" ? "selected" : ""} onClick={() => setPeriodFilter("PM")}>PM / O/N ({pmRunCount})</button></div>
      <div className="simple-planner-summary"><span><strong>{summary.planned}</strong><small>planned</small></span><span><strong>{summary.outstanding}</strong><small>remaining</small></span></div>
    </div>

    {message && <p className="notice inline-notice simple-planner-notice">{message}</p>}
    <datalist id="planner-site-options">
      {[...sites].filter(site => site.active !== false).sort((left, right) => left.name.localeCompare(right.name)).map(site =>
        <option key={site.id} value={site.name}>{[site.externalCode, site.driverTextName, site.collectionAddress].filter(Boolean).join(" · ")}</option>)}
    </datalist>

    <div className="simple-planner-layout">
      <div className="simple-run-builder">
        <div className="simple-section-heading"><div><p className="eyebrow">Run builder</p><h2>{visibleRuns.length} run{visibleRuns.length === 1 ? "" : "s"}</h2></div><small>Use Pallet Order on the second screen to allocate work. This builder stays focused on route sequence, locations and notes.</small></div>
        {visibleRuns.map((run) => {
          const index = runs.indexOf(run);
          const saving = busyKey === run.key || busyKey?.startsWith(`${run.key}:`);
          return <article key={run.key} className={`simple-run-card ${activeKey === run.key ? "active" : ""}`} onClick={() => setActiveKey(run.key)}>
            <div className="simple-run-header"><div><strong>RUN {index + 1}{run.period ? ` ${run.period}` : ""}{run.nightOut ? " O/N" : ""}</strong><small>{run.loadId ? "Live" : "New"}</small></div><div className="run-period-selector"><span>Period</span>{(["AM", "PM"] as const).map((period) => <button key={period} type="button" className={run.period === period ? "selected" : ""} onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, period })); void persistRunDetails(run, { period }); }}>{period}</button>)}</div></div>
            <div className="simple-run-details"><label className="simple-night-out"><input type="checkbox" checked={run.nightOut} onChange={(event) => { const nightOut = event.target.checked; updateRun(run.key, (current) => ({ ...current, nightOut })); void persistRunDetails(run, { nightOut }); }} /> Overnight / night-out confirmed</label><label>Operational amendment<input value={run.operationalAmendment} placeholder="e.g. swap to trailer 123 / breakdown" onChange={(event) => updateRun(run.key, (current) => ({ ...current, operationalAmendment: event.target.value }))} onBlur={() => void persistRunDetails(run, { operationalAmendment: run.operationalAmendment })} /></label></div>
            <div className="simple-run-columns"><span>Collection</span><span>Pallets</span><span>Delivery</span><span>Line note</span><span /></div>
            <div className="simple-run-lines">{run.lines.map((line, lineIndex) => {
              const refs = lineOrderIds(line).map((id) => effectiveOrders.find((order) => order.id === id)?.reference).filter(Boolean);
              return <div className="simple-run-line" key={line.key} title={refs.length > 1 ? `${refs.length} source orders: ${refs.join(", ")}` : refs[0]}>
                <span className="simple-line-number">{lineIndex + 1}</span>
                <input list="planner-site-options" autoComplete="off" value={line.collectionSite} readOnly={lineOrderIds(line).length > 0} onChange={(event) => updateLine(run.key, line.key, { collectionSite: event.target.value })} onBlur={(event) => canonicaliseSiteEntry(run.key, line.key, "collectionSite", event.currentTarget.value)} placeholder="Start typing collection site…" />
                <input className="simple-pallet-input" type="number" min="0" inputMode="numeric" value={line.pallets} onChange={(event) => scheduleQuantity(run, line, event.target.value)} placeholder="0" />
                <input list="planner-site-options" autoComplete="off" value={line.deliverySite} readOnly={lineOrderIds(line).length > 0} onChange={(event) => updateLine(run.key, line.key, { deliverySite: event.target.value })} onBlur={(event) => canonicaliseSiteEntry(run.key, line.key, "deliverySite", event.currentTarget.value)} placeholder="Start typing delivery site…" />
                <input value={line.note} onChange={(event) => updateLine(run.key, line.key, { note: event.target.value })} onBlur={(event) => void persistLineNote(run, line, event.currentTarget.value)} placeholder={refs.length > 1 ? `${refs.length} orders consolidated` : "Facility / load-line note"} />
                <button type="button" className="simple-clear-line" aria-label={`Clear line ${lineIndex + 1}`} disabled={busyKey === `${run.key}:${line.key}`} onClick={(event) => { event.stopPropagation(); void clearLine(run, line); }}>×</button>
              </div>;
            })}</div>
            <div className="simple-run-footer"><div className="simple-line-actions"><button type="button" onClick={(event) => { event.stopPropagation(); updateRun(run.key, (current) => ({ ...current, lines: [...current.lines, blankLine()] })); }}>+ Add line</button>{!run.loadId && <button type="button" className="primary" disabled={Boolean(busyKey)} onClick={(event) => { event.stopPropagation(); void createPlanningRun(run); }}>{saving ? "Creating…" : "Create run"}</button>}</div><small>{saving ? "Saving…" : run.loadId ? "✓ Live · available in Pallet Order" : "Create this run before allocating orders from Pallet Order"}</small></div>
          </article>;
        })}
        <button className="simple-add-run" type="button" onClick={() => { const draft = newDraft(); setRuns((current) => [...current, draft]); setActiveKey(draft.key); }}>+ Add another run</button>
      </div>


    </div>
  </section>;
}
