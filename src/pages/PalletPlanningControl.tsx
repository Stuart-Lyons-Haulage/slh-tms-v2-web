import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { useApi } from "../lib/useApi";
import { startVisiblePolling } from "../lib/visiblePolling";

type Allocation = { loadId: string; loadReference?: string; pallets: number; updatedAtUtc: string; updatedBy?: string };
type SourceLine = { sourceLineId: string; sourcePalletType?: string; palletType?: string; loadUnitType?: string; palletColourKey?: string; orderedPallets: number; plannedPallets: number; outstandingPallets: number };
type PlanningOrder = { id: string; reference: string; customerCode: string; collectionDate: string; deliveryDate?: string; deliveryWindowStartUtc?: string; deliveryWindowEndUtc?: string; orderedPallets: number; plannedPallets: number; outstandingPallets: number; overplannedPallets: number; collection: string; destination: string; originalDestination?: string; planningGroup: string; planningSection?: string; planningWindow?: string; suggestedRouteType?: string; runsOvernight?: boolean; temperature?: string; palletType?: string; loadUnitType?: string; palletColourKey?: string; source?: string; receivedAtUtc: string; lateAddition: boolean; sourceLines?: SourceLine[]; allocations: Allocation[] };
type PlanningCell = { planningGroup: string; destination: string; ordered: number; planned: number; outstanding: number; overplanned: number; orderIds: string[] };
type PlanningRun = { id: string; reference: string; status: string; trailerId?: string; palletSpacesUsed?: number; totalPalletSpaces?: number; capacityType?: string; stopCount: number };
type PlanningControlData = { date: string; generatedAtUtc: string; summary: { ordered: number; planned: number; outstanding: number; overplanned: number; lateAdditions: number; orders: number; runs: number }; planningGroups: string[]; destinations: string[]; cells: PlanningCell[]; orders: PlanningOrder[]; runs: PlanningRun[] };
type RegionData = { date: string; destinations: string[]; destinationRegions: Record<string, string>; destinationLabels?: Record<string, string>; destinationSiteCodes?: Record<string, string | null>; unmatchedDestinations?: number };
type ViewMode = "toPlan" | "planned" | "summary";
type PalletTone = "standard" | "euro" | "traycrate" | "trolley" | "mixed" | "unknown";

function planningDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function ukDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function fmtTime(value?: string) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
function palletTone(colourKey?: string, loadUnitType?: string, palletType?: string): PalletTone { const clean = `${colourKey || ""} ${loadUnitType || ""} ${palletType || ""}`.toLowerCase(); if (clean.includes("tray") || clean.includes("crate")) return "traycrate"; if (clean.includes("trolley") || clean.includes("dolly")) return "trolley"; if (clean.includes("euro")) return "euro"; if (clean.includes("standard") || clean.includes("std")) return "standard"; if (clean.includes("mixed")) return "mixed"; return "unknown"; }
function palletLabel(order: PlanningOrder) { if (order.loadUnitType && order.loadUnitType !== "Pallet") return order.loadUnitType; const tone = palletTone(order.palletColourKey, order.loadUnitType, order.palletType); return tone === "standard" ? "Standard" : tone === "euro" ? "Euro" : order.palletType || order.loadUnitType || "Unknown"; }
function toneBackground(tone: PalletTone) { if (tone === "standard") return "#dbeafe"; if (tone === "euro") return "#ffedd5"; if (tone === "traycrate") return "#dcfce7"; if (tone === "trolley") return "#fef9c3"; if (tone === "mixed") return "linear-gradient(135deg, #dbeafe 0 25%, #ffedd5 25% 50%, #dcfce7 50% 75%, #fef9c3 75% 100%)"; return "#f3f4f6"; }
function toneBorder(tone: PalletTone) { if (tone === "standard") return "#2563eb"; if (tone === "euro") return "#ea580c"; if (tone === "traycrate") return "#16a34a"; if (tone === "trolley") return "#ca8a04"; if (tone === "mixed") return "#7c3aed"; return "#9ca3af"; }
function sectionLabel(value?: string) { return value?.toLowerCase().includes("pm") ? "PM / Overnight" : "AM"; }

export function PalletPlanningControl() {
  const token = useAccessToken();
  const [date, setDate] = useState(planningDate());
  const [selectedCell, setSelectedCell] = useState<{ group: string; destination: string }>();
  const [message, setMessage] = useState<string>();
  const [busyKey, setBusyKey] = useState<string>();
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, { loadId: string; pallets: string }>>({});
  const control = useApi(useCallback(async () => request<PlanningControlData>(`/api/v1/planning-control/pallets?date=${encodeURIComponent(date)}`, await token()), [date, token]));
  const regions = useApi(useCallback(async () => request<RegionData>(`/api/v1/planning-control/regions?date=${encodeURIComponent(date)}`, await token()), [date, token]));
  const refreshControl = control.refresh;
  const refreshRegions = regions.refresh;

  useEffect(() => {
    const unsubscribe = subscribePlanningChanges(() => { void refreshControl(); void refreshRegions(); });
    const stopReconciliation = startVisiblePolling(() => Promise.allSettled([refreshControl(), refreshRegions()]).then(() => undefined), 30_000);
    return () => { unsubscribe(); stopReconciliation(); };
  }, [refreshControl, refreshRegions]);

  const data = control.data;
  const orderById = useMemo(() => new Map((data?.orders || []).map(order => [order.id, order])), [data?.orders]);
  const orderedDestinations = useMemo(() => { if (!data) return []; const live = new Set(data.destinations); const ranked = (regions.data?.destinations || []).filter(destination => live.has(destination)); return [...ranked, ...data.destinations.filter(destination => !ranked.includes(destination))]; }, [data, regions.data]);
  const destinationLabel = useCallback((destination: string) => regions.data?.destinationLabels?.[destination] || destination, [regions.data]);
  const regionGroups = useMemo(() => { const groups: Array<{ region: string; destinations: string[] }> = []; for (const destination of orderedDestinations) { const region = regions.data?.destinationRegions?.[destination] || "Other"; const last = groups[groups.length - 1]; if (last?.region === region) last.destinations.push(destination); else groups.push({ region, destinations: [destination] }); } return groups; }, [orderedDestinations, regions.data]);
  const cellMap = useMemo(() => new Map((data?.cells || []).map(cell => [`${cell.planningGroup}|||${cell.destination}`, cell])), [data?.cells]);
  const selectedOrders = useMemo(() => !data || !selectedCell ? [] : data.orders.filter(order => order.planningGroup === selectedCell.group && order.destination === selectedCell.destination), [data, selectedCell]);
  const groupedSelectedOrders = useMemo(() => {
    const groups = new Map<string, PlanningOrder[]>();
    for (const order of selectedOrders) {
      const key = sectionLabel(order.planningSection || order.planningWindow);
      const list = groups.get(key) || [];
      list.push(order);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [selectedOrders]);
  const quantity = (mode: ViewMode, cell?: PlanningCell) => mode === "planned" ? cell?.planned || 0 : mode === "summary" ? cell?.ordered || 0 : cell?.outstanding || 0;
  const orderQuantity = (mode: ViewMode, order: PlanningOrder) => mode === "planned" ? order.plannedPallets : mode === "summary" ? order.orderedPallets : order.outstandingPallets;
  const sourceLineQuantity = (mode: ViewMode, line: SourceLine) => mode === "planned" ? line.plannedPallets : mode === "summary" ? line.orderedPallets : line.outstandingPallets;

  function orderTones(mode: ViewMode, order: PlanningOrder): PalletTone[] { const lines = order.sourceLines || []; const lineTones = lines.filter(line => sourceLineQuantity(mode, line) > 0).map(line => palletTone(line.palletColourKey, line.loadUnitType, line.palletType)); const useful = lineTones.filter(tone => tone !== "unknown"); return useful.length ? useful : [palletTone(order.palletColourKey, order.loadUnitType, order.palletType)]; }
  function cellTone(mode: ViewMode, cell?: PlanningCell): PalletTone { if (!cell) return "unknown"; const tones = new Set<PalletTone>(); for (const id of cell.orderIds) { const order = orderById.get(id); if (!order || orderQuantity(mode, order) <= 0) continue; orderTones(mode, order).forEach(tone => { if (tone !== "unknown") tones.add(tone); }); } if (tones.size > 1) return "mixed"; return tones.values().next().value || "unknown"; }
  function currentDraft(order: PlanningOrder) { return allocationDrafts[order.id] || { loadId: order.allocations[0]?.loadId || data?.runs[0]?.id || "", pallets: String(order.allocations[0]?.pallets ?? order.outstandingPallets ?? order.orderedPallets) }; }
  function selectRun(order: PlanningOrder, loadId: string) { const existing = order.allocations.find(allocation => allocation.loadId === loadId)?.pallets; setAllocationDrafts(current => ({ ...current, [order.id]: { loadId, pallets: String(existing ?? order.outstandingPallets) } })); }
  async function saveAllocation(order: PlanningOrder) {
    const draftValue = currentDraft(order); if (!draftValue.loadId) { setMessage("Select a run before allocating load units."); return; }
    const pallets = Number(draftValue.pallets); if (!Number.isInteger(pallets) || pallets < 0) { setMessage("Enter a whole load-unit quantity of zero or more."); return; }
    setBusyKey(order.id); setMessage(undefined);
    try {
      const result = await request<{ outstandingPallets: number; overplannedPallets: number; loadReference: string; runCapacityStatus?: string; runUtilisationPercent?: number; trolleyPositionsRemaining?: number }>("/api/v1/planning-control/allocations", await token(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, loadId: draftValue.loadId, date, pallets, note: "Updated from live Pallet Control" }) });
      const capacity = result.runCapacityStatus ? ` · trailer ${result.runCapacityStatus}${result.runUtilisationPercent != null ? ` ${result.runUtilisationPercent.toFixed(1)}%` : ""}` : "";
      setMessage(`${order.reference}: ${pallets} allocated · ${result.outstandingPallets} remaining${result.overplannedPallets > 0 ? ` · ${result.overplannedPallets} over-planned` : ""}${capacity}.`);
      setAllocationDrafts(current => { const next = { ...current }; delete next[order.id]; return next; });
      signalPlanningChange();
      await Promise.allSettled([refreshControl(), refreshRegions()]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The load-unit allocation could not be saved."); }
    finally { setBusyKey(undefined); }
  }

  function matrix(mode: ViewMode, title: string, total: number) {
    const eyebrow = mode === "toPlan" ? "Work remaining" : mode === "planned" ? "Allocated work" : "All ordered work";
    const boardClass = mode === "toPlan" ? "to-plan" : mode === "planned" ? "planned" : "summary";
    return <section className={`panel pallet-control-board ${boardClass}`}><div className="pallet-control-board-title"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><strong>{total}</strong></div><div className="pallet-control-matrix-wrap"><table className="pallet-control-matrix"><thead><tr><th className="pallet-row-label">Region</th>{regionGroups.map(group => <th key={group.region} colSpan={group.destinations.length}>{group.region}</th>)}<th className="pallet-total-col">Total</th></tr><tr><th className="pallet-row-label">Collection</th>{orderedDestinations.map(destination => { const label = destinationLabel(destination); const siteCode = regions.data?.destinationSiteCodes?.[destination]; return <th key={destination} className="pallet-destination-heading" title={label === destination ? destination : `${label} · ${destination}${siteCode ? ` · ${siteCode}` : ""}`}><span>{label}</span></th>; })}<th className="pallet-total-col">Total</th></tr></thead><tbody>
      {data?.planningGroups.map(group => { const cells = orderedDestinations.map(destination => cellMap.get(`${group}|||${destination}`)); const rowTotal = cells.reduce((sum, cell) => sum + quantity(mode, cell), 0); if (rowTotal === 0 && !(mode === "toPlan" && cells.some(cell => (cell?.overplanned || 0) > 0))) return null; return <tr key={group}><td className="pallet-row-label" title={group}><strong>{group}</strong></td>{orderedDestinations.map((destination, index) => { const cell = cells[index]; const amount = quantity(mode, cell); const over = cell?.overplanned || 0; const tone = cellTone(mode, cell); return <td key={destination}>{amount > 0 || (mode === "toPlan" && over > 0) ? <button type="button" className="pallet-cell-button" style={{ background: toneBackground(tone), borderColor: toneBorder(tone) }} onClick={() => setSelectedCell({ group, destination })} title={`${group} → ${destinationLabel(destination)}: ${cell?.ordered || 0} ordered, ${cell?.planned || 0} planned, ${cell?.outstanding || 0} to plan`}><strong>{amount || "—"}</strong>{mode === "toPlan" && over > 0 ? <small>+{over}</small> : null}</button> : null}</td>; })}<td className="pallet-total-col"><strong>{rowTotal}</strong></td></tr>; })}
      <tr className="destination-totals"><td className="pallet-row-label"><strong>Destination total</strong></td>{orderedDestinations.map(destination => { const totalForDestination = data?.planningGroups.reduce((sum, group) => sum + quantity(mode, cellMap.get(`${group}|||${destination}`)), 0) || 0; return <td key={destination}><strong>{totalForDestination || ""}</strong></td>; })}<td className="pallet-total-col"><strong>{total}</strong></td></tr>
    </tbody></table></div></section>;
  }

  return <section className="pallet-control-page"><div className="title-row pallet-control-header"><div><p className="eyebrow">Planner second screen · live quantity control</p><h1>Pallet Control</h1><p className="intro">Collections run down the left and Site Master delivery points run directly above their columns. AM/PM is now shown inside Orders to Plan only.</p></div><div className="title-actions"><label>Planning date <input type="date" value={date} onChange={event => { setDate(event.target.value); setSelectedCell(undefined); }} /></label><button onClick={() => { void refreshControl(); void refreshRegions(); }} disabled={control.loading}>Refresh</button><Link className="button-like primary" to="/">Open planner</Link></div></div>
    <div className="pallet-control-legend"><span><i style={{ background: toneBackground("standard"), borderColor: toneBorder("standard") }} />Standard</span><span><i style={{ background: toneBackground("euro"), borderColor: toneBorder("euro") }} />Euro</span><span><i style={{ background: toneBackground("traycrate"), borderColor: toneBorder("traycrate") }} />Trays / Crates</span><span><i style={{ background: toneBackground("trolley"), borderColor: toneBorder("trolley") }} />Trolleys</span><span><i style={{ background: toneBackground("mixed"), borderColor: toneBorder("mixed") }} />Mixed</span><small>{ukDate(date)} · {data?.summary.orders || 0} orders · {data?.summary.runs || 0} runs{regions.data?.unmatchedDestinations ? ` · ${regions.data.unmatchedDestinations} destination${regions.data.unmatchedDestinations === 1 ? "" : "s"} need Site Master matching` : ""} · instant event updates · 30s reconciliation · updated {fmtTime(data?.generatedAtUtc)}</small></div>
    {message && <p className="notice inline-notice">{message}</p>}{control.error && <p className="notice inline-notice">{control.error}</p>}
    {data && <div className="pallet-control-mini-metrics"><article><span>To plan</span><strong>{data.summary.outstanding}</strong></article><article><span>Planned</span><strong>{data.summary.planned}</strong></article><article className={data.summary.overplanned ? "attention" : ""}><span>Over-planned</span><strong>{data.summary.overplanned}</strong></article><article><span>Late additions</span><strong>{data.summary.lateAdditions}</strong></article></div>}
    {data && data.summary.orders === 0 && <div className="state">No approved load-unit orders are available for {ukDate(date)}.</div>}{data && <div className="pallet-control-stack">{matrix("toPlan", "To Plan", data.summary.outstanding)}{matrix("planned", "Planned", data.summary.planned)}{matrix("summary", "Pallet Summary", data.summary.ordered)}</div>}
    {selectedCell && data && <section className="panel pallet-control-detail"><div className="title-row"><div><p className="eyebrow">Orders to Plan</p><h2>Collect: {selectedCell.group} · Deliver: {destinationLabel(selectedCell.destination)}</h2><p className="hint">AM/PM appears below as an order grouping only. Partial and split allocations remain in To plan until the outstanding balance reaches zero.</p></div><button onClick={() => setSelectedCell(undefined)}>Close</button></div><div className="pallet-control-order-list">{groupedSelectedOrders.map(([section, orders]) => <div key={section} className="pallet-control-order-section"><h3>{section}</h3>{orders.map(order => { const draft = currentDraft(order); return <article key={order.id} className="pallet-control-order"><div><strong>{order.reference}</strong><small>Collect: {order.collection}</small><small>{order.outstandingPallets} {palletLabel(order)} to plan · ordered {order.orderedPallets} · planned {order.plannedPallets}</small><small>Deliver: {destinationLabel(order.destination)}</small><small>{order.customerCode} · {order.temperature || "No temp"}{order.runsOvernight ? " · Overnight" : ""}{order.lateAddition ? " · NEW AFTER PLANNING STARTED" : ""}</small></div><div className="pallet-control-order-quantities"><span><small>Collect</small><strong>{order.collection}</strong></span><span><small>Pallets</small><strong>{order.outstandingPallets}</strong></span><span><small>Deliver</small><strong>{destinationLabel(order.destination)}</strong></span></div><div className="pallet-control-allocation"><select value={draft.loadId} onChange={event => selectRun(order, event.target.value)}><option value="">Select run</option>{data.runs.map(run => <option key={run.id} value={run.id}>{run.reference} · {run.status}{run.capacityType ? ` · ${run.capacityType}` : ""}</option>)}</select><input aria-label="Allocated load units" type="number" min="0" step="1" value={draft.pallets} onChange={event => setAllocationDrafts(current => ({ ...current, [order.id]: { ...draft, pallets: event.target.value } }))} /><button type="button" className="primary" disabled={busyKey === order.id || !draft.loadId} onClick={() => void saveAllocation(order)}>{busyKey === order.id ? "Saving…" : "Save"}</button></div></article>; })}</div>)}</div></section>}
  </section>;
}
