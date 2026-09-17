import { useCallback } from "react";
import { Link } from "react-router-dom";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type SageHrDriverLeaveItem = {
  date: string;
  driverId?: string;
  employeeNumber: string;
  displayName: string;
  sageHrEmployeeId: number;
  policyName?: string;
  details?: string;
  isPartDay: boolean;
  hours?: number;
  linkedToDriverMaster: boolean;
};

type SageHrDriverLeaveResponse = {
  configured: boolean;
  source: string;
  from: string;
  days: number;
  generatedAtUtc: string;
  items: SageHrDriverLeaveItem[];
  missingSettings?: string[];
  message: string;
};

function todayIsoDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export function SageHrLeavePanel({ date = todayIsoDate(), days = 5 }: { date?: string; days?: number }) {
  const token = useAccessToken();
  const leave = useApi(useCallback(async () => request<SageHrDriverLeaveResponse>(`/api/v1/integrations/sage-hr/driver-leave?from=${encodeURIComponent(date)}&days=${days}`, await token(), undefined, 30000), [date, days, token]));
  const items = leave.data?.items || [];
  const todayItems = items.filter(item => item.date === date);
  const upcoming = items.filter(item => item.date !== date).slice(0, 8);

  return <section className="panel dashboard-leave-panel">
    <div className="title-row">
      <div>
        <p className="eyebrow">Sage HR leave</p>
        <h2>Who's off</h2>
        <small>Used by Driver Dispatch so employed drivers on leave are not suggested for work.</small>
      </div>
      <button type="button" onClick={() => leave.refresh()} disabled={leave.loading}>Refresh</button>
    </div>
    {leave.error && <p className="notice inline-notice">Sage HR leave could not refresh: {leave.error}</p>}
    {leave.data && !leave.data.configured && <p className="notice inline-notice">{leave.data.message}</p>}
    {leave.data && <p className="hint">{leave.data.message}</p>}
    <div className="dashboard-health-grid compact">
      <article className={todayItems.length ? "attention" : "good"}>
        <span>Off today</span>
        <strong>{todayItems.length}</strong>
        <small>{leave.data?.source || "Sage HR"}</small>
      </article>
      <article className={upcoming.length ? "neutral" : "good"}>
        <span>Upcoming leave</span>
        <strong>{items.length - todayItems.length}</strong>
        <small>Next {days} days</small>
      </article>
    </div>
    {items.length ? <div className="dashboard-attention-list">
      {[...todayItems, ...upcoming].slice(0, 10).map(item => <Link key={`${item.date}-${item.employeeNumber}-${item.policyName || "leave"}`} to={item.driverId ? `/driver-master?driverId=${encodeURIComponent(item.driverId)}` : "/driver-master"} className={`dashboard-attention-row severity-${item.date === date ? "high" : "medium"}`}>
        <span>{dateLabel(item.date)}</span>
        <div>
          <strong>{item.displayName}{item.isPartDay ? " · part day" : ""}</strong>
          <small>{item.policyName || "Leave"}{item.details ? ` · ${item.details}` : ""}{!item.linkedToDriverMaster ? " · not linked to Driver Master" : ""}</small>
        </div>
        <b>→</b>
      </Link>)}
    </div> : !leave.loading && <p className="hint">No employed drivers are marked off in Sage HR for this window.</p>}
  </section>;
}
