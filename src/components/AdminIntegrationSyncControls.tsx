import { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { intelligenceApi } from '../lib/intelligenceApi';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { PlanningWipe } from './PlanningWipe';
import { SageCalendarLink } from './SageCalendarLink';
import { SamsaraReconcile } from './SamsaraReconcile';
import { SlowEndpoints } from './SlowEndpoints';

type SyncResult = { provider: string; success: boolean; completedAtUtc: string; message: string };

type SystemState = {
  status: string;
  generatedAtUtc?: string;
  lastPlatformUpdateUtc?: string;
  schedules: { dot: string; tachoMaster: string; sageHr: string; fleetio: string };
  providers: Array<{ name: string; configured: boolean; state: string; lastUpdatedUtc?: string; ageMinutes?: number }>;
};

type RoadTechStatus = {
  configured: boolean;
  connected: boolean;
  recordCount: number;
  latestEventUtc?: string;
  missingSettings: string[];
  message: string;
};

type SamsaraStatus = {
  configured: boolean;
  connected: boolean;
  vehicleCount: number;
  driverCount: number;
  assetSyncEnabled: boolean;
  missingSettings: string[];
  message: string;
};

type SamsaraSiteAddressStatus = {
  configured: boolean;
  addressSyncEnabled: boolean;
  activeSites: number;
  sitesWithReference: number;
  sitesWithAddress: number;
  sitesWithCoordinates: number;
  eligibleSites: number;
  alreadyMapped: number;
  pending: number;
  missingCoordinates: number;
  missingAddress: number;
  message: string;
};

type IntegrationRuntimeStatus = {
  infoMailboxGraph?: {
    enabled: boolean;
    configured: boolean;
    mailbox?: string;
    lastAttemptUtc?: string;
    lastSuccessUtc?: string;
    lastError?: string;
    lastFailureStage?: string;
    inProgress?: boolean;
    lastMessagesSeen?: number;
    lastMessagesIngested?: number;
    outlookTagging?: string | null;
    outlookLastTaggedUtc?: string | null;
  };
};

type DriverMasterHealth = {
  status: 'healthy' | 'review' | 'attention' | string;
  activeDrivers: number;
  activeWithMember: number;
  activeWithCard: number;
  reviewRequiredDrivers: number;
  cardWarningDrivers: number;
  duplicateMemberGroups: number;
  duplicateCardGroups: number;
  latestCanonicalSyncUtc?: string;
  message: string;
};

function roadTechState(status: RoadTechStatus) {
  if (!status.configured) return { label: 'Setup incomplete', className: 'integration-state pending' };
  if (!status.connected && status.recordCount === 0) return { label: 'Configured · no live records', className: 'integration-state pending' };
  return { label: 'Connected', className: 'integration-state ready' };
}

function lastReceipt(value?: string) {
  if (!value) return 'No receipt recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB');
}

export function AdminIntegrationSyncControls() {
  const token = useAccessToken();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [state, setState] = useState<SystemState>();
  const [roadTech, setRoadTech] = useState<RoadTechStatus>();
  const [roadTechError, setRoadTechError] = useState<string>();
  const [samsara, setSamsara] = useState<SamsaraStatus>();
  const [samsaraSites, setSamsaraSites] = useState<SamsaraSiteAddressStatus>();
  const [runtimeStatus, setRuntimeStatus] = useState<IntegrationRuntimeStatus>();
  const feedHealth = useApi(useCallback(async () => intelligenceApi.freshness(await token()), [token]));
  const driverMasterHealth = useApi(useCallback(async () => request<DriverMasterHealth>('/api/v1/health/driver-master', await token()), [token]));

  const loadState = async () => {
    setRoadTechError(undefined);
    try {
      const accessToken = await token();
      const [system, tracking, samsaraStatus, samsaraSiteStatus, runtime] = await Promise.all([
        request<SystemState>('/api/v1/system-sync/state', accessToken),
        request<RoadTechStatus>('/api/v1/integrations/roadtech/status', accessToken),
        request<SamsaraStatus>('/api/v1/integrations/samsara/status', accessToken),
        request<SamsaraSiteAddressStatus>('/api/v1/integrations/samsara/sites/address-sync/status', accessToken),
        request<IntegrationRuntimeStatus>('/api/v1/integrations/status', accessToken),
      ]);
      setState(system);
      setRoadTech(tracking);
      setSamsara(samsaraStatus);
      setSamsaraSites(samsaraSiteStatus);
      setRuntimeStatus(runtime);
    } catch (error) {
      setRoadTechError(error instanceof Error ? error.message : 'RoadTech diagnostic check failed.');
    }
  };

  useEffect(() => { void loadState(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const refresh = () => { void loadState(); void feedHealth.refresh(); void driverMasterHealth.refresh(); };
    const interval = window.setInterval(refresh, 60_000);
    const onFocus = () => refresh();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [feedHealth.refresh, driverMasterHealth.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const force = async (provider: 'tacho' | 'sage' | 'fleetio' | 'all') => {
    setBusy(provider);
    setMessage(undefined);
    try {
      const accessToken = await token();
      const providers: Array<'tacho' | 'sage' | 'fleetio'> = provider === 'all' ? ['tacho', 'sage', 'fleetio'] : [provider];
      const rows: SyncResult[] = [];
      for (const item of providers) {
        try {
          rows.push(await request<SyncResult>(`/api/v1/system-sync/force/${item}`, accessToken, { method: 'POST' }, 120000));
        } catch (error) {
          rows.push({
            provider: item,
            success: false,
            completedAtUtc: new Date().toISOString(),
            message: error instanceof Error ? error.message : 'Force refresh failed.',
          });
        }
      }
      if (provider === 'all') {
        try {
          const graph = await request<{ message: string }>('/api/v1/health/intake/poll', accessToken, { method: 'POST' });
          rows.push({ provider: 'Graph mailbox', success: true, completedAtUtc: new Date().toISOString(), message: graph.message });
        } catch (error) {
          rows.push({ provider: 'Graph mailbox', success: false, completedAtUtc: new Date().toISOString(), message: error instanceof Error ? error.message : 'Graph mailbox poll could not be queued.' });
        }
      }
      setMessage(rows.map(item => `${item.provider}: ${item.message}`).join(' · '));
      await loadState();
      await feedHealth.refresh();
      await driverMasterHealth.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Force refresh failed.');
    } finally {
      setBusy(undefined);
    }
  };

  const pollGraph = async () => {
    setBusy('graph');
    setMessage(undefined);
    try {
      const result = await request<{ message: string }>('/api/v1/health/intake/poll', await token(), { method: 'POST' });
      setMessage(result.message);
      await loadState();
      await feedHealth.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Graph mailbox poll could not be queued.');
    } finally {
      setBusy(undefined);
    }
  };

  const trackingState = roadTech ? roadTechState(roadTech) : undefined;

  const syncSamsaraSiteAddresses = async () => {
    if (!samsaraSites?.eligibleSites || !window.confirm(`Synchronise ${samsaraSites.eligibleSites} eligible Master Site address${samsaraSites.eligibleSites === 1 ? '' : 's'} to Samsara? Existing addresses will be updated, not duplicated.`)) return;
    setBusy('samsara-sites');
    setMessage(undefined);
    try {
      const result = await request<{ message: string; failed: number }>('/api/v1/integrations/samsara/sites/address-sync', await token(), { method: 'POST' }, 120000);
      setMessage(result.message);
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Samsara Master Site address synchronisation failed.');
    } finally {
      setBusy(undefined);
    }
  };

  const syncSamsaraMasterData = async () => {
    if (!samsara?.connected || !window.confirm('Synchronise active SLH Sites, Vehicles and Trailers to Samsara? Existing records will be updated, not duplicated.')) return;
    setBusy('samsara-master-data');
    setMessage(undefined);
    try {
      const result = await request<{ message: string }>('/api/v1/integrations/samsara/master-data/sync', await token(), { method: 'POST' }, 180000);
      setMessage(result.message);
      await loadState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Samsara Master Data synchronisation failed.');
    } finally {
      setBusy(undefined);
    }
  };

  const graph = runtimeStatus?.infoMailboxGraph;
  const sources = feedHealth.data?.sources || [];
  const attention = sources.filter(feed => feed.state !== 'green').length;

  return <section className="ui-page system-health-page">
    <div className="ui-page-head">
      <div>
        <h1>System health</h1>
        <p>Every outside system the TMS reads from, whether it is up to date, and what it affects. Updates are automatic; refresh only if something looks stuck.</p>
      </div>
      <div className="ui-page-actions">
        <button type="button" onClick={() => { void loadState(); void feedHealth.refresh(); void driverMasterHealth.refresh(); }}>Check now</button>
        <button type="button" className="primary" onClick={() => void force('all')} disabled={Boolean(busy)}>{busy === 'all' ? 'Refreshing all…' : 'Refresh all'}</button>
      </div>
    </div>
    {message && <p className="notice inline-notice">{message}</p>}

    <section className="ui-card">
      <div className="ui-card-head"><h2>Data feeds</h2>{feedHealth.data && <span className={`ui-chip ${attention ? 'amber' : 'green'}`}>{attention ? `${attention} need attention` : 'All current'}</span>}</div>
      {feedHealth.error && <p className="ui-error">{feedHealth.error}</p>}
      <div className="ui-table-wrap"><table className="ui-table">
        <thead><tr><th>Feed</th><th>Status</th><th>Last received</th><th>Affects</th><th /></tr></thead>
        <tbody>{sources.map(feed => {
          const action = feedAction(feed.name);
          return <tr key={feed.name}>
            <td><strong>{feed.name}</strong>{feed.cadence && <><br /><small>{feed.cadence}</small></>}</td>
            <td><span className={`ui-chip ${feed.state}`}>{feed.state === 'green' ? 'Current' : feed.state === 'amber' ? 'Late' : 'Not updating'}</span>{feed.state !== 'green' && feed.detail && <><br /><small>{feed.detail}</small></>}</td>
            <td>{lastReceipt(feed.lastUpdatedUtc)}</td>
            <td><small>{action.affects}</small></td>
            <td>{action.provider ? <button type="button" onClick={() => void force(action.provider!)} disabled={Boolean(busy)}>{busy === action.provider ? 'Refreshing…' : 'Refresh'}</button>
              : action.mailbox ? <button type="button" onClick={() => void pollGraph()} disabled={Boolean(busy)}>{busy === 'graph' ? 'Checking…' : 'Check mailbox'}</button> : null}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {graph?.lastError && <p className="notice inline-notice"><strong>Mailbox:</strong> {graph.lastError}{graph.lastFailureStage ? ` (${graph.lastFailureStage})` : ''}{graph.inProgress ? ' · retrying now' : ''}</p>}
    </section>

    <div className="ui-grid">
      <article className="ui-card">
        <div className="ui-card-head"><h2>Samsara</h2><span className={`ui-chip ${samsara?.connected ? 'green' : 'amber'}`}>{samsara?.connected ? 'Connected' : samsara?.configured ? 'Check link' : 'Not set up'}</span></div>
        <p className="hint">Routes sent to drivers, and live ETAs back.{samsara?.connected ? ` ${samsara.vehicleCount} vehicles · ${samsara.driverCount} drivers visible.` : ''}</p>
        {samsara && !samsara.configured && (samsara.missingSettings ?? []).length > 0 && <p className="ui-error">Missing settings: {samsara.missingSettings.join(' · ')}</p>}
        {samsaraSites && <p className="hint">Sites: {samsaraSites.alreadyMapped} in Samsara · {samsaraSites.pending} to send · {samsaraSites.missingCoordinates} need a map location · {samsaraSites.missingAddress} need an address.</p>}
        <div className="ui-page-actions">
          <button type="button" onClick={() => void syncSamsaraMasterData()} disabled={Boolean(busy) || !samsara?.connected || !samsara.assetSyncEnabled}>{busy === 'samsara-master-data' ? 'Sending…' : 'Send sites, vehicles & trailers'}</button>
          <button type="button" onClick={() => void syncSamsaraSiteAddresses()} disabled={Boolean(busy) || !samsara?.connected || !samsaraSites?.addressSyncEnabled || !samsaraSites?.eligibleSites}>{busy === 'samsara-sites' ? 'Sending…' : `Send site addresses${samsaraSites?.eligibleSites ? ` (${samsaraSites.eligibleSites})` : ''}`}</button>
        </div>
      </article>
      <article className="ui-card">
        <div className="ui-card-head"><h2>Vehicle tracking (RoadTech / DOT)</h2>{trackingState && <span className={`ui-chip ${trackingState.className.includes('ready') ? 'green' : 'amber'}`}>{trackingState.label}</span>}</div>
        {roadTech ? <p className="hint">{roadTech.connected ? `${roadTech.recordCount} vehicles reporting${roadTech.latestEventUtc ? `, latest ${new Date(roadTech.latestEventUtc).toLocaleString('en-GB')}` : ''}.` : roadTech.message}</p> : !roadTechError && <p className="hint">Checking…</p>}
        {roadTech && !roadTech.configured && (roadTech.missingSettings ?? []).length > 0 && <p className="ui-error">Missing settings: {roadTech.missingSettings.join(' · ')}</p>}
        {roadTechError && <p className="ui-error">{roadTechError}</p>}
      </article>
      <article className="ui-card">
        <div className="ui-card-head"><h2>Info mailbox</h2><span className={`ui-chip ${graph?.lastSuccessUtc ? 'green' : 'amber'}`}>{graph?.lastSuccessUtc ? 'Reading' : graph?.configured ? 'Waiting for first read' : 'Not set up'}</span></div>
        {graph?.outlookTagging ? <p className="ui-error">{graph.outlookTagging}</p> : <p className="hint">Outlook tags: each email in info@ gets a category: <strong style={{ color: '#1d7a3a' }}>TMS: orders in</strong>, <strong style={{ color: '#b42318' }}>TMS: needs attention</strong> or <strong>TMS: no orders</strong>.{graph?.outlookLastTaggedUtc ? ` Last tagged ${lastReceipt(graph.outlookLastTaggedUtc)}.` : ''}</p>}
        <p className="hint">{graph?.mailbox || 'info@'}: read every few minutes.{graph?.lastSuccessUtc ? ` Last read ${lastReceipt(graph.lastSuccessUtc)}, ${graph.lastMessagesSeen ?? 0} seen, ${graph.lastMessagesIngested ?? 0} new.` : ''}</p>
      </article>
      <article className="ui-card">
        <div className="ui-card-head"><h2>Driver Master identity</h2>{driverMasterHealth.data && <span className={`ui-chip ${driverMasterHealth.data.status === 'healthy' ? 'green' : driverMasterHealth.data.status === 'attention' ? 'amber' : ''}`}>{driverMasterHealth.data.status === 'healthy' ? 'Clear' : driverMasterHealth.data.status === 'attention' ? 'Needs attention' : 'Review'}</span>}</div>
        {driverMasterHealth.error && <p className="ui-error">{driverMasterHealth.error}</p>}
        {driverMasterHealth.data ? <>
          <p className="hint">{driverMasterHealth.data.message}</p>
          <p className="hint">{driverMasterHealth.data.activeDrivers} active drivers · {driverMasterHealth.data.activeWithMember} matched to a Tacho member · {driverMasterHealth.data.activeWithCard} with card evidence.</p>
          {(driverMasterHealth.data.duplicateMemberGroups > 0 || driverMasterHealth.data.duplicateCardGroups > 0) && <p className="ui-error">Duplicate Tacho identity: {driverMasterHealth.data.duplicateMemberGroups} member match group{driverMasterHealth.data.duplicateMemberGroups === 1 ? '' : 's'}, {driverMasterHealth.data.duplicateCardGroups} card group{driverMasterHealth.data.duplicateCardGroups === 1 ? '' : 's'}.</p>}
        </> : !driverMasterHealth.loading && <p className="hint">Checking…</p>}
      </article>
    </div>
    <SamsaraReconcile />
    <SlowEndpoints />
    <SageCalendarLink />
    <PlanningWipe />
    {state && <p className="hint">Platform {state.status}{state.lastPlatformUpdateUtc ? ` · last update ${new Date(state.lastPlatformUpdateUtc).toLocaleString('en-GB')}` : ''}. Automatic: TachoMaster every 20 minutes · Sage HR 05:00 and 14:00 · Fleetio hourly · tracking continuous.</p>}
  </section>;
}

function feedAction(name: string): { affects: string; provider?: 'tacho' | 'sage' | 'fleetio'; mailbox?: boolean } {
  const key = name.toLowerCase();
  if (key.includes('tacho')) return { affects: 'Driver hours, weekly rest and Day x of y on Dispatch', provider: 'tacho' };
  if (key.includes('sage')) return { affects: 'Leave on Drivers and Dispatch', provider: 'sage' };
  if (key.includes('fleetio')) return { affects: 'Walkround checks and vehicles off road', provider: 'fleetio' };
  if (key.includes('mail')) return { affects: 'Orders from info@ into Orders', mailbox: true };
  if (key.includes('samsara')) return { affects: 'Routes to drivers and live ETAs' };
  if (key.includes('dot') || key.includes('falcon') || key.includes('roadtech') || key.includes('track')) return { affects: 'Live vehicle positions and first movement for Vehicle checks' };
  return { affects: '' };
}
