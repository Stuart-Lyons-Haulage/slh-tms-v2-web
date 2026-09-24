import { useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { intelligenceApi } from "../lib/intelligenceApi";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate, formatDateLong } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";
import { startVisiblePolling } from "../lib/visiblePolling";
import { DailyAllocationViewer } from "../components/DailyAllocationViewer";
import { SageHrLeavePanel } from "../components/SageHrLeavePanel";
import { getMasterDispatchData, type MasterDriver } from "../api/master";

type DailyComplianceSummary = {
  generatedAtUtc: string;
  sourceStatus: { tachoMaster: string; fleetio: string; dotFalcon: string; tms: string };
  summary: { green: number; amber: number; red: number };
};

type SystemSyncProvider = {
  name: string;
  configured: boolean;
  state: "current" | "delayed" | "stale" | "not-configured" | string;
  lastUpdatedUtc?: string | null;
  ageMinutes?: number | null;
  detail?: string | null;
  cadence?: string | null;
};

type SystemSyncState = {
  status: string;
  generatedAtUtc: string;
  providers: SystemSyncProvider[];
};

type DriverExpiryRisk = {
  driverId: string;
  name: string;
  label: string;
  date: string;
  days: number;
};

function checkedAt(value?: string | null) {
  if (!value) return "No successful receipt";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function feedClass(state: string) {
  return state === "current" ? "green" : state === "delayed" ? "amber" : "red";
}

function feedAge(minutes?: number | null) {
  if (minutes == null) return "No receipt";
  if (minutes < 1) return "<1m ago";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function toMidnight(value?: string) {
  if (!value) return null;
  const date = new Date(`${value.substring(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value?: string) {
  const target = toMidnight(value);
  const today = toMidnight(todayIsoDate());
  if (!target || !today) return null;
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function dateLabel(value: string) {
  const date = toMidnight(value);
  return date ? date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : value;
}

function driverExpiryRisks(drivers: MasterDriver[] | undefined) {
  const risks: DriverExpiryRisk[] = [];
  const addRisk = (driver: MasterDriver, label: string, value?: string) => {
    const days = daysUntil(value);
    if (days == null || days > 30) return;
    risks.push({ driverId: driver.driverId, name: driver.preferredName || driver.fullName, label, date: value || "", days });
  };

  drivers?.filter(driver => driver.isActive).forEach(driver => {
    addRisk(driver, "CPC", driver.cpcExpiry);
    addRisk(driver, "Tacho card", driver.digitalTachoCardExpiry);
    addRisk(driver, "Licence", driver.licenceExpiry);
  });

  return risks.sort((left, right) => left.days - right.days || left.name.localeCompare(right.name));
}

export function DashboardOperational() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const syncState = useApi(useCallback(async () => request<SystemSyncState>("/api/v2/system-sync/state", await token(), undefined, 30000), [token]));
  const compliance = useApi(useCallback(async () => request<DailyComplianceSummary>(`/api/v2/daily-compliance/report?date=${encodeURIComponent(date)}`, await token(), undefined, 90000), [date, token]));
  const masterData = useApi(useCallback(async () => getMasterDispatchData(await token()), [token]));

  const snapshot = readiness.data;
  const readyRuns = snapshot ? Math.max(0, snapshot.runs - snapshot.missingAllocations) : 0;
  const complianceReview = compliance.data ? compliance.data.summary.amber + compliance.data.summary.red : snapshot?.tachoConcerns || 0;
  const complianceAction = compliance.data ? compliance.data.summary.red : snapshot?.tachoConcerns || 0;
  const expiryRisks = driverExpiryRisks(masterData.data?.drivers);
  const expiredRiskCount = expiryRisks.filter(risk => risk.days < 0).length;
  const dueRiskCount = expiryRisks.filter(risk => risk.days >= 0).length;
  const providerCount = syncState.data?.providers.length || 0;
  const feedAttentionCount = syncState.data?.providers.filter(provider => feedClass(provider.state) !== "green").length || 0;

  const refreshReadiness = readiness.refresh;
  const refreshSyncState = syncState.refresh;
  const refreshCompliance = compliance.refresh;
  const refreshMasterData = masterData.refresh;
  const refreshCore = useCallback(() => Promise.allSettled([refreshReadiness(), refreshSyncState(), refreshMasterData()]).then(() => undefined), [refreshMasterData, refreshReadiness, refreshSyncState]);
  const refreshLiveCompliance = useCallback(() => refreshCompliance().then(() => undefined), [refreshCompliance]);
  const refreshAll = useCallback(() => Promise.allSettled([refreshCore(), refreshLiveCompliance()]).then(() => undefined), [refreshCore, refreshLiveCompliance]);

  useEffect(() => startVisiblePolling(refreshCore, 60_000), [refreshCore]);
  useEffect(() => startVisiblePolling(refreshLiveCompliance, 300_000), [refreshLiveCompliance]);

  return <section className="dashboard-health-page dashboard-command-view dashboard-exec-view">
    <div className="dashboard-exec-header">
      <div>
        <p className="eyebrow">Operational dashboard · {formatDateLong(date)}</p>
        <h1>Daily transport control</h1>
        <p>Planning, master data and compliance in one view.</p>
      </div>
      <div className="dashboard-refresh-summary">
        <small>Last refreshed {checkedAt(syncState.data?.generatedAtUtc)}</small>
        <button type="button" onClick={() => void refreshAll()} disabled={readiness.loading || syncState.loading || compliance.loading || masterData.loading}>Refresh all</button>
      </div>
    </div>

    {readiness.error && <p className="notice inline-notice dashboard-warning">Planning status could not refresh: {readiness.error}</p>}
    {syncState.error && <p className="notice inline-notice dashboard-warning">System feeds could not refresh: {syncState.error}</p>}
    {compliance.error && <p className="notice inline-notice dashboard-warning">Compliance could not refresh: {compliance.error}</p>}

    <div className="dashboard-kpi-grid dashboard-exec-kpis">
      <Link to="/" className="dashboard-kpi-card"><span>Runs today</span><strong>{snapshot?.runs ?? "—"}</strong><small>Open Planner Builder</small></Link>
      <Link to="/" className="dashboard-kpi-card"><span>Fully allocated</span><strong>{snapshot ? `${readyRuns}/${snapshot.runs}` : "—"}</strong><small>{snapshot ? `${snapshot.missingAllocations} need allocation` : "Waiting for planning data"}</small></Link>
      <Link to="/compliance" className="dashboard-kpi-card"><span>Compliance review</span><strong>{complianceReview}</strong><small>{complianceAction} require action</small></Link>
      <Link to="/drivers" className="dashboard-kpi-card"><span>Driver expiry</span><strong>{expiredRiskCount + dueRiskCount}</strong><small>{expiredRiskCount} expired · {dueRiskCount} due in 30 days</small></Link>
      <Link to="/master-data" className="dashboard-kpi-card"><span>Data feeds</span><strong>{providerCount ? `${providerCount - feedAttentionCount}/${providerCount}` : "—"}</strong><small>{feedAttentionCount} need attention</small></Link>
    </div>

    <div className="dashboard-exec-grid">
      <section className="panel dashboard-command-panel dashboard-allocated-runs">
        <div className="dashboard-panel-head">
          <div><p className="eyebrow">Today's planned routes</p><h2>Driver, vehicle and run snapshot</h2></div>
          <Link to="/">Open Planner Builder →</Link>
        </div>
        <DailyAllocationViewer initialDate={date} />
      </section>

      <aside className="dashboard-side-stack">
        <section className="panel dashboard-command-panel dashboard-expiry-panel">
          <div className="dashboard-panel-head">
            <div><p className="eyebrow">Master data · driver compliance</p><h2>CPC, tacho card & licence expiry</h2></div>
            <Link to="/drivers">Driver Master →</Link>
          </div>
          <div className="dashboard-risk-summary">
            <span className={expiredRiskCount ? "risk-bad" : "risk-good"}><strong>{expiredRiskCount}</strong><small>Expired</small></span>
            <span className={dueRiskCount ? "risk-warn" : "risk-good"}><strong>{dueRiskCount}</strong><small>Due in 30 days</small></span>
          </div>
          {masterData.error && <p className="dashboard-inline-status warning">{masterData.error}</p>}
          {!masterData.error && expiryRisks.length ? <div className="dashboard-risk-list">
            {expiryRisks.slice(0, 6).map(risk => <Link key={`${risk.driverId}-${risk.label}-${risk.date}`} to="/drivers" className={`dashboard-risk-row ${risk.days < 0 ? "expired" : "due"}`}>
              <span>{risk.days < 0 ? "Expired" : `${risk.days}d`}</span>
              <div><strong>{risk.name}</strong><small>{risk.label} · {dateLabel(risk.date)}</small></div>
              <b>→</b>
            </Link>)}
          </div> : !masterData.error && <p className="dashboard-empty">No driver document expiries are due in the next 30 days.</p>}
        </section>

        <section className="panel dashboard-command-panel dashboard-feed-panel">
          <div className="dashboard-panel-head">
            <div><p className="eyebrow">System feeds</p><h2>Data freshness</h2></div>
            <Link to="/master-data">Master Data →</Link>
          </div>
          <div className="dashboard-feed-score"><strong>{providerCount ? `${providerCount - feedAttentionCount}/${providerCount}` : "—"}</strong><small>feeds current</small></div>
          <div className="dashboard-feed-list compact-list">
            {syncState.data?.providers.map(feed => <div key={feed.name} className={`dashboard-feed-row feed-${feedClass(feed.state)}`} title={feed.detail || undefined}>
              <span aria-hidden="true" />
              <div><strong>{feed.name}</strong><small>{feedAge(feed.ageMinutes)}{feed.cadence ? ` · ${feed.cadence}` : ""}</small></div>
              <b>{feed.state === "current" ? "Current" : "Check"}</b>
            </div>)}
          </div>
        </section>

        <SageHrLeavePanel date={date} days={5} maxItems={8} compact />
      </aside>
    </div>

    <div className="dashboard-handoff-links">
      <Link to="/">Planner Builder →</Link>
      <Link to="/pallet-control">Pallet Order →</Link>
      <Link to="/master-data">Master Data →</Link>
      <Link to="/compliance">Compliance →</Link>
    </div>
  </section>;
}
