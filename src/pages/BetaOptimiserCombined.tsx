import { useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { formatDateLong, todayIsoDate } from "../lib/dateUtils";
import { parsePlannerPlanFiles } from "../lib/plannerFileImport";
import {
  plannerPayloadToBetaComparison,
  type BetaDayPlan,
  type BetaDayPlanComparison,
  type BetaDayPlanRun,
  type BetaLyonsPlanRoute,
} from "../lib/betaOptimiser";

function qty(value?: number) { return value && value > 0 ? `${value} pallets` : "quantity not stated"; }
function miles(value?: number) { return value == null ? "—" : `${value.toFixed(1)} mi`; }
function pct(value?: number) { return value == null ? "—" : `${value.toFixed(1)}%`; }

type UtilisationView = {
  capacity?: number;
  utilisation?: number;
  family: string;
  status: string;
  note?: string;
};

function isCoreHumanRoute(route: BetaLyonsPlanRoute) { return /^Run\s+\d+/i.test(route.reference); }
function isSouthboundBackhaulRoute(route: BetaLyonsPlanRoute) { return /^[ST]\d/i.test(route.reference); }
function isWave3Route(route: BetaLyonsPlanRoute) { return /^W3\b/i.test(route.reference); }
function isMarketRoute(route: BetaLyonsPlanRoute) { return /^MARKET-/i.test(route.reference); }
function isCoreBetaRun(run: BetaDayPlanRun) { return run.period !== "W3" && run.capacityPallets > 0; }

function utilisationStatus(value?: number) {
  if (value == null) return "Quantity unknown";
  if (value > 100) return "Over capacity";
  if (value >= 95) return "Full / excellent";
  if (value >= 80) return "Good";
  if (value >= 65) return "Could improve";
  return "Under-utilised";
}

function humanUtilisation(route: BetaLyonsPlanRoute): UtilisationView {
  if (!route.plannedPallets || route.plannedPallets <= 0) {
    return { family: "Capacity unknown", status: "Quantity unknown", note: "No numeric pallet quantity was stated." };
  }
  const capacity = route.plannedPallets <= 26 ? 26 : 33;
  const utilisation = Math.round(route.plannedPallets / capacity * 1000) / 10;
  const family = route.plannedPallets <= 26 ? "Standard-capacity basis · 26" : "Euro-capacity basis · 33";
  const note = route.plannedPallets > 33
    ? "Planned total exceeds a 33-Euro-pallet trailer and needs planner review / split evidence."
    : route.plannedPallets > 26
      ? "Workbook does not explicitly confirm pallet family here; Euro capacity is used because the run exceeds 26."
      : "Workbook does not explicitly confirm pallet family here; Standard capacity is used for the visual benchmark.";
  return { capacity, utilisation, family, status: utilisationStatus(utilisation), note };
}

function betaUtilisation(run: BetaDayPlanRun): UtilisationView {
  if (!run.capacityPallets || run.capacityPallets <= 0 || run.plannedPallets <= 0) {
    return { family: run.palletFamily || "Unquantified", status: "Quantity unknown", note: "Excluded from pallet-capacity utilisation." };
  }
  return {
    capacity: run.capacityPallets,
    utilisation: run.utilisationPercent,
    family: `${run.palletFamily} · ${run.capacityPallets}`,
    status: utilisationStatus(run.utilisationPercent),
  };
}

function UtilisationBar({ value }: { value?: number }) {
  if (value == null) return <div style={{ fontSize: 12, opacity: 0.7 }}>No utilisation score</div>;
  const width = Math.min(Math.max(value, 0), 100);
  return <div style={{ marginTop: 7 }}>
    <div style={{ height: 9, borderRadius: 999, background: "#e6ece9", overflow: "hidden" }}>
      <div style={{ width: `${width}%`, height: "100%", background: value > 100 ? "#b42318" : value >= 80 ? "#2f6f44" : "#d69e2e" }} />
    </div>
    {value > 100 && <small style={{ color: "#b42318" }}>+{(value - 100).toFixed(1)}% above capacity</small>}
  </div>;
}

function HumanRunCard({ route }: { route: BetaLyonsPlanRoute }) {
  const util = humanUtilisation(route);
  return <article className="panel" style={{ padding: 12, display: "grid", gap: 5 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start", flexWrap: "wrap" }}>
      <div><strong>{route.reference}</strong><div><small>{route.orderLineCount} movement line{route.orderLineCount === 1 ? "" : "s"} · {qty(route.plannedPallets)}</small></div></div>
      <div style={{ textAlign: "right" }}><strong>{pct(util.utilisation)}</strong><div><small>{util.status}</small></div></div>
    </div>
    <UtilisationBar value={util.utilisation}/>
    <div><small><strong>Capacity basis:</strong> {util.family}</small></div>
    {util.note && <div><small>{util.note}</small></div>}
    <div><small>{route.routingAvailable ? miles(route.miles) : "HGV routing unavailable"} · {route.stops.join(" → ")}</small></div>
  </article>;
}

function BackhaulCard({ route }: { route: BetaLyonsPlanRoute }) {
  return <article className="panel" style={{ padding: 12, display: "grid", gap: 5, borderLeft: "5px solid #2f6f44" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <div><strong>{route.reference}</strong><div><small>{route.orderLineCount} return movement line{route.orderLineCount === 1 ? "" : "s"} · {qty(route.plannedPallets)}</small></div></div>
      <strong style={{ color: "#2f6f44" }}>BACKHAUL POOL</strong>
    </div>
    <div><small><strong>Planning rule:</strong> this is not scored as a separate under-utilised truck. It should be offered to a compatible driver/vehicle already returning south.</small></div>
    <div><small>{route.stops.join(" → ")}</small></div>
  </article>;
}

function BetaRunCard({ run }: { run: BetaDayPlanRun }) {
  const util = betaUtilisation(run);
  const orderPreview = run.orders.slice(0, 5).map(order => `${order.reference}: ${order.collectionName} → ${order.deliveryName}`).join(" · ");
  return <article className="panel" style={{ padding: 12, display: "grid", gap: 5 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start", flexWrap: "wrap" }}>
      <div><strong>{run.reference}</strong> <small>· {run.period}</small><div><small>{run.orders.length} order line{run.orders.length === 1 ? "" : "s"} · {run.plannedPallets > 0 ? `${run.plannedPallets} pallets` : "quantity not stated"}</small></div></div>
      <div style={{ textAlign: "right" }}><strong>{pct(util.utilisation)}</strong><div><small>{util.status}</small></div></div>
    </div>
    <UtilisationBar value={util.utilisation}/>
    <div><small><strong>Capacity:</strong> {util.family}</small></div>
    <div><small><strong>Route:</strong> {run.stops.map(stop => stop.name).join(" → ") || "No mapped route"}</small></div>
    {orderPreview && <div><small><strong>Contains:</strong> {orderPreview}{run.orders.length > 5 ? ` · +${run.orders.length - 5} more` : ""}</small></div>}
    <div><small>{run.routingAvailable ? miles(run.miles) : "HGV routing unavailable"}</small></div>
  </article>;
}

function weightedHumanUtilisation(routes: BetaLyonsPlanRoute[]) {
  let pallets = 0;
  let capacity = 0;
  for (const route of routes) {
    const util = humanUtilisation(route);
    if (!util.capacity || route.plannedPallets <= 0) continue;
    pallets += route.plannedPallets;
    capacity += util.capacity;
  }
  return capacity > 0 ? Math.round(pallets / capacity * 1000) / 10 : undefined;
}

function weightedBetaUtilisation(runs: BetaDayPlanRun[]) {
  const quantified = runs.filter(run => run.capacityPallets > 0 && run.plannedPallets > 0);
  const pallets = quantified.reduce((sum, run) => sum + run.plannedPallets, 0);
  const capacity = quantified.reduce((sum, run) => sum + run.capacityPallets, 0);
  return capacity > 0 ? Math.round(pallets / capacity * 1000) / 10 : undefined;
}

export function BetaOptimiserCombined() {
  const token = useAccessToken();
  const [planningDate, setPlanningDate] = useState(todayIsoDate());
  const [dayPlan, setDayPlan] = useState<BetaDayPlan>();
  const [comparison, setComparison] = useState<BetaDayPlanComparison>();
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [warnings, setWarnings] = useState<string[]>([]);

  async function buildDay() {
    setBusy(true); setMessage(undefined); setWarnings([]); setComparison(undefined);
    try {
      const result = await request<BetaDayPlan>(`/api/v1/beta-optimiser/day-plan?planningDate=${encodeURIComponent(planningDate)}`, await token(), undefined, 90000);
      setDayPlan(result);
      setMessage(`Beta independently built ${result.runCount} runs from ${result.eligibleOrderLines} order lines for ${formatDateLong(planningDate)}. Planner and Dispatch were not changed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Beta could not build the day.");
    } finally { setBusy(false); }
  }

  async function compareFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true); setMessage(undefined); setWarnings([]);
    try {
      const payload = await parsePlannerPlanFiles(files);
      const comparisonRequest = plannerPayloadToBetaComparison(payload);
      if (!comparisonRequest.routes.length) throw new Error("The selected planning workbooks contain no included movements.");
      setPlanningDate(payload.planningDate);
      setFileNames(files.map(file => file.name));
      setWarnings(payload.exceptions.map(item => [item.code, item.detail].filter(Boolean).join(": ")).filter(Boolean));
      const result = await request<BetaDayPlanComparison>("/api/v1/beta-optimiser/day-plan/compare", await token(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comparisonRequest),
      }, 90000);
      setDayPlan(result.beta);
      setComparison(result);
      setMessage(`${files.length} workbook${files.length === 1 ? "" : "s"} read successfully. ${result.reconciliation.matchedOrderLines}/${result.reconciliation.betaOrderLines} Beta order lines matched. Nothing was imported into Planner or Dispatch.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The planning workbooks could not be compared.");
    } finally { setBusy(false); }
  }

  const reconciliation = comparison?.reconciliation;
  const planView = useMemo(() => {
    if (!comparison) return undefined;
    const humanCore = comparison.lyons.routes.filter(isCoreHumanRoute);
    const humanBackhauls = comparison.lyons.routes.filter(isSouthboundBackhaulRoute);
    const humanWave3 = comparison.lyons.routes.filter(isWave3Route);
    const humanMarkets = comparison.lyons.routes.filter(isMarketRoute);
    const betaCore = comparison.beta.runs.filter(isCoreBetaRun);
    const betaOther = comparison.beta.runs.filter(run => !isCoreBetaRun(run));
    const humanUtil = weightedHumanUtilisation(humanCore);
    const betaUtil = weightedBetaUtilisation(betaCore);
    return {
      humanCore, humanBackhauls, humanWave3, humanMarkets, betaCore, betaOther,
      humanUtil, betaUtil,
      humanOver: humanCore.filter(route => (humanUtilisation(route).utilisation ?? 0) > 100).length,
      humanUnder: humanCore.filter(route => {
        const value = humanUtilisation(route).utilisation;
        return value != null && value < 65;
      }).length,
      betaOver: betaCore.filter(run => run.utilisationPercent > 100).length,
      betaUnder: betaCore.filter(run => run.utilisationPercent < 65).length,
    };
  }, [comparison]);

  const utilisationDelta = planView?.humanUtil != null && planView.betaUtil != null ? planView.betaUtil - planView.humanUtil : undefined;
  const coreRunDelta = planView ? planView.betaCore.length - planView.humanCore.length : undefined;
  const canClaimImprovement = Boolean(
    comparison && reconciliation?.orderCoverageComplete && reconciliation.comparableRouting &&
    (planView?.humanBackhauls.length ?? 0) === 0
  );

  return <section style={{ display: "grid", gap: 14 }}>
    <div className="panel" style={{ padding: 16, borderTop: "5px solid #2f6f44" }}>
      <p className="eyebrow" style={{ marginBottom: 3 }}>Planning lab · read-only</p>
      <h1 style={{ margin: 0 }}>Beta Optimiser</h1>
      <p>Compare the human outbound plan with BETA while treating Southbound work as return/backhaul work, not as extra outbound trucks. PM / O/N, markets, trays, crates, trollies and transfers remain visible even where no pallet count is stated.</p>

      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <label><small>Planning date</small><br/><input type="date" value={planningDate} onChange={event => setPlanningDate(event.target.value)} disabled={busy}/></label>
        <button className="primary" type="button" onClick={() => void buildDay()} disabled={busy}>{busy ? "Working…" : "Build day from orders"}</button>
        <label><small>Upload planning files</small><br/><input type="file" multiple accept=".csv,.xlsx,.xls,.xlsm" disabled={busy} onChange={event => { const files = Array.from(event.target.files ?? []); void compareFiles(files); event.target.value = ""; }}/></label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 10, marginTop: 12 }}>
        <p className="notice inline-notice"><strong>Backhaul rule:</strong> Southbound S/T work is a pool to attach to drivers returning south. It is not scored as a separate low-utilisation truck.</p>
        <p className="notice inline-notice"><strong>Capacity:</strong> BETA uses 26 Standard / 33 Euro pallets from the optimiser. Core human runs use the same clearly labelled capacity benchmark.</p>
        <p className="notice inline-notice"><strong>No false win:</strong> BETA only gets an “improved” verdict when coverage, routing and backhaul allocation evidence support it.</p>
        <p className="notice inline-notice"><strong>Workbook rules:</strong> Lyons Collections reads `Collection Plan`; Southbound is treated as return-work evidence plus PM / O/N and market work.</p>
      </div>

      {fileNames.length > 0 && <p><small><strong>Selected:</strong> {fileNames.join(" + ")}</small></p>}
      {message && <p className="notice inline-notice">{message}</p>}
      {warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}
    </div>

    {comparison && planView && <div className="panel" style={{ padding: 16, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
        <div><h2 style={{ margin: 0 }}>Human vs BETA · operational comparison</h2><small>Outbound trucks are compared with outbound trucks. Southbound work is assessed as backhaul opportunity.</small></div>
        <strong style={{ padding: "7px 10px", borderRadius: 999, background: canClaimImprovement ? "#dff3df" : "#fff4d6", color: canClaimImprovement ? "#245c35" : "#725500" }}>
          {canClaimImprovement ? "IMPROVEMENT PROVEN" : "IMPROVEMENT NOT YET PROVEN"}
        </strong>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>
        <div className="panel" style={{ padding: 10 }}><small>Movement match</small><div><strong>{reconciliation?.matchedOrderLines}/{reconciliation?.betaOrderLines}</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Core outbound runs</small><div><strong>{planView.humanCore.length} human → {planView.betaCore.length} BETA</strong></div><small>{coreRunDelta === 0 ? "No truck-count reduction" : coreRunDelta != null && coreRunDelta < 0 ? `${Math.abs(coreRunDelta)} fewer core runs` : `${coreRunDelta ?? 0} more core runs`}</small></div>
        <div className="panel" style={{ padding: 10 }}><small>Southbound return work</small><div><strong>{planView.humanBackhauls.length} backhaul route{planView.humanBackhauls.length === 1 ? "" : "s"}</strong></div><small>Must be paired to returning runs</small></div>
        <div className="panel" style={{ padding: 10 }}><small>PM / O/N and markets</small><div><strong>{planView.humanWave3.length + planView.humanMarkets.length} route{planView.humanWave3.length + planView.humanMarkets.length === 1 ? "" : "s"}</strong></div></div>
        <div className="panel" style={{ padding: 10 }}><small>Core utilisation</small><div><strong>{pct(planView.humanUtil)} human → {pct(planView.betaUtil)} BETA</strong></div><small>{utilisationDelta == null ? "Not comparable" : `${utilisationDelta >= 0 ? "+" : ""}${utilisationDelta.toFixed(1)} percentage points`}</small></div>
        <div className="panel" style={{ padding: 10 }}><small>Core attention</small><div><strong>{planView.humanUnder} under-used · {planView.humanOver} over-capacity</strong></div><small>BETA: {planView.betaUnder} under-used · {planView.betaOver} over-capacity</small></div>
        <div className="panel" style={{ padding: 10 }}><small>HGV mileage</small><div><strong>{miles(comparison.lyons.totalMiles)} human / {miles(comparison.beta.totalMiles)} BETA</strong></div></div>
      </div>

      <div className="panel" style={{ padding: 14, borderLeft: `5px solid ${canClaimImprovement ? "#2f6f44" : "#d69e2e"}`, display: "grid", gap: 7 }}>
        <strong>Why is BETA better — or not?</strong>
        <div><small><strong>Capacity:</strong> {utilisationDelta == null ? "not comparable." : utilisationDelta > 0 ? `BETA improves core trailer utilisation by ${utilisationDelta.toFixed(1)} percentage points.` : utilisationDelta === 0 ? "BETA has not improved core trailer utilisation." : `BETA is ${Math.abs(utilisationDelta).toFixed(1)} points worse on core trailer utilisation.`}</small></div>
        <div><small><strong>Core trucks:</strong> {coreRunDelta === 0 ? "BETA uses the same number of core outbound runs as the human plan." : coreRunDelta != null && coreRunDelta < 0 ? `BETA uses ${Math.abs(coreRunDelta)} fewer core outbound runs.` : `BETA currently uses ${coreRunDelta ?? 0} more core outbound runs.`}</small></div>
        <div><small><strong>Backhauls:</strong> {planView.humanBackhauls.length > 0 ? `${planView.humanBackhauls.length} Southbound return routes exist. Until BETA shows which parent outbound run/driver each one is attached to, a whole-day improvement claim is not valid.` : "No separate Southbound return routes were found."}</small></div>
        <div><small><strong>Mileage:</strong> {reconciliation?.comparableRouting ? "Complete live HGV routing is available for comparison." : "Mileage remains unproven because complete live HGV routing and exact work coverage are not yet available."}</small></div>
      </div>

      {reconciliation?.warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(430px,1fr))", gap: 14, alignItems: "start" }}>
        <section style={{ display: "grid", gap: 8 }}>
          <div><h3 style={{ marginBottom: 2 }}>Human core outbound plan</h3><small>Only the actual Collection Plan runs are scored for outbound trailer utilisation.</small></div>
          {planView.humanCore.map(route => <HumanRunCard key={route.reference} route={route}/>)}
        </section>
        <section style={{ display: "grid", gap: 8 }}>
          <div><h3 style={{ marginBottom: 2 }}>BETA core outbound plan</h3><small>Each card shows what BETA combined, its route, Standard/Euro capacity and utilisation.</small></div>
          {planView.betaCore.map(run => <BetaRunCard key={run.reference} run={run}/>)}
        </section>
      </div>

      {planView.humanBackhauls.length > 0 && <section style={{ display: "grid", gap: 8 }}>
        <div><h3 style={{ marginBottom: 2 }}>Southbound backhaul pool</h3><small>These are return jobs to be matched to a driver/vehicle already heading south after its northern deliveries — not extra standalone outbound runs.</small></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 8 }}>
          {planView.humanBackhauls.map(route => <BackhaulCard key={route.reference} route={route}/>)}
        </div>
      </section>}

      {(planView.humanWave3.length > 0 || planView.humanMarkets.length > 0) && <section style={{ display: "grid", gap: 8 }}>
        <div><h3 style={{ marginBottom: 2 }}>PM / O/N and market work</h3><small>Kept separate from the core outbound utilisation score because this work follows different operating rules.</small></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 8 }}>
          {[...planView.humanWave3, ...planView.humanMarkets].map(route => <BackhaulCard key={route.reference} route={route}/>)}
        </div>
      </section>}

      {planView.betaOther.length > 0 && <section style={{ display: "grid", gap: 8 }}>
        <div><h3 style={{ marginBottom: 2 }}>Other BETA work</h3><small>Unquantified and PM / O/N movements are retained but are not allowed to inflate the core outbound utilisation score.</small></div>
        {planView.betaOther.map(run => <BetaRunCard key={run.reference} run={run}/>)}
      </section>}
    </div>}

    {dayPlan && !comparison && <div className="panel" style={{ padding: 16, display: "grid", gap: 8 }}>
      <h2 style={{ margin: 0 }}>Beta-built day · {formatDateLong(dayPlan.planningDate)}</h2>
      <p><small>{dayPlan.plannedOrderLines} planned order lines · {dayPlan.runCount} runs · {dayPlan.routingComplete ? "complete HGV routing" : "partial HGV routing"}</small></p>
      {dayPlan.warnings.map((warning, index) => <p className="notice inline-notice" key={`${warning}-${index}`}>{warning}</p>)}
      {dayPlan.runs.map(run => <BetaRunCard key={run.reference} run={run}/>)}
    </div>}
  </section>;
}
