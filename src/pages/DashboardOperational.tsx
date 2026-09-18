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
  const operationalReady = snapshot
    ? snapshot.runs > 0 && snapshot.missingAllocations === 0 && liveVorConflicts === 0 && walkroundAction === 0 && snapshot.geofenceGaps === 0 && snapshot.unreviewedOrders === 0
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

  return <section className="dashboard-health-page dashboard-command-view">
    <span className="dashboard-sr-only">Today's attention</span>
    <div className="title-row dashboard-health-title">
      <div>
        <p className="eyebrow">Operational health · {formatDateLong(date)}</p>
        <h1>Today at a glance</h1>
      </div>
      <div className="dashboard-refresh-summary">
        <small>Last refreshed {checkedAt(syncState.data?.generatedAtUtc)}</small>
        <button type="button" onClick={() => void refreshAll()} disabled={readiness.loading || attention.loading || syncState.loading || compliance.loading || masterData.loading}>Refresh all</button>
      </div>
    </div>

    {readiness.error && <p className="notice inline-notice">Operational health could not refresh: {readiness.error}</p>}
    {syncState.error && <p className="notice inline-notice">Canonical integration state could not refresh: {syncState.error}</p>}
    {compliance.error && <p className="notice inline-notice">Walkround compliance could not refresh; the dashboard is temporarily using the readiness fallback: {compliance.error}</p>}
    {masterData.error && <p className="notice inline-notice">Driver expiry risk could not refresh: {masterData.error}</p>}

    {snapshot && <>
      <div className={`dashboard-health-state ${operationalReady ? "good" : "attention"}`}>
        <div><span>{operationalReady ? "✓" : "!"}</span><div><small>Operational health</small><strong>{operationalReady ? "Ready to operate" : "Action required"}</strong></div></div>
        <p>{snapshot.runs} runs today · {readyRuns} fully allocated · {highAttention} high priority</p>
      </div>

      <div className="dashboard-health-grid dashboard-kpi-grid">
        <Link to={`/staging?date=${encodeURIComponent(date)}`}><article className={snapshot.unreviewedOrders ? "attention" : "good"}><span>Orders to review</span><strong>{snapshot.unreviewedOrders}</strong><small>Need review / approval</small></article></Link>
        <Link to="/driver-dispatch"><article className={snapshot.missingAllocations ? "attention" : "good"}><span>Runs ready</span><strong>{readyRuns}/{snapshot.runs}</strong><small>{snapshot.missingAllocations} need allocation</small></article></Link>
        <Link to="/fleet-assets"><article className={liveVorConflicts ? "attention" : "good"}><span>Fleet / VOR</span><strong>{liveVorConflicts}</strong><small>{fleetProvider ? `Fleetio · ${checkedAt(fleetProvider.lastUpdatedUtc)}` : "Fleetio unavailable"}</small></article></Link>
        <Link to="/compliance"><article className={walkroundAction ? "attention" : walkroundReview ? "neutral" : "good"}><span>Walkround checks</span><strong>{walkroundReview}</strong><small>{compliance.data ? `${walkroundAction} action · ${compliance.data.summary.amber} review` : "Compliance fallback"}</small></article></Link>
        <Link to="/attention"><article className={highAttention ? "attention" : "good"}><span>High priority</span><strong>{highAttention}</strong><small>Open high risk exceptions</small></article></Link>
      </div>
    </>}

    <div className="dashboard-command-grid dashboard-command-grid-refined">
      <section className="dashboard-widget-wrap dashboard-allocated-runs"><DailyAllocationViewer initialDate={date} /></section>

      <aside className="dashboard-side-stack">
        <section className="panel dashboard-expiry-panel">
          <div className="title-row"><div><p className="eyebrow">Driver compliance risk</p><h2>CPC, tacho card & licence expiry</h2></div><Link to="/driver-master">Driver Master →</Link></div>
          <div className="dashboard-risk-summary">
            <span className={expiredRiskCount ? "risk-bad" : "risk-good"}><strong>{expiredRiskCount}</strong><small>Expired</small></span>
            <span className={dueRiskCount ? "risk-warn" : "risk-good"}><strong>{dueRiskCount}</strong><small>Due in 30 days</small></span>
          </div>
          {expiryRisks.length ? <div className="dashboard-risk-list">
            {expiryRisks.slice(0, 6).map(risk => <Link key={`${risk.driverId}-${risk.label}-${risk.date}`} to={`/driver-master?driverId=${encodeURIComponent(risk.driverId)}`} className={`dashboard-risk-row ${risk.days < 0 ? "expired" : "due"}`}>
              <span>{risk.days < 0 ? "Expired" : `${risk.days}d`}</span>
              <div><strong>{risk.name}</strong><small>{risk.label} · {dateLabel(risk.date)}</small></div>
              <b>→</b>
            </Link>)}
          </div> : <p className="hint">No CPC, digital tacho card or licence expiries are due in the next 30 days.</p>}
        </section>

        <section className="panel dashboard-feed-panel">
          <div className="title-row"><div><p className="eyebrow">System feeds</p><h2>Receiving current data</h2></div><Link to="/control-centre">Control centre →</Link></div>
          {syncState.error && <p className="notice inline-notice">Feed health could not refresh: {syncState.error}</p>}
          <div className="dashboard-feed-list compact-list">
            {syncState.data?.providers.map(feed => <div key={feed.name} className={`dashboard-feed-row feed-${feedClass(feed.state)}`} title={feed.detail || undefined}>
              <span aria-hidden="true" />
              <div><strong>{feed.name}</strong><small>{feedAge(feed.ageMinutes)}{feed.cadence ? ` · ${feed.cadence}` : ""}</small></div>
              <b>{feedLabel(feed.state)}</b>
            </div>)}
          </div>
        </section>

        <SageHrLeavePanel date={date} days={5} maxItems={6} compact />
      </aside>
    </div>

    <div className="dashboard-handoff-links"><Link to={`/staging?date=${encodeURIComponent(date)}`}>Load Review →</Link><Link to="/">Planner →</Link><Link to="/driver-dispatch">Driver Dispatch →</Link><Link to="/operations-wallboard">Live operations →</Link></div>
  </section>;
}
