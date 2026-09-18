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
  lastPlatformUpdateUtc?: string | null;
  displaySource: string;
  providers: SystemSyncProvider[];
};

type DriverExpiryRisk = {
  driverId: string;
  name: string;
  label: string;
  date: string;
  days: number;
};

function feedAge(minutes?: number | null) {
  if (minutes == null) return "No receipt";
  if (minutes < 1) return "<1m ago";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function checkedAt(value?: string | null) {
  if (!value) return "No successful receipt";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function feedClass(state: string) {
  return state === "current" ? "green" : state === "delayed" ? "amber" : "red";
}

function feedLabel(state: string) {
  return state === "current" ? "Current" : state === "delayed" ? "Check" : "Attention";
}

function toMidnight(value?: string) {
  if (!value) return null;
  const date = new Date(`${value.substring(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value?: string) {
  const target = toMidnight(value);
  if (!target) return null;
  const today = toMidnight(todayIsoDate());
  if (!today) return null;
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
    risks.push({
      driverId: driver.driverId,
      name: driver.preferredName || driver.fullName,
      label,
      date: value || "",
      days
    });
  };

  drivers?.filter(driver => driver.isActive).forEach(driver => {
    addRisk(driver, "CPC", driver.cpcExpiry);
    addRisk(driver, "Tacho card", driver.digitalTachoCardExpiry);
    addRisk(driver, "Licence", driver.licenceExpiry);
  });

  return risks.sort((left, right) => left.days - right.days || left.name.localeCompare(right.name));
}

function isAccessMessage(message: string) {
  return message.toLowerCase().includes("api access") || message.toLowerCase().includes("sign-in");
}

export function DashboardOperational() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const attention = useApi(useCallback(async () => intelligenceApi.attention(date, await token()), [date, token]));
  const syncState = useApi(useCallback(async () => request<SystemSyncState>("/api/v1/system-sync/state", await token(), undefined, 30000), [token]));
  const compliance = useApi(useCallback(async () => request<DailyComplianceSummary>(`/api/v1/daily-compliance/report?date=${encodeURIComponent(date)}`, await token(), undefined, 90000), [date, token]));
  const masterData = useApi(useCallback(async () => getMasterDispatchData(await token()), [token]));
  const snapshot = readiness.data;
  const readyRuns = snapshot ? Math.max(0, snapshot.runs - snapshot.missingAllocations) : 0;
  const highAttention = attention.data?.items.filter(item => item.severity?.toLowerCase() === "high").length || 0;
  const fleetProvider = syncState.data?.providers.find(provider => provider.name === "Fleetio");
  const liveVorConflicts = snapshot?.vorConflicts || 0;
  const walkroundReview = compliance.data ? compliance.data.summary.amber + compliance.data.summary.red : snapshot?.tachoConcerns || 0;
  const walkroundAction = compliance.data ? compliance.data.summary.red : snapshot?.tachoConcerns || 0;
  const expiryRisks = driverExpiryRisks(masterData.data?.drivers);
  const expiredRiskCount = expiryRisks.filter(risk => risk.days < 0).length;
  const dueRiskCount = expiryRisks.filter(risk => risk.days >= 0).length;
  const providerCount = syncState.data?.providers.length || 0;
  const feedAttentionCount = syncState.data?.providers.filter(provider => feedClass(provider.state) !== "green").length || 0;
  const accessOnlyMasterWarning = masterData.error ? isAccessMessage(masterData.error) : false;
  const operationalReady = snapshot
    ? snapshot.runs > 0 && snapshot.missingAllocations === 0 && liveVorConflicts === 0 && walkroundAction === 0 && snapshot.geofenceGaps === 0 && snapshot.unreviewedOrders === 0 && highAttention === 0
    : false;

  const refreshReadiness = readiness.refresh;
  const refreshAttention = attention.refresh;
  const refreshSyncState = syncState.refresh;
  const refreshCompliance = compliance.refresh;
  const refreshMasterData = masterData.refresh;
  const refreshCore = useCallback(() => Promise.allSettled([refreshReadiness(), refreshAttention(), refreshSyncState(), refreshMasterData()]).then(() => undefined), [refreshAttention, refreshMasterData, refreshReadiness, refreshSyncState]);
  const refreshLiveCompliance = useCallback(() => refreshCompliance().then(() => undefined), [refreshCompliance]);
  const refreshAll = useCallback(() => Promise.allSettled([refreshCore(), refreshLiveCompliance()]).then(() => undefined), [refreshCore, refreshLiveCompliance]);

  // UI polling only re-reads persisted TMS state. It does not trigger provider calls. The actual
  // provider cadences are owned by the scheduled/background integration workers.
  useEffect(() => startVisiblePolling(refreshCore, 60_000), [refreshCore]);
  useEffect(() => startVisiblePolling(refreshLiveCompliance, 300_000), [refreshLiveCompliance]);

  return <section className="dashboard-health-page dashboard-command-view dashboard-exec-view">
    <span className="dashboard-sr-only">Today's attention</span>
    <div className="dashboard-exec-header">
      <div>
        <p className="eyebrow">Operational health · {formatDateLong(date)}</p>
        <h1>Daily command dashboard</h1>
        <p>Orders, allocation, walkrounds, driver compliance and system feeds in one control view.</p>
      </div>
      <div className="dashboard-refresh-summary">
        <small>Last refreshed {checkedAt(syncState.data?.generatedAtUtc)}</small>
        <button type="button" onClick={() => void refreshAll()} disabled={readiness.loading || attention.loading || syncState.loading || compliance.loading || masterData.loading}>Refresh all</button>
      </div>
    </div>

    {readiness.error && <p className="notice inline-notice dashboard-warning">Operational health could not refresh: {readiness.error}</p>}
    {syncState.error && <p className="notice inline-notice dashboard-warning">System feeds could not refresh: {syncState.error}</p>}
    {compliance.error && <p className="notice inline-notice dashboard-warning">Walkround checks could not refresh; using readiness fallback: {compliance.error}</p>}

    {snapshot && <div className="dashboard-status-band">
      <div className={`dashboard-status-card ${operationalReady ? "good" : "attention"}`}>
        <span>{operationalReady ? "✓" : "!"}</span>
        <div><small>Overall status</small><strong>{operationalReady ? "Ready to operate" : "Action required"}</strong></div>
      </div>
      <div className="dashboard-status-point"><strong>{snapshot.runs}</strong><small>runs today</small></div>
      <div className="dashboard-status-point"><strong>{readyRuns}</strong><small>fully allocated</small></div>
      <div className="dashboard-status-point"><strong>{highAttention}</strong><small>high priority</small></div>
      <div className="dashboard-status-point"><strong>{feedAttentionCount}</strong><small>feed issue{feedAttentionCount === 1 ? "" : "s"}</small></div>
    </div>}

    {snapshot && <div className="dashboard-kpi-grid dashboard-exec-kpis">
      <Link to={`/staging?date=${encodeURIComponent(date)}`} className="dashboard-kpi-card priority"><span>Orders to review</span><strong>{snapshot.unreviewedOrders}</strong><small>Need approval before planning</small></Link>
      <Link to="/driver-dispatch" className="dashboard-kpi-card"><span>Runs ready</span><strong>{readyRuns}/{snapshot.runs}</strong><small>{snapshot.missingAllocations} need allocation</small></Link>
      <Link to="/compliance" className="dashboard-kpi-card"><span>Walkround checks</span><strong>{walkroundReview}</strong><small>{compliance.data ? `${walkroundAction} action · ${compliance.data.summary.amber} review` : "Compliance fallback"}</small></Link>
      <Link to="/fleet-assets" className="dashboard-kpi-card"><span>Fleet / VOR</span><strong>{liveVorConflicts}</strong><small>{fleetProvider ? `Fleetio · ${checkedAt(fleetProvider.lastUpdatedUtc)}` : "Fleetio unavailable"}</small></Link>
      <Link to="/attention" className="dashboard-kpi-card priority"><span>High priority</span><strong>{highAttention}</strong><small>Open high risk exceptions</small></Link>
    </div>}

    <div className="dashboard-exec-grid">
      <section className="panel dashboard-command-panel dashboard-allocated-runs">
        <div className="dashboard-panel-head">
          <div><p className="eyebrow">Today's allocated routes</p><h2>Driver, vehicle and run snapshot</h2></div>
          <Link to="/driver-dispatch">Open Driver Dispatch →</Link>
        </div>
        <DailyAllocationViewer initialDate={date} />
      </section>

      <aside className="dashboard-side-stack">
        <section className="panel dashboard-command-panel dashboard-expiry-panel">
          <div className="dashboard-panel-head">
            <div><p className="eyebrow">Driver compliance risk</p><h2>CPC, tacho card & licence expiry</h2></div>
            <Link to="/driver-master">Driver Master →</Link>
          </div>
          <div className="dashboard-risk-summary">
            <span className={expiredRiskCount ? "risk-bad" : "risk-good"}><strong>{expiredRiskCount}</strong><small>Expired</small></span>
            <span className={dueRiskCount ? "risk-warn" : "risk-good"}><strong>{dueRiskCount}</strong><small>Due in 30 days</small></span>
          </div>
          {masterData.error && <p className={`dashboard-inline-status ${accessOnlyMasterWarning ? "muted" : "warning"}`}>{accessOnlyMasterWarning ? "Driver expiry data needs TMS API access for this account." : masterData.error}</p>}
          {!masterData.error && expiryRisks.length ? <div className="dashboard-risk-list">
            {expiryRisks.slice(0, 6).map(risk => <Link key={`${risk.driverId}-${risk.label}-${risk.date}`} to={`/driver-master?driverId=${encodeURIComponent(risk.driverId)}`} className={`dashboard-risk-row ${risk.days < 0 ? "expired" : "due"}`}>
              <span>{risk.days < 0 ? "Expired" : `${risk.days}d`}</span>
              <div><strong>{risk.name}</strong><small>{risk.label} · {dateLabel(risk.date)}</small></div>
              <b>→</b>
            </Link>)}
          </div> : !masterData.error && <p className="dashboard-empty">No CPC, digital tacho card or licence expiries are due in the next 30 days.</p>}
        </section>

        <section className="panel dashboard-command-panel dashboard-feed-panel">
          <div className="dashboard-panel-head">
            <div><p className="eyebrow">System feeds</p><h2>Data freshness</h2></div>
            <Link to="/control-centre">Control centre →</Link>
          </div>
          <div className="dashboard-feed-score"><strong>{providerCount - feedAttentionCount}/{providerCount}</strong><small>feeds current</small></div>
          <div className="dashboard-feed-list compact-list">
            {syncState.data?.providers.map(feed => <div key={feed.name} className={`dashboard-feed-row feed-${feedClass(feed.state)}`} title={feed.detail || undefined}>
              <span aria-hidden="true" />
              <div><strong>{feed.name}</strong><small>{feedAge(feed.ageMinutes)}{feed.cadence ? ` · ${feed.cadence}` : ""}</small></div>
              <b>{feedLabel(feed.state)}</b>
            </div>)}
          </div>
        </section>

        <SageHrLeavePanel date={date} days={5} maxItems={8} compact />
      </aside>
    </div>

    <div className="dashboard-handoff-links"><Link to={`/staging?date=${encodeURIComponent(date)}`}>Order Review →</Link><Link to="/">Planner →</Link><Link to="/driver-dispatch">Driver Dispatch →</Link><Link to="/operations-wallboard">Live operations →</Link></div>
  </section>;
}
