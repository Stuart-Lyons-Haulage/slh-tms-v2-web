import { useCallback, useMemo, useState } from "react";
import { useWorkingDate } from "../lib/workingDate";
import { useSearchParams } from "react-router-dom";
import { api, request, type Driver } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useTmsQuery } from "../lib/useTmsQuery";
import { useDrivers } from "../lib/lookupQueries";

type ComplianceRow = {
  assetType: "Vehicle" | "Trailer";
  assetId: string;
  assetName: string;
  runReference: string;
  driverId: string;
  driverName: string;
  employmentType: string;
  tachoDutyStartUtc?: string;
  tachoPreUseOtherWorkMinutes?: number;
  firstMovementUtc?: string;
  fleetioInspectionId?: string;
  fleetioForm?: string;
  fleetioSubmittedAtUtc?: string;
  fleetioUser?: string;
  fleetioDriverMatched?: boolean;
  fleetioFailedItems?: number;
  status: "Compliant" | "Paper evidence required" | "Review" | "Non-compliant";
  reason: string;
  officeAction?: string;
};

type ComplianceReport = {
  date: string;
  generatedAtUtc: string;
  policy: {
    minimumPreUseOtherWorkMinutes: number | null;
    employedFleetioMandatory: boolean;
    agencyPaperException: boolean;
    driverChangeRequiresNewCheck: boolean;
    note: string;
  };
  sourceStatus: { tachoMaster: string; fleetio: string; dotFalcon: string; tms: string };
  summary: {
    assetsOperated: number;
    green: number;
    amber: number;
    red: number;
    vehicles: number;
    trailers: number;
    fleetioChecks: number;
    tachoPreUseConfirmed: number;
  };
  rows: ComplianceRow[];
};

const fmtTime = (value?: string) => value
  ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value))
  : "—";
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function canonicalEmploymentType(driver?: Driver, fallback = "Employed") {
  if (!driver) return fallback;
  const type = (driver.driverType || "").trim();
  const group = (driver.driverGroup || "").trim();
  const agency = (driver.agencyName || "").trim();
  const text = `${type} ${group} ${agency}`;
  if (/agency/i.test(text)) return "Agency";
  if (/casual|zero[- ]?hour/i.test(text)) return "Casual";
  if (/subcontract/i.test(text)) return "Subcontractor";
  return "Employed";
}

function tone(status: ComplianceRow["status"]) {
  if (status === "Compliant") return "green";
  if (status === "Non-compliant") return "red";
  return "amber";
}

const statusText: Record<ComplianceRow["status"], string> = {
  "Compliant": "Checked",
  "Non-compliant": "Not checked",
  "Review": "Check evidence",
  "Paper evidence required": "Paper check needed",
};

type View = "attention" | "red" | "all";

export function DailyCompliance() {
  const token = useAccessToken();
  const [date] = useWorkingDate();
  const [params] = useSearchParams();
  const [view, setView] = useState<View>(() => params.get("status") === "red" ? "red" : params.get("status") === "all" ? "all" : "attention");
  const [assetType, setAssetType] = useState("all");
  const [employment, setEmployment] = useState("all");
  const [search, setSearch] = useState("");
  const [busyKey, setBusyKey] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const report = useTmsQuery<ComplianceReport>(
    ['dailyCompliance', 'report', date] as const,
    useCallback((t: string) => request<ComplianceReport>(`/api/v1/daily-compliance/report?date=${date}`, t, undefined, 90000), [date]),
  );
  const drivers = useDrivers();

  const canonicalRows = useMemo(() => {
    const byId = new Map((drivers.data || []).map(driver => [driver.id, driver]));
    return (report.data?.rows || []).map(row => ({
      ...row,
      employmentType: canonicalEmploymentType(byId.get(row.driverId), row.employmentType),
    }));
  }, [drivers.data, report.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return canonicalRows.filter(row => {
      if (view === "attention" && row.status === "Compliant") return false;
      if (view === "red" && row.status !== "Non-compliant") return false;
      if (assetType !== "all" && row.assetType !== assetType) return false;
      if (employment !== "all" && row.employmentType !== employment) return false;
      if (q && !`${row.assetName} ${row.driverName} ${row.runReference}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [canonicalRows, view, assetType, employment, search]);

  const counts = useMemo(() => ({
    total: canonicalRows.length,
    green: canonicalRows.filter(row => row.status === "Compliant").length,
    amber: canonicalRows.filter(row => row.status === "Review" || row.status === "Paper evidence required").length,
    red: canonicalRows.filter(row => row.status === "Non-compliant").length,
  }), [canonicalRows]);

  async function record(row: ComplianceRow, kind: "Chased" | "PaperCheck") {
    const note = kind === "PaperCheck" ? window.prompt(`Paper walkround check for ${row.assetName} (${row.driverName}). Add a note if needed:`, "") : window.prompt(`How did you chase ${row.driverName}? (e.g. rang, texted)`, "Rang driver");
    if (note === null) return;
    const key = `${row.assetType}-${row.assetId}-${row.driverId}`;
    setBusyKey(key); setActionError(undefined);
    try {
      await request("/api/v1/daily-compliance/checks", await token(), { method: "POST", body: JSON.stringify({ date, assetType: row.assetType, assetId: row.assetId, driverId: row.driverId, kind, note: note || null }) });
      await report.refetch();
    } catch (exception) { setActionError(exception instanceof Error ? exception.message : "Could not record that."); }
    finally { setBusyKey(undefined); }
  }

  function exportFiltered() {
    const header = ["Date", "Asset Type", "Asset", "Run", "Driver", "Employment Type", "Tacho Start", "Pre-use Other Work Minutes", "First Movement", "Fleetio Form", "Fleetio Submitted", "Fleetio User", "Fleetio Driver Match", "Failed Items", "Status", "Reason", "Office action"];
    const lines = [header.map(csvCell).join(",")];
    rows.forEach(row => lines.push([
      date, row.assetType, row.assetName, row.runReference, row.driverName, row.employmentType,
      row.tachoDutyStartUtc || "", row.tachoPreUseOtherWorkMinutes ?? "", row.firstMovementUtc || "",
      row.fleetioForm || "", row.fleetioSubmittedAtUtc || "", row.fleetioUser || "",
      row.fleetioDriverMatched == null ? "" : row.fleetioDriverMatched ? "Yes" : "No",
      row.fleetioFailedItems ?? "", row.status, row.reason, row.officeAction || "",
    ].map(csvCell).join(",")));
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vehicle-checks-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return <section className="ui-page">
    <div className="ui-page-head">
      <div>
        <h1>Vehicle checks</h1>
        <p>Every vehicle and trailer used, matched to the driver's Fleetio walkround. Chase anything missing, or record a paper check.</p>
      </div>
      <button type="button" onClick={exportFiltered} disabled={!rows.length}>Export CSV</button>
    </div>

    {report.data && <div className="ui-grid">
      <button type="button" className={`ui-metric ${counts.red ? "red" : "green"}`} onClick={() => setView("red")}><span>Not checked</span><strong>{counts.red}</strong><small>no walkround, or defects reported</small></button>
      <button type="button" className={`ui-metric ${counts.amber ? "amber" : "green"}`} onClick={() => setView("attention")}><span>To confirm</span><strong>{counts.amber}</strong><small>paper check or a different name on Fleetio</small></button>
      <button type="button" className="ui-metric green" onClick={() => setView("all")}><span>Checked</span><strong>{counts.green}</strong><small>of {counts.total} used</small></button>
    </div>}

    <div className="ui-filters">
      <div className="ui-seg" role="group" aria-label="Show">
        {([["attention", "Needs attention"], ["red", "Not checked"], ["all", "All"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
      </div>
      <label>Asset<select value={assetType} onChange={event => setAssetType(event.target.value)}><option value="all">Vehicles & trailers</option><option value="Vehicle">Vehicles</option><option value="Trailer">Trailers</option></select></label>
      <label>Driver type<select value={employment} onChange={event => setEmployment(event.target.value)}><option value="all">All drivers</option><option value="Employed">Employed</option><option value="Casual">Casual</option><option value="Agency">Agency</option><option value="Subcontractor">Subcontractor</option></select></label>
      <label>Search<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Driver, vehicle or run" /></label>
    </div>

    {(report.isLoading || drivers.isLoading) && !report.data && <div className="ui-empty">Matching Fleetio checks to Tacho and tracking…</div>}
    {report.error && <p className="ui-error">{report.error.message}</p>}
    {actionError && <p className="ui-error">{actionError}</p>}

    {report.data && <section className="ui-card">
      {rows.length === 0 ? <div className="ui-empty">{view === "all" ? "No vehicles or trailers used on this date." : "Nothing needs attention. Every vehicle used has a walkround check."}</div> : <div className="ui-table-wrap"><table className="ui-table">
        <thead><tr><th>Status</th><th>Vehicle / trailer</th><th>Driver</th><th>Fleetio walkround</th><th>Started</th><th /></tr></thead>
        <tbody>{rows.map(row => {
          const key = `${row.assetType}-${row.assetId}-${row.driverId}`;
          return <tr key={`${key}-${row.tachoDutyStartUtc || row.runReference}`}>
            <td><span className={`ui-chip ${tone(row.status)}`}>{statusText[row.status]}</span><br /><small>{row.reason}</small>{row.officeAction && <><br /><small><strong>{row.officeAction}</strong></small></>}</td>
            <td><strong>{row.assetName}</strong><br /><small>{row.assetType}{row.runReference ? ` · ${row.runReference}` : ""}</small></td>
            <td><strong>{row.driverName}</strong><br /><small>{row.employmentType}</small></td>
            <td>{row.fleetioInspectionId ? <><strong>{row.fleetioForm || "Inspection"}</strong>{row.fleetioDriverMatched === false && <span className="ui-chip amber">different name</span>}<br /><small>{fmtTime(row.fleetioSubmittedAtUtc)} · {row.fleetioUser || "user not known"}{row.fleetioFailedItems ? ` · ${row.fleetioFailedItems} defect${row.fleetioFailedItems === 1 ? "" : "s"}` : ""}</small></> : <span className="ui-chip red">None found</span>}</td>
            <td><small>Tacho {fmtTime(row.tachoDutyStartUtc)}<br />Moved {fmtTime(row.firstMovementUtc)}</small></td>
            <td>{row.status !== "Compliant" && <div className="ui-page-actions">
              <button type="button" disabled={busyKey === key} onClick={() => void record(row, "Chased")}>Chased</button>
              {!row.fleetioFailedItems && <button type="button" disabled={busyKey === key} onClick={() => void record(row, "PaperCheck")}>Paper check seen</button>}
            </div>}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>}

    {report.data && <details className="ui-card">
      <summary><strong>Rules and data sources</strong></summary>
      <p className="hint">{report.data.policy.note}</p>
      <p className="hint">TachoMaster: {report.data.sourceStatus.tachoMaster}<br />Fleetio: {report.data.sourceStatus.fleetio}<br />Tracking: {report.data.sourceStatus.dotFalcon}</p>
    </details>}
  </section>;
}
