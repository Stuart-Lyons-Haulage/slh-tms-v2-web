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

function feedAge(minutes?: number | null) { if (minutes == null) return "No successful receipt recorded"; if (minutes < 1) return "<1m ago"; if (minutes < 60) return `${Math.round(minutes)}m ago`; return `${Math.round(minutes / 60)}h ago`; }
function checkedAt(value?: string | null) { if (!value) return "No successful receipt"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function feedClass(state: string) { return state === "current" ? "green" : state === "delayed" ? "amber" : "red"; }
function feedLabel(state: string) { return state === "current" ? "CURRENT" : state === "delayed" ? "CHECK" : "ATTENTION"; }

export function DashboardOperational() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(date, await token()), [date, token]));
  const attention = useApi(useCallback(async () => intelligenceApi.attention(date, await token()), [date, token]));
  const syncState = useApi(useCallback(async () => request<SystemSyncState>("/api/v1/system-sync/state", await token(), undefined, 30000), [token]));
  const compliance = useApi(useCallback(async () => request<DailyComplianceSummary>(`/api/v1/daily-compliance/report?date=${encodeURIComponent(date)}`, await token(), undefined, 90000), [date, token]));
  const snapshot = readiness.data;
  const readyRuns = snapshot ? Math.max(0, snapshot.runs - snapshot.missingAllocations) : 0;
  const highAttention = attention.data?.items.filter(item => item.severity === "High").length || 0;
  const fleetProvider = syncState.data?.providers.find(provider => provider.name === "Fleetio");
  const liveVorConflicts = snapshot?.vorConflicts || 0;
  const complianceConcerns = compliance.data ? compliance.data.summary.amber + compliance.data.summary.red : snapshot?.tachoConcerns || 0;
  const complianceBlocking = compliance.data ? compliance.data.summary.red : snapshot?.tachoConcerns || 0;
  const operationalReady = snapshot
    ? snapshot.runs > 0 && snapshot.missingAllocations === 0 && liveVorConflicts === 0 && complianceBlocking === 0 && snapshot.geofenceGaps === 0 && snapshot.unreviewedOrders === 0
    : false;

  const refreshReadiness = readiness.refresh;
  const refreshAttention = attention.refresh;
  const refreshSyncState = syncState.refresh;
  const refreshCompliance = compliance.refresh;
  const refreshCore = useCallback(() => Promise.allSettled([refreshReadiness(), refreshAttention(), refreshSyncState()]).then(() => undefined), [refreshAttention, refreshReadiness, refreshSyncState]);
  const refreshLiveCompliance = useCallback(() => refreshCompliance().then(() => undefined), [refreshCompliance]);
  const refreshAll = useCallback(() => Promise.allSettled([refreshCore(), refreshLiveCompliance()]).then(() => undefined), [refreshCore, refreshLiveCompliance]);

  // UI polling only re-reads persisted TMS state. It does not trigger provider calls. The actual
  // provider cadences are owned by the scheduled/background integration workers.
  useEffect(() => startVisiblePolling(refreshCore, 60_000), [refreshCore]);
  useEffect(() => startVisiblePolling(refreshLiveCompliance, 300_000), [refreshLiveCompliance]);

  return <section className="dashboard-health-page">
    <div className="title-row dashboard-health-title"><div><p className="eyebrow">Operational health · {formatDateLong(date)}</p><h1>Today at a glance</h1><p className="hint">A decision-focused view of today's loads, runs, people, fleet, exceptions and the systems feeding the operation.</p></div><button type="button" onClick={() => void refreshAll()} disabled={readiness.loading || attention.loading || syncState.loading || compliance.loading}>Refresh all</button></div>
    {readiness.error && <p className="notice inline-notice">Operational health could not refresh: {readiness.error}</p>}
    {syncState.error && <p className="notice inline-notice">Canonical integration state could not refresh: {syncState.error}</p>}
    {compliance.error && <p className="notice inline-notice">Driver compliance could not refresh; the dashboard is temporarily using the readiness fallback: {compliance.error}</p>}
    {snapshot && <><div className={`dashboard-health-state ${operationalReady ? "good" : "attention"}`}><div><span>{operationalReady ? "✓" : "!"}</span><div><small>Operational health</small><strong>{operationalReady ? "READY TO OPERATE" : "ACTION REQUIRED"}</strong></div></div><p>{snapshot.runs} runs today · {readyRuns} fully allocated · {attention.data?.count || 0} active exception{attention.data?.count === 1 ? "" : "s"}</p></div><div className="dashboard-health-grid"><Link to="/staging"><article className={snapshot.unreviewedOrders ? "attention" : "good"}><span>Loads waiting</span><strong>{snapshot.unreviewedOrders}</strong><small>Need review / approval</small></article></Link><Link to="/driver-dispatch"><article className={snapshot.missingAllocations ? "attention" : "good"}><span>Runs ready</span><strong>{readyRuns}/{snapshot.runs}</strong><small>{snapshot.missingAllocations} need allocation</small></article></Link><Link to="/fleet-assets"><article className={liveVorConflicts ? "attention" : "good"}><span>Fleet / VOR</span><strong>{liveVorConflicts}</strong><small>{fleetProvider ? `Fleetio master · ${checkedAt(fleetProvider.lastUpdatedUtc)}` : "Fleetio master state unavailable"}</small></article></Link><Link to="/compliance"><article className={complianceBlocking ? "attention" : complianceConcerns ? "neutral" : "good"}><span>Driver compliance</span><strong>{complianceConcerns}</strong><small>{compliance.data ? `${compliance.data.summary.red} action · ${compliance.data.summary.amber} review / paper` : "Tacho readiness fallback"}</small></article></Link><Link to="/attention"><article className={highAttention ? "attention" : "good"}><span>High priority</span><strong>{highAttention}</strong><small>{attention.data?.count || 0} total exceptions</small></article></Link></div></>}
    <SageHrLeavePanel date={date} days={5} />
    <DailyAllocationViewer initialDate={date} />
    <div className="dashboard-refresh-strip" role="group" aria-label="Refresh dashboard panels">
      <span>Refresh a panel:</span>
      <button type="button" onClick={() => void refreshCore()} disabled={readiness.loading || attention.loading || syncState.loading}>Health and integration state</button>
      <button type="button" onClick={() => void refreshLiveCompliance()} disabled={compliance.loading}>Driver compliance</button>
    </div>
    <div className="dashboard-health-columns"><section className="panel dashboard-attention-panel"><div className="title-row"><div><p className="eyebrow">Today's attention</p><h2>What needs a decision</h2></div><Link to="/attention">Open all →</Link></div>{attention.error && <p className="notice inline-notice">Exceptions could not refresh: {attention.error}</p>}{attention.data?.items.length ? <div className="dashboard-attention-list">{attention.data.items.slice(0, 6).map(item => <Link key={item.id} to={item.type === "OrderReview" && item.entityId ? `/staging?reviewId=${encodeURIComponent(item.entityId)}&sourceEmail=1` : item.href} className={`dashboard-attention-row severity-${item.severity.toLowerCase()}`}><span>{item.severity}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><b>→</b></Link>)}</div> : <p className="hint">No active operational exceptions are being reported for today.</p>}</section><section className="panel dashboard-feed-panel"><div className="title-row"><div><p className="eyebrow">System feeds</p><h2>Are we receiving current data?</h2><small>One canonical TMS receipt-state. This screen re-reads it every 60 seconds; refreshing the page does not call the providers or change their timestamps.</small></div><Link to="/control-centre">Control centre →</Link></div>{syncState.error && <p className="notice inline-notice">Feed health could not refresh: {syncState.error}</p>}{syncState.data && <p className="hint">Checked at <strong>{checkedAt(syncState.data.generatedAtUtc)}</strong>. Each provider time below is its last successful persisted receipt, not the page refresh time.</p>}<div className="dashboard-feed-list">{syncState.data?.providers.map(feed => <div key={feed.name} className={`dashboard-feed-row feed-${feedClass(feed.state)}`} title={feed.detail || undefined}><span aria-hidden="true" /><div><strong>{feed.name}</strong><small>{feedAge(feed.ageMinutes)}{feed.cadence ? ` · ${feed.cadence}` : ""}</small><small>Last source update: {checkedAt(feed.lastUpdatedUtc)}</small>{feed.detail && <small>{feed.detail}</small>}</div><b>{feedLabel(feed.state)}</b></div>)}</div></section></div>
    <div className="dashboard-handoff-links"><Link to="/staging">Load Review →</Link><Link to="/">Planner →</Link><Link to="/driver-dispatch">Driver Dispatch →</Link><Link to="/operations-wallboard">Live operations →</Link></div>
  </section>;
}
