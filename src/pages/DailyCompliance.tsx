import { useCallback, useMemo, useState } from "react";
import { api, request, type Driver } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { todayIsoDate } from "../lib/dateUtils";

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

// today() replaced with timezone-safe todayIsoDate from dateUtils
const today = todayIsoDate;
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

function statusDot(status: ComplianceRow["status"]) {
  if (status === "Compliant") return "🟢";
  if (status === "Non-compliant") return "🔴";
  return "🟠";
}

export function DailyCompliance() {
  const token = useAccessToken();
  const [date, setDate] = useState(today());
  const [assetType, setAssetType] = useState("all");
  const [status, setStatus] = useState("all");
  const [employment, setEmployment] = useState("all");
  const [search, setSearch] = useState("");
  const report = useApi(useCallback(async () => request<ComplianceReport>(`/api/v1/daily-compliance/report?date=${date}`, await token(), undefined, 90000), [date, token]));
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));

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
      if (assetType !== "all" && row.assetType !== assetType) return false;
      if (status !== "all" && row.status !== status) return false;
      if (employment !== "all" && row.employmentType !== employment) return false;
      if (q && !`${row.assetName} ${row.driverName} ${row.runReference}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [canonicalRows, assetType, status, employment, search]);

  const filteredSummary = useMemo(() => ({
    total: rows.length,
    green: rows.filter(row => row.status === "Compliant").length,
    amber: rows.filter(row => row.status === "Review" || row.status === "Paper evidence required").length,
    red: rows.filter(row => row.status === "Non-compliant").length,
  }), [rows]);

  function exportFiltered() {
    const header = ["Date", "Asset Type", "Asset", "Run", "Driver", "Employment Type", "Tacho Start", "Pre-use Other Work Minutes", "First Movement", "Fleetio Form", "Fleetio Submitted", "Fleetio User", "Fleetio Driver Match", "Failed Items", "Status", "Reason"];
    const lines = [header.map(csvCell).join(",")];
    rows.forEach(row => lines.push([
      date, row.assetType, row.assetName, row.runReference, row.driverName, row.employmentType,
      row.tachoDutyStartUtc || "", row.tachoPreUseOtherWorkMinutes ?? "", row.firstMovementUtc || "",
      row.fleetioForm || "", row.fleetioSubmittedAtUtc || "", row.fleetioUser || "",
      row.fleetioDriverMatched == null ? "" : row.fleetioDriverMatched ? "Yes" : "No",
      row.fleetioFailedItems ?? "", row.status, row.reason,
    ].map(csvCell).join(",")));
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `daily-compliance-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Daily roadworthiness control</p>
        <h1>Daily compliance</h1>
        <p className="intro">Fleetio walkround evidence for every vehicle and trailer used, reconciled to the actual driver, Tacho pre-use other-work and first DOT/Falcon movement. Driver Type is taken from the canonical TMS Driver Master so Casual, Employed and Agency remain distinct.</p>
      </div>
      <button className="primary" type="button" onClick={exportFiltered} disabled={!rows.length}>Export filtered CSV</button>
    </div>

    <div className="panel" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      <label>Date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>Asset<select value={assetType} onChange={event => setAssetType(event.target.value)}><option value="all">Vehicles & trailers</option><option value="Vehicle">Vehicles</option><option value="Trailer">Trailers</option></select></label>
      <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="Compliant">Compliant</option><option value="Paper evidence required">Agency / paper</option><option value="Review">Review</option><option value="Non-compliant">Non-compliant</option></select></label>
      <label>Employment<select value={employment} onChange={event => setEmployment(event.target.value)}><option value="all">All drivers</option><option value="Employed">Employed</option><option value="Casual">Casual</option><option value="Agency">Agency</option><option value="Subcontractor">Subcontractor</option></select></label>
      <label style={{ minWidth: 240 }}>Driver / asset / run<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Start typing…" /></label>
    </div>

    {(report.loading || drivers.loading) && !report.data && <div className="state">Reconciling Fleetio, TachoMaster, DOT/Falcon, the Driver Master and the TMS plan…</div>}
    {report.error && <p className="notice">{report.error}</p>}
    {drivers.error && <p className="notice inline-notice">Driver Master classification could not refresh: {drivers.error}</p>}

    {report.data && <>
      <div className="metrics">
        <article className="metric"><span>Assets in this view</span><strong>{filteredSummary.total}</strong><small>{report.data.summary.vehicles} vehicle duties · {report.data.summary.trailers} trailer duties today</small></article>
        <article className="metric"><span>Compliant</span><strong>🟢 {filteredSummary.green}</strong><small>Fleetio walkround passed · Tacho other-work shown as supporting evidence</small></article>
        <article className="metric"><span>Paper / review</span><strong>🟠 {filteredSummary.amber}</strong><small>Agency paper exception or incomplete electronic evidence</small></article>
        <article className="metric"><span>Action required</span><strong>🔴 {filteredSummary.red}</strong><small>Driver compliance gap or failed Fleetio inspection item</small></article>
      </div>

      <div className="panel">
        <strong>SLH compliance rule</strong>
        <p style={{ marginBottom: 0 }}>{report.data.policy.note}</p>
      </div>

      <div className="panel" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th></th><th>Asset</th><th>Driver</th><th>Run</th><th>Tacho start</th><th>Tacho pre-use evidence</th><th>Fleetio walkround</th><th>First movement</th><th>Status</th></tr></thead>
          <tbody>{rows.map(row => <tr key={`${row.assetType}-${row.assetId}-${row.driverId}-${row.tachoDutyStartUtc || row.runReference}`}>
            <td style={{ fontSize: 18 }}>{statusDot(row.status)}</td>
            <td><strong>{row.assetName}</strong><br/><small>{row.assetType}</small></td>
            <td><strong>{row.driverName}</strong><br/><small>{row.employmentType}</small></td>
            <td>{row.runReference}</td>
            <td>{fmtTime(row.tachoDutyStartUtc)}</td>
            <td><strong>{row.tachoPreUseOtherWorkMinutes == null ? "—" : `${row.tachoPreUseOtherWorkMinutes} min`}</strong><br/><small>{row.tachoPreUseOtherWorkMinutes == null ? "No measurable other-work returned" : "Supporting Tacho evidence · not the pass/fail test"}</small></td>
            <td>{row.fleetioInspectionId ? <><strong>{row.fleetioDriverMatched ? "✓" : "⚠"} {row.fleetioForm || "Inspection"}</strong><br/><small>{fmtTime(row.fleetioSubmittedAtUtc)} · {row.fleetioUser || "User unavailable"}{row.fleetioFailedItems ? ` · ${row.fleetioFailedItems} failed item(s)` : " · no failed items"}</small></> : <strong>Not found</strong>}</td>
            <td>{fmtTime(row.firstMovementUtc)}</td>
            <td><strong>{row.status}</strong><br/><small>{row.reason}</small></td>
          </tr>)}</tbody>
        </table>
        {!report.loading && rows.length === 0 && <p>No operated assets match the selected filters.</p>}
      </div>

      <div className="panel">
        <h2>Source confidence</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          <div><strong>TachoMaster</strong><br/><small>{report.data.sourceStatus.tachoMaster}</small></div>
          <div><strong>Fleetio</strong><br/><small>{report.data.sourceStatus.fleetio}</small></div>
          <div><strong>DOT / Falcon</strong><br/><small>{report.data.sourceStatus.dotFalcon}</small></div>
          <div><strong>TMS</strong><br/><small>{report.data.sourceStatus.tms}</small></div>
        </div>
      </div>
    </>}
  </section>;
}
