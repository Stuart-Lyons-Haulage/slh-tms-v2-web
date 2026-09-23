import { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { intelligenceApi } from '../lib/intelligenceApi';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';

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
  const feedHealth = useApi(useCallback(async () => intelligenceApi.freshness(await token()), [token]));

  const loadState = async () => {
    setRoadTechError(undefined);
    try {
      const accessToken = await token();
      const [system, tracking] = await Promise.all([
        request<SystemState>('/api/v1/system-sync/state', accessToken),
        request<RoadTechStatus>('/api/v1/integrations/roadtech/status', accessToken),
      ]);
      setState(system);
      setRoadTech(tracking);
    } catch (error) {
      setRoadTechError(error instanceof Error ? error.message : 'RoadTech diagnostic check failed.');
    }
  };

  useEffect(() => { void loadState(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const refresh = () => { void loadState(); void feedHealth.refresh(); };
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
  }, [feedHealth.refresh]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setMessage(rows.map(item => `${item.provider}: ${item.message}`).join(' · '));
      await loadState();
      await feedHealth.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Force refresh failed.');
    } finally {
      setBusy(undefined);
    }
  };

  const trackingState = roadTech ? roadTechState(roadTech) : undefined;

  return <section className="panel" style={{ marginBottom: 18 }}>
    <div className="title-row">
      <div>
        <p className="eyebrow">Admin recovery only</p>
        <h2>Integration synchronisation</h2>
        <p className="hint">Normal updates are automatic. Receipt health below is the same source used by Dashboard, so a provider cannot be green here while red there because of a different timeout rule.</p>
      </div>
      <button onClick={() => { void loadState(); void feedHealth.refresh(); }}>Check system state</button>
    </div>

    <div className="admin-card" style={{ marginBottom: 14 }}>
      <div className="title-row" style={{ marginBottom: 8 }}>
        <div>
          <p className="eyebrow">Authoritative receipt health</p>
          <h3>Are the links delivering data?</h3>
        </div>
        {feedHealth.data?.generatedAtUtc && <small>Checked {new Date(feedHealth.data.generatedAtUtc).toLocaleTimeString('en-GB')}</small>}
      </div>
      {feedHealth.error && <p className="notice inline-notice">Feed receipt health could not refresh: {feedHealth.error}</p>}
      <div className="admin-grid">
        {feedHealth.data?.sources.map((feed) => <article className="admin-card" key={feed.name}>
          <span className={`integration-state ${feed.state === 'green' ? 'ready' : 'pending'}`}>{feed.state === 'green' ? 'Current' : feed.state === 'amber' ? 'Check' : 'Attention'}</span>
          <h3>{feed.name}</h3>
          <p>{feed.detail}</p>
          <small>Last receipt: {lastReceipt(feed.lastUpdatedUtc)}{feed.cadence ? ` · ${feed.cadence}` : ''}</small>
        </article>)}
      </div>
    </div>

    <div className="admin-card" style={{ marginBottom: 14 }}>
      <div className="title-row" style={{ marginBottom: 8 }}>
        <div>
          <p className="eyebrow">RoadTech / DOT diagnostics</p>
          <h3>Tracking runtime status</h3>
        </div>
        {trackingState && <span className={trackingState.className}>{trackingState.label}</span>}
      </div>
      {!roadTech && !roadTechError && <p className="hint">Checking RoadTech runtime settings and live connectivity…</p>}
      {roadTech && <>
        <p>{roadTech.message}</p>
        {!roadTech.configured && roadTech.missingSettings.length > 0 && <div className="notice inline-notice"><strong>Specific settings to amend:</strong> {roadTech.missingSettings.join(' · ')}</div>}
        {roadTech.configured && !roadTech.connected && <div className="notice inline-notice"><strong>Configuration is present.</strong> RoadTech is not currently returning live vehicle records. This is a connectivity/credentials/provider-data issue rather than missing setup.</div>}
        {roadTech.connected && <p className="hint"><strong>{roadTech.recordCount}</strong> live RoadTech vehicle record{roadTech.recordCount === 1 ? '' : 's'} returned{roadTech.latestEventUtc ? ` · latest event ${new Date(roadTech.latestEventUtc).toLocaleString('en-GB')}` : ''}.</p>}
      </>}
      {roadTechError && <p className="notice inline-notice"><strong>Diagnostic request failed:</strong> {roadTechError}</p>}
    </div>

    <div className="actions" style={{ flexWrap: 'wrap' }}>
      <button onClick={() => void force('tacho')} disabled={Boolean(busy)}>{busy === 'tacho' ? 'Refreshing…' : 'Force TachoMaster'}</button>
      <button onClick={() => void force('sage')} disabled={Boolean(busy)}>{busy === 'sage' ? 'Refreshing…' : 'Force Sage HR'}</button>
      <button onClick={() => void force('fleetio')} disabled={Boolean(busy)}>{busy === 'fleetio' ? 'Refreshing…' : 'Force Fleetio'}</button>
      <button className="primary" onClick={() => void force('all')} disabled={Boolean(busy)}>{busy === 'all' ? 'Refreshing all…' : 'Force refresh all systems'}</button>
    </div>
    <p className="hint">Automatic cadence: TachoMaster every 5 minutes · Sage HR 05:30 UK daily · Fleetio hourly · DOT/Falcon continuous. Status refreshes on screen every 60 seconds.</p>
    {state && <p className="hint">Platform state: <strong>{state.status}</strong>{state.lastPlatformUpdateUtc ? ` · last update ${new Date(state.lastPlatformUpdateUtc).toLocaleString('en-GB')}` : ''}</p>}
    {message && <p className="notice inline-notice">{message}</p>}
  </section>;
}
