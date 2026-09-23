import { useCallback, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { DailyCompliance } from "./DailyCompliance";

type NightOutRow = {
  date: string;
  driverId: string;
  driverName: string;
  employmentType: string;
  runs: string[];
  plannerTicked: boolean;
  tachoRestEvidence: boolean;
  tachoRestMinutes: number;
  trackerEvidenceUtc?: string;
  trackerAwayFromBase?: boolean;
  baseReturnAtUtc?: string;
  baseGeofenceName?: string;
  status: string;
  sageExpenseStatus: string;
};

type NonEmployedRow = {
  date: string;
  driverId: string;
  driverName: string;
  employeeNumber: string;
  employmentType: string;
  agencyName?: string;
  tachoDutyStartUtc?: string;
  tachoDutyEndUtc?: string;
  tachoDutySpanMinutes?: number;
  tachoActivityMinutes?: number;
  trackerFirstMovementUtc?: string;
  trackerLastMovementUtc?: string;
  trackerMovementSpanMinutes?: number;
  trackerVehicles: string[];
  runs: string[];
  varianceMinutes?: number;
  evidenceStatus: string;
};

type DriverHoursReport = {
  weekStart: string;
  weekEnd: string;
  generatedAtUtc: string;
  policy: {
    weekStarts: string;
    weekEnds: string;
    operatingDayRule: string;
    nightOutRule: string;
    fleetCheckRule: string;
  };
  sourceStatus: {
    tachoMaster: string;
    tracker: string;
    baseSite: string;
    sageHrExpenses: string;
  };
  nightOuts: NightOutRow[];
  nonEmployedHours: NonEmployedRow[];
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const wednesday = () => {
  const d = new Date();
  const delta = (d.getDay() - 3 + 7) % 7;
  d.setDate(d.getDate() - delta);
  return iso(d);
};
const fmtDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"2-digit", year:"numeric" }).format(new Date(`${value}T12:00:00`));
const fmtTime = (value?: string) => value ? new Intl.DateTimeFormat("en-GB", { hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value)) : "—";
const mins = (value?: number) => value == null ? "—" : `${Math.floor(value/60)}h ${String(Math.abs(value)%60).padStart(2,"0")}m`;

function WeeklyEvidence() {
  const token = useAccessToken();
  const [date, setDate] = useState(wednesday());
  const [view, setView] = useState<"nights" | "non-employed">("nights");
  const report = useApi(useCallback(async () => request<DriverHoursReport>(`/api/v1/driver-hours-compliance/weekly?date=${date}`, await token(), undefined, 90000), [date, token]));

  const confirmedNights = useMemo(() => (report.data?.nightOuts || []).filter(row => row.status === "Confirmed").length, [report.data]);
  const detectedNights = useMemo(() => (report.data?.nightOuts || []).filter(row => row.status.startsWith("Detected")).length, [report.data]);
  const invoiceConfirmed = useMemo(() => (report.data?.nonEmployedHours || []).filter(row => row.evidenceStatus === "Confirmed by Tacho + tracker").length, [report.data]);

  async function exportAgencyHours() {
    const accessToken = await token();
    const response = await fetch(`/tms-api/api/v1/driver-hours-compliance/non-employed.csv?date=${encodeURIComponent(date)}`, {
      headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    });
    if (!response.ok) throw new Error(`Agency-hours export failed (${response.status}).`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `non-employed-driver-hours-${report.data?.weekStart || date}-to-${report.data?.weekEnd || date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Driver hours / Compliance</p>
        <h1>Driver hours, night outs & agency invoice control</h1>
        <p className="intro">The operating week is Wednesday to Tuesday. PM work remains on the day the vehicle starts, even when the run and delivery continue after midnight.</p>
      </div>
    </div>

    <div className="panel" style={{ display:"flex", gap:12, alignItems:"end", flexWrap:"wrap" }}>
      <label>Operating week<input type="date" value={date} onChange={event=>setDate(event.target.value)} /></label>
      {report.data && <strong>{fmtDate(report.data.weekStart)} → {fmtDate(report.data.weekEnd)}</strong>}
      <button className={view === "nights" ? "primary" : undefined} onClick={()=>setView("nights")}>Night outs</button>
      <button className={view === "non-employed" ? "primary" : undefined} onClick={()=>setView("non-employed")}>Non-employed hours</button>
      {view === "non-employed" && <button onClick={()=>void exportAgencyHours()}>Export invoice-check CSV</button>}
    </div>

    {report.loading && <div className="state">Reconciling TachoMaster, DOT/Falcon, TMS planning and Base geofence evidence…</div>}
    {report.error && <p className="notice">{report.error}</p>}

    {report.data && <>
      <div className="metrics">
        <article className="metric"><span>Confirmed nights out</span><strong>{confirmedNights}</strong><small>Planner + Tacho rest + no Base return</small></article>
        <article className="metric"><span>Detected nights</span><strong>{detectedNights}</strong><small>Tacho + tracker confirm it but planner tick is missing</small></article>
        <article className="metric"><span>Non-employed day rows</span><strong>{report.data.nonEmployedHours.length}</strong><small>Agency, subcontract and other non-employed drivers</small></article>
        <article className="metric"><span>Invoice evidence confirmed</span><strong>{invoiceConfirmed}</strong><small>Tacho duty backed by tracker movement</small></article>
      </div>

      <div className="panel">
        <strong>Operating rules</strong>
        <p>{report.data.policy.nightOutRule}</p>
        <p>{report.data.policy.fleetCheckRule}</p>
        <small>{report.data.sourceStatus.baseSite} · Sage: {report.data.sourceStatus.sageHrExpenses}</small>
      </div>

      {view === "nights" ? <div className="panel" style={{ overflowX:"auto" }}>
        <table>
          <thead><tr><th>Date</th><th>Driver</th><th>Runs</th><th>Planner</th><th>Tacho rest</th><th>Tracker / Base</th><th>Status</th><th>Sage expense</th></tr></thead>
          <tbody>{report.data.nightOuts.map(row => <tr key={`${row.date}-${row.driverId}`}>
            <td><strong>{fmtDate(row.date)}</strong></td>
            <td><strong>{row.driverName}</strong><br/><small>{row.employmentType}</small></td>
            <td>{row.runs.join(", ") || "—"}</td>
            <td>{row.plannerTicked ? "✓ Night out ticked" : "⚠ Not ticked"}</td>
            <td>{row.tachoRestEvidence ? `✓ ${mins(row.tachoRestMinutes)} rest / overnight duty` : "Not confirmed"}</td>
            <td>{row.trackerAwayFromBase === true
              ? `✓ No return to ${row.baseGeofenceName || "Base"}`
              : row.trackerAwayFromBase === false
                ? `Returned to ${row.baseGeofenceName || "Base"}${row.baseReturnAtUtc ? ` at ${fmtTime(row.baseReturnAtUtc)}` : ""}`
                : "Base/geofence confirmation unavailable"}
              <br/><small>Tracker evidence {fmtTime(row.trackerEvidenceUtc)}</small></td>
            <td><strong>{row.status}</strong></td>
            <td>{row.sageExpenseStatus}</td>
          </tr>)}</tbody>
        </table>
        {!report.data.nightOuts.length && <p>No night-out evidence was found for this operating week.</p>}
      </div> : <div className="panel" style={{ overflowX:"auto" }}>
        <table>
          <thead><tr><th>Date</th><th>Driver</th><th>Type / agency</th><th>Runs</th><th>Tacho duty</th><th>Tacho activity</th><th>Tracker span</th><th>Variance</th><th>Invoice evidence</th></tr></thead>
          <tbody>{report.data.nonEmployedHours.map(row => <tr key={`${row.date}-${row.driverId}`}>
            <td><strong>{fmtDate(row.date)}</strong></td>
            <td><strong>{row.driverName}</strong><br/><small>{row.employeeNumber}</small></td>
            <td>{row.employmentType}{row.agencyName ? <><br/><small>{row.agencyName}</small></> : null}</td>
            <td>{row.runs.join(", ") || "—"}</td>
            <td>{row.tachoDutyStartUtc ? `${fmtTime(row.tachoDutyStartUtc)} → ${fmtTime(row.tachoDutyEndUtc)} · ${mins(row.tachoDutySpanMinutes)}` : "—"}</td>
            <td>{mins(row.tachoActivityMinutes)}</td>
            <td>{row.trackerFirstMovementUtc ? `${fmtTime(row.trackerFirstMovementUtc)} → ${fmtTime(row.trackerLastMovementUtc)} · ${mins(row.trackerMovementSpanMinutes)}` : "—"}</td>
            <td>{row.varianceMinutes == null ? "—" : `${row.varianceMinutes > 0 ? "+" : ""}${row.varianceMinutes} min`}</td>
            <td><strong>{row.evidenceStatus}</strong></td>
          </tr>)}</tbody>
        </table>
        {!report.data.nonEmployedHours.length && <p>No non-employed driver hours were found for this operating week.</p>}
      </div>}

      <div className="panel">
        <h2>Source confidence</h2>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:10 }}>
          <div><strong>TachoMaster</strong><br/><small>{report.data.sourceStatus.tachoMaster}</small></div>
          <div><strong>DOT / Falcon</strong><br/><small>{report.data.sourceStatus.tracker}</small></div>
          <div><strong>Base geofence</strong><br/><small>{report.data.sourceStatus.baseSite}</small></div>
          <div><strong>Sage HR expenses</strong><br/><small>{report.data.sourceStatus.sageHrExpenses}</small></div>
        </div>
      </div>
    </>}
  </section>;
}

export function NightOutReport() {
  const [view, setView] = useState<"daily" | "weekly">("daily");
  return <>
    <div className="panel" style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
      <button className={view === "daily" ? "primary" : undefined} onClick={()=>setView("daily")}>Daily fleet compliance</button>
      <button className={view === "weekly" ? "primary" : undefined} onClick={()=>setView("weekly")}>Driver hours / Night outs</button>
    </div>
    {view === "daily" ? <DailyCompliance /> : <WeeklyEvidence />}
  </>;
}