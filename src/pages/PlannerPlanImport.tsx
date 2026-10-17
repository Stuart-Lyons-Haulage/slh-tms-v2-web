import { useMemo, useState, type ChangeEvent } from "react";
import { useAccessToken } from "../lib/auth";
import { formatDate, todayIsoDate } from "../lib/dateUtils";
import { parsePlannerCsv } from "../lib/plannerCsvImport";
import { parsePlannerPlanFile } from "../lib/plannerFileImport";
import { displayPlannerRunChoice } from "../lib/runDisplay";
import { importPlannerPlanInChunks, type PlannerImportSummary as ImportSummary } from "../lib/plannerImportChunking";

type ImportStop = {
  sequence?: number;
  collectionSite?: string;
  deliverySite?: string;
  pallets?: number;
  palletType?: string;
  collectFrom?: string;
  collectTo?: string;
  deadline?: string;
  collectionDate?: string;
  deliveryDate?: string;
  collectionSiteArrDate?: string;
  collectionSiteArrTime?: string;
  despatchedDate?: string;
  despatchedTime?: string;
  deliveredDate?: string;
  deliveryArrivalTime?: string;
  deliveryDepartTime?: string;
  reasonForLate?: string;
};
type ImportRun = { runRef?: string; plannerRun?: string; runType?: string; overnight?: boolean; planningDate?: string; driver?: string; vehicle?: string; trailer?: string; includeInImport?: boolean; reconciliationStatus?: string; capacityStatus?: string; mixedUtilisationPercent?: number; stops?: ImportStop[] };
type PlannerPlanPayload = { schema?: string; planningDate?: string; runs?: ImportRun[]; exceptions?: Array<{ severity?: string; runRef?: string; code?: string; detail?: string }> };
type ResourceReconciliation = { changed?: number; unresolvedDrivers?: string[]; unresolvedVehicles?: string[]; unresolvedTrailers?: string[] };
type SiteReconciliation = { changedStops?: number; unresolved?: string[]; ambiguous?: string[] };
type PeriodFilter = "ALL" | "AM" | "PM";

function safeRuns(payload?: PlannerPlanPayload) { return Array.isArray(payload?.runs) ? payload!.runs! : []; }
function clean(value?: string) { return String(value || "").trim(); }
function sortedTimes(values: Array<string | undefined>) { return values.map(clean).filter(Boolean).sort((a, b) => a.localeCompare(b)); }
function collectEntries(run: ImportRun) {
  return (run.stops || []).map((stop) => ({
    date: clean(stop.collectionDate) || clean(run.planningDate),
    from: clean(stop.collectFrom),
    to: clean(stop.collectTo),
  })).filter((entry) => entry.from).sort((a, b) => `${a.date}T${a.from}`.localeCompare(`${b.date}T${b.from}`));
}
function firstCollect(run: ImportRun) {
  const first = collectEntries(run)[0];
  if (!first) return "—";
  const window = `${first.from}${first.to ? `-${first.to}` : ""}`;
  return first.date && first.date !== clean(run.planningDate) ? `${first.date} ${window}` : window;
}
function firstCollectTime(run: ImportRun) {
  const planningDate = clean(run.planningDate);
  const onPlanningDay = collectEntries(run).filter((entry) => !entry.date || entry.date === planningDate);
  return (onPlanningDay[0] || collectEntries(run)[0])?.from;
}
function finalDeadline(run: ImportRun) { return sortedTimes((run.stops || []).map((stop) => stop.deadline)).at(-1) || "—"; }
function manualActualCount(run: ImportRun) {
  return (run.stops || []).filter((stop) => clean(stop.collectionSiteArrTime) || clean(stop.despatchedTime) || clean(stop.deliveryArrivalTime) || clean(stop.deliveryDepartTime) || clean(stop.reasonForLate)).length;
}

async function readError(response: Response) {
  const raw = await response.text();
  if (!raw) return `Request failed (${response.status}).`;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const errors = parsed.errors && typeof parsed.errors === "object"
      ? Object.entries(parsed.errors as Record<string, unknown>).flatMap(([field, value]) => Array.isArray(value) ? value.map((item) => `${field}: ${String(item)}`) : [`${field}: ${String(value)}`])
      : [];
    return [parsed.detail, parsed.message, parsed.error, ...errors].filter(Boolean).map(String).join(" | ") || raw;
  } catch { return raw; }
}

export function PlannerPlanImport() {
  const token = useAccessToken();
  const [fileName, setFileName] = useState("");
  const [payload, setPayload] = useState<PlannerPlanPayload>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetDate, setResetDate] = useState(todayIsoDate());
  const [resetMessage, setResetMessage] = useState<string>();
  const [summary, setSummary] = useState<ImportSummary>();
  const [reconcileMessage, setReconcileMessage] = useState<string>();
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("ALL");

  const preview = useMemo(() => {
    const runs = safeRuns(payload);
    const included = runs.filter((run) => run.includeInImport !== false);
    const held = runs.filter((run) => run.includeInImport === false);
    const red = included.filter((run) => String(run.capacityStatus || "").toLowerCase() === "red");
    const amber = included.filter((run) => String(run.capacityStatus || "").toLowerCase() === "amber");
    const stops = included.reduce((total, run) => total + (Array.isArray(run.stops) ? run.stops.length : 0), 0);
    const actuals = included.reduce((total, run) => total + manualActualCount(run), 0);
    return { total: runs.length, included: included.length, held: held.length, red: red.length, amber: amber.length, stops, actuals };
  }, [payload]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError(undefined); setSummary(undefined); setReconcileMessage(undefined); setPayload(undefined);
    const file = event.target.files?.[0]; if (!file) return; setFileName(file.name);
    try {
      const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type.toLowerCase().includes("csv");
      const parsed = (isCsv
        ? parsePlannerCsv(await file.text(), file.name)
        : await parsePlannerPlanFile(file)) as PlannerPlanPayload;
      if (!parsed?.planningDate || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.planningDate)) throw new Error("The planner file needs a valid planningDate (YYYY-MM-DD). It will display as DD/MM/YYYY after upload.");
      if (!Array.isArray(parsed.runs) || parsed.runs.length === 0) throw new Error("The planner file contains no runs.");
      const refs = parsed.runs.map((run) => String(run.runRef || "").trim().toUpperCase());
      if (refs.some((ref) => !ref)) throw new Error("Every planner run must have a runRef.");
      const duplicate = refs.find((ref, index) => refs.indexOf(ref) !== index); if (duplicate) throw new Error(`Duplicate run reference in file: ${duplicate}.`);
      if (parsed.runs.some((run) => run.planningDate && run.planningDate !== parsed.planningDate)) throw new Error("One or more runs use a different planning date from the file header.");
      setPayload(parsed);
      setPeriodFilter("ALL");
      setResetDate(parsed.planningDate);
    } catch (exception) { setError(exception instanceof Error ? exception.message : "The planner file could not be read."); }
  }

  async function resetPlanningDay() {
    if (resetBusy || busy) return;
    const date = resetDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setResetMessage("Enter a reset date in YYYY-MM-DD format."); return; }
    if (!window.confirm(`Reset planning day ${formatDate(date)}?\n\nThis clears imported runs/orders/staged planning rows for that date only. Master data, drivers, vehicles, trailers, Sage, DOT, Tachomaster and Fleetio are not cleared.`)) return;
    setResetBusy(true); setResetMessage(undefined); setError(undefined); setSummary(undefined); setReconcileMessage(undefined);
    try {
      const accessToken = await token();
      const response = await fetch(`/tms-api/api/v1/planning-day/${date}?confirm=RESET-${date}`, {
        method: "DELETE",
        headers: { Accept: "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      });
      if (!response.ok) throw new Error(await readError(response));
      const text = await response.text();
      setResetMessage(text ? `Planning day ${formatDate(date)} reset complete. ${text}` : `Planning day ${formatDate(date)} reset complete. You can now import the corrected plan.`);
    } catch (exception) { setResetMessage(exception instanceof Error ? exception.message : "The planning day could not be reset."); }
    finally { setResetBusy(false); }
  }

  async function importPlan() {
    if (!payload || busy) return;
    if (!window.confirm(`Import planner plan for ${formatDate(payload.planningDate)}?\n\n${preview.included} runs will be submitted. ${preview.held} held/excluded runs will remain excluded.`)) return;
    setBusy(true); setError(undefined); setSummary(undefined); setReconcileMessage(undefined);
    try {
      const accessToken = await token();
      const authHeaders = { Accept: "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
      const importPayload = { ...payload, runs: safeRuns(payload) };
      const importSummary = await importPlannerPlanInChunks(
        importPayload,
        async (batch) => {
          const response = await fetch("/tms-api/api/v1/planning/import-plan", {
            method: "POST",
            headers: { ...authHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(batch),
          });
          if (!response.ok) throw new Error(await readError(response));
          return await response.json() as ImportSummary;
        },
        10,
      );
      setSummary(importSummary);

      try {
        const [resourcesResponse, sitesResponse] = await Promise.all([
          fetch(`/tms-api/api/v1/planning/reconcile-resources/${payload.planningDate}`, { method: "POST", headers: authHeaders }),
          fetch(`/tms-api/api/v1/planning/reconcile-sites/${payload.planningDate}`, { method: "POST", headers: authHeaders }),
        ]);
        if (!resourcesResponse.ok) throw new Error(`Resource reconciliation: ${await readError(resourcesResponse)}`);
        if (!sitesResponse.ok) throw new Error(`Site reconciliation: ${await readError(sitesResponse)}`);
        const resources = await resourcesResponse.json() as ResourceReconciliation;
        const sites = await sitesResponse.json() as SiteReconciliation;
        const unresolvedResources = [
          ...(resources.unresolvedDrivers || []).map((value) => `driver ${value}`),
          ...(resources.unresolvedVehicles || []).map((value) => `vehicle ${value}`),
          ...(resources.unresolvedTrailers || []).map((value) => `trailer ${value}`),
        ];
        const unresolvedSites = [...(sites.unresolved || []), ...(sites.ambiguous || []).map((value) => `${value} (ambiguous)` )];
        const details = [
          `${resources.changed || 0} run resource assignment(s) backfilled from Master Data`,
          `${sites.changedStops || 0} stop address/postcode/location record(s) enriched from Site Master`,
          unresolvedResources.length ? `unresolved resources: ${unresolvedResources.join(", ")}` : "",
          unresolvedSites.length ? `unresolved sites: ${unresolvedSites.join(", ")}` : "",
        ].filter(Boolean);
        setReconcileMessage(`Master Data reconciliation complete. ${details.join(" · ")}.`);
      } catch (reconcileError) {
        setReconcileMessage(`Import succeeded, but automatic Master Data reconciliation needs attention: ${reconcileError instanceof Error ? reconcileError.message : String(reconcileError)}`);
      }
    } catch (exception) { setError(exception instanceof Error ? exception.message : "The planner plan could not be imported."); }
    finally { setBusy(false); }
  }

  const visibleRuns = safeRuns(payload).filter((run) => periodFilter === "ALL" || String(run.runType || "").toUpperCase() === periodFilter);
  const amRuns = safeRuns(payload).filter((run) => String(run.runType || "").toUpperCase() === "AM").length;
  const pmRuns = safeRuns(payload).filter((run) => String(run.runType || "").toUpperCase() === "PM").length;

  return <section><div className="page-heading"><div><p className="eyebrow">Planner control</p><h1>Import planner plan</h1><p>Load a planner JSON or collection-plan CSV, review the control totals, then confirm the authenticated import into the TMS.</p></div></div>
    <div className="card" style={{ maxWidth: 1100, display: "grid", gap: 18 }}>
      <div className="notice inline-notice" style={{ display: "grid", gap: 10 }}>
        <strong>Reset before re-import</strong>
        <span>Use this before importing a corrected plan. It clears only the selected planning day, not master data or integrations.</span>
        <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Planning date <input type="date" value={resetDate} onChange={(event) => setResetDate(event.target.value)} disabled={busy || resetBusy} /></label>
        <button type="button" className="danger" onClick={() => void resetPlanningDay()} disabled={busy || resetBusy}>{resetBusy ? "Resetting…" : `Reset ${formatDate(resetDate)} planning day`}</button>
        {resetMessage && <span style={{ whiteSpace: "pre-wrap" }}>{resetMessage}</span>}
      </div>
      <label style={{ display: "grid", gap: 8, maxWidth: 560 }}><strong>Planner workbook, JSON or collection-plan CSV</strong><input type="file" accept="application/json,.json,text/csv,.csv,.xlsx,.xls,.xlsm" onChange={(event) => void chooseFile(event)} disabled={busy || resetBusy} /></label>
      <p className="hint">Upload the familiar Lyons Collections or Southbound workbook directly. Collection Plan rows are grouped by <strong>Load number</strong>; AM and PM are retained, with cross-date PM movements shown as O/N. Driver, vehicle and trailer are retained for review rather than guessed.</p>
      {fileName && <p><strong>Selected:</strong> {fileName}</p>}
      {payload && <><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><span className="badge"><strong>{formatDate(payload.planningDate)}</strong> planning date</span><span className="badge"><strong>{preview.total}</strong> source runs</span><span className="badge"><strong>{preview.included}</strong> to import</span><span className="badge"><strong>{preview.held}</strong> held / excluded</span><span className="badge"><strong>{preview.stops}</strong> source lines</span><span className="badge"><strong>{preview.actuals}</strong> manual actual/ETA lines</span><span className="badge"><strong>{preview.red}</strong> red</span><span className="badge"><strong>{preview.amber}</strong> amber</span></div>
      <p className="hint">Run names below are the operational names that will be shown on Runs and TV views. The dated TMS reference remains internal only.</p>
      <div className="actions" role="tablist" aria-label="Planner period filter" style={{ marginBottom: 10 }}><button type="button" className={periodFilter === "ALL" ? "primary" : ""} onClick={() => setPeriodFilter("ALL")}>All ({safeRuns(payload).length})</button><button type="button" className={periodFilter === "AM" ? "primary" : ""} onClick={() => setPeriodFilter("AM")}>AM ({amRuns})</button><button type="button" className={periodFilter === "PM" ? "primary" : ""} onClick={() => setPeriodFilter("PM")}>PM / O/N ({pmRuns})</button></div>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Run</th><th>Type</th><th>Driver</th><th>Vehicle</th><th>Trailer</th><th>Source lines</th><th>First collect window</th><th>Deliver by</th><th>Manual actuals/ETAs</th><th>Capacity</th><th>Import</th><th>Reconciliation</th></tr></thead><tbody>{visibleRuns.map((run, index) => <tr key={`${run.runRef}-${index}`}><td><strong>{displayPlannerRunChoice(run.plannerRun, run.runType, run.runRef, firstCollectTime(run), run.overnight)}</strong></td><td>{run.runType || "—"}</td><td>{run.driver || "Unallocated"}</td><td>{run.vehicle || "—"}</td><td>{run.trailer || "—"}</td><td>{run.stops?.length || 0}</td><td>{firstCollect(run)}</td><td>{finalDeadline(run)}</td><td>{manualActualCount(run)}</td><td>{run.capacityStatus || "—"}{typeof run.mixedUtilisationPercent === "number" ? ` · ${run.mixedUtilisationPercent.toFixed(1)}%` : ""}</td><td>{run.includeInImport === false ? "Held" : "Yes"}</td><td>{run.reconciliationStatus || "—"}</td></tr>)}</tbody></table></div>
      <button className="primary" disabled={busy || resetBusy || preview.included === 0} onClick={() => void importPlan()}>{busy ? "Importing…" : `Confirm import of ${preview.included} runs`}</button></>}
      {error && <div className="notice inline-notice"><strong>Import failed</strong><div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{error}</div></div>}
      {summary && <div style={{ display: "grid", gap: 12 }}><h2>Import complete · {formatDate(summary.planningDate)}</h2><div>{summary.created} created · {summary.updated} updated · {summary.unchanged} unchanged · {summary.held} held</div>{summary.unresolvedDrivers.length > 0 && <div>Drivers: {summary.unresolvedDrivers.join(", ")}</div>}{summary.unresolvedVehicles.length > 0 && <div>Vehicles: {summary.unresolvedVehicles.join(", ")}</div>}{summary.unresolvedTrailers.length > 0 && <div>Trailers: {summary.unresolvedTrailers.join(", ")}</div>}{summary.warnings.length > 0 && <ul>{summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}{reconcileMessage && <div className="notice inline-notice" style={{ whiteSpace: "pre-wrap" }}><strong>Master Data reconciliation</strong><div style={{ marginTop: 6 }}>{reconcileMessage}</div></div>}</div>}
    </div></section>;
}
