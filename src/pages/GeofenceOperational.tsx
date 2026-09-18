import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type Fence = {
  id: string;
  name: string;
  category?: string;
  categoryMaxWaitMinutes?: number;
  maxWaitMinutes?: number;
  pendingEntryMinutes: number;
  pendingExitMinutes: number;
  siteNumber?: string;
  siteId?: string;
  siteName?: string;
  siteCode?: string;
  manualOverride?: boolean;
  locationOnly?: boolean;
  polygonJson: string;
  active: boolean;
  polygonValid: boolean;
  geofenceAvailable: boolean;
  siteLinked: boolean;
  validationStatus: string;
};

type SiteOption = { siteId: string; siteCode: string; siteName: string; linkedGeofences: string[]; geofenceLinked: boolean; needsReview: boolean };
type Hit = { geofenceName: string; vehicleIdentifier: string; enteredAtUtc: string; confirmedAtUtc?: string; exitedAtUtc?: string; loadId?: string; loadStopId?: string; dwellMinutes: number; status: string; statusReason?: string };
type Integrity = {
  checkedAtUtc: string;
  engineReady: boolean;
  planningLinkReady: boolean;
  liveRunProgressionReady: boolean;
  trackingFresh: boolean;
  trackingAgeMinutes?: number;
  geofences: { total: number; active: number; valid: number; linked: number; unlinked: number; invalid: number };
  records: Fence[];
  latestTracking?: { vehicleIdentifier: string; eventTimeUtc: string; latitude: number; longitude: number; providerName: string };
  latestGeofenceHit?: Hit;
  latestConfirmedHit?: Hit;
  recentHits: Hit[];
};

const dt = (value?: string) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const text = (value: unknown) => value == null || value === '' ? '—' : String(value);

export function GeofenceOperational() {
  const token = useAccessToken();
  const [data, setData] = useState<Integrity>();
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selected, setSelected] = useState<Fence>();
  const [draft, setDraft] = useState<Partial<Fence>>({});

  const lastGoodSites = useRef<SiteOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const access = await token();
      const [integrity, siteOptions] = await Promise.all([
        request<Integrity>('/api/v1/geofence-integrity', access),
        request<SiteOption[]>('/api/v1/site-geofence-sync/sites', access).then(rows => { lastGoodSites.current = rows; return rows; }).catch(() => lastGoodSites.current),
      ]);
      setData(integrity);
      setSites(siteOptions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Geofence integrity could not be loaded.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refreshIfVisible = () => { if (document.visibilityState === 'visible') void load(); };
    const interval = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refreshIfVisible); document.removeEventListener('visibilitychange', refreshIfVisible); };
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.records || []).filter(row => (includeArchived || row.active) && (!q || [row.name, row.siteNumber, row.siteCode, row.siteName, row.category, row.validationStatus].some(value => String(value || '').toLowerCase().includes(q))));
  }, [data, includeArchived, query]);

  async function changeLinkedSite(siteCode: string) {
    if (!selected) return;
    const option = sites.find(site => site.siteCode === siteCode);
    setDraft(current => ({
      ...current,
      siteNumber: siteCode,
      siteCode,
      siteId: option?.siteId,
      siteName: option?.siteName,
      locationOnly: false,
    }));
    if (!siteCode) return;

    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const result = await request<SiteOption>(`/api/v1/site-geofence-sync/geofences/${selected.id}/link`, await token(), {
        method: 'POST',
        body: JSON.stringify({ siteCode }),
      });
      setSelected(current => current ? {
        ...current,
        siteNumber: result.siteCode,
        siteCode: result.siteCode,
        siteId: result.siteId,
        siteName: result.siteName,
        siteLinked: true,
        manualOverride: true,
        locationOnly: false,
      } : current);
      setDraft(current => ({
        ...current,
        siteNumber: result.siteCode,
        siteCode: result.siteCode,
        siteId: result.siteId,
        siteName: result.siteName,
        locationOnly: false,
      }));
      setNotice(`Geofence Site link saved: ${result.siteCode} · ${result.siteName}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Site link could not be saved.'); }
    finally { setSaving(false); }
  }

  async function save() {
    if (!selected) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      await request(`/api/v1/operational-master-data/geofences/${selected.id}`, await token(), {
        method: 'PUT',
        body: JSON.stringify({
          name: draft.name,
          category: draft.category,
          categoryMaxWaitMinutes: draft.categoryMaxWaitMinutes ?? null,
          maxWaitMinutes: draft.maxWaitMinutes ?? null,
          pendingEntryMinutes: Number(draft.pendingEntryMinutes || 0),
          pendingExitMinutes: Number(draft.pendingExitMinutes || 0),
          siteNumber: draft.locationOnly ? undefined : draft.siteCode || draft.siteNumber || selected.siteCode || selected.siteNumber,
          siteId: draft.locationOnly ? null : draft.siteId || selected.siteId || null,
          locationOnly: Boolean(draft.locationOnly),
          polygonJson: draft.polygonJson,
        }),
      });
      setSelected(undefined); setNotice('Geofence details updated and the saved Site link was retained.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Geofence update failed.'); }
    finally { setSaving(false); }
  }

  async function syncSite(locationOnly = false) {
    if (!selected) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      if (locationOnly) {
        const result = await request<{ locationOnly?: boolean }>(`/api/v1/operational-master-data/geofences/${selected.id}/sync-site`, await token(), {
          method: 'POST',
          body: JSON.stringify({ name: draft.name || selected.name, siteId: null, locationOnly: true, polygonJson: draft.polygonJson || selected.polygonJson }),
        });
        setNotice(result.locationOnly ? 'Geofence marked as location only.' : 'Location-only update completed.');
      } else {
        const siteCode = String(draft.siteNumber || draft.siteCode || '').trim();
        if (!siteCode) throw new Error('Choose a canonical SITE### record before saving this geofence link.');
        const result = await request<SiteOption>(`/api/v1/site-geofence-sync/geofences/${selected.id}/link`, await token(), {
          method: 'POST',
          body: JSON.stringify({ siteCode }),
        });
        setNotice(`Geofence Site link re-saved: ${result.siteCode} · ${result.siteName}.`);
      }
      setSelected(undefined);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Site sync failed.'); }
    finally { setSaving(false); }
  }

  async function setActive(row: Fence, active: boolean) {
    if (!window.confirm(`${active ? 'Restore' : 'Archive'} geofence “${row.name}”?`)) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      await request(`/api/v1/master-data-cleanup/geofences/${row.id}/${active ? 'restore' : 'archive'}`, await token(), { method: 'POST' });
      setNotice(`Geofence ${active ? 'restored' : 'archived'}.`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Archive/restore failed.'); }
    finally { setSaving(false); }
  }

  async function deleteFence(row: Fence) {
    if (row.active) { setError('Archive this geofence before deleting it.'); return; }
    if (!window.confirm(`Permanently delete geofence “${row.name}”? The TMS will block this if visit history exists.`)) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      await request(`/api/v1/master-data-cleanup/geofences/${row.id}`, await token(), { method: 'DELETE' });
      setNotice('Unused duplicate geofence deleted.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed.'); }
    finally { setSaving(false); }
  }

  async function syncAllSites() {
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const result = await request<{ sitesCoded: number; geofencesLinked: number; geofencesUnlinked: number; sitesMissingGeofence: number }>('/api/v1/site-geofence-sync/sync-sites', await token(), { method: 'POST' });
      setNotice(`Sites synced: ${result.sitesCoded} code(s) canonicalised, ${result.geofencesLinked} geofence(s) linked, ${result.geofencesUnlinked} stale link(s) removed, ${result.sitesMissingGeofence} site(s) need review.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Site/geofence sync failed.'); }
    finally { setSaving(false); }
  }

  async function reloadSeed() {
    if (!window.confirm('Reload the 53 SLH Falcon geofences supplied on 17 August? Existing matching geofences will be updated, not duplicated.')) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const result = await request<{ supplied: number; inserted: number; updated: number; siteMatched: number }>('/api/v1/geofences/import-slh-seed', await token(), { method: 'POST' });
      setNotice(`${result.supplied} SLH geofences checked: ${result.inserted} inserted, ${result.updated} updated, ${result.siteMatched} site matches.`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'SLH geofence reload failed.'); }
    finally { setSaving(false); }
  }

  const latest = data?.latestGeofenceHit;
  const confirmed = data?.latestConfirmedHit;

  return <section>
    <div className="title-row">
      <div><p className="eyebrow">RoadTech → geofence → Live Runs</p><h2>Geofence integrity</h2><p className="hint">Geofence-to-Site links use canonical SITE### records. Choosing a Linked Site saves that relationship immediately.</p></div>
      <div className="title-actions"><button onClick={() => void load()} disabled={loading}>Refresh status</button><button className="primary" onClick={() => void syncAllSites()} disabled={saving}>{saving ? 'Syncing…' : 'Sync Sites'}</button><button onClick={() => void reloadSeed()} disabled={saving}>Reload SLH geofences</button></div>
    </div>

    {error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}
    {notice && <p className="notice">{notice}</p>}
    {data && !data.liveRunProgressionReady && <p className="notice" style={{ borderColor: '#b42318' }}><strong>Live-run geofence progression is not fully ready.</strong> Engine: {data.engineReady ? 'ready' : 'not ready'} · site links: {data.planningLinkReady ? 'ready' : 'not ready'} · RoadTech: {data.trackingFresh ? 'fresh' : 'stale/unavailable'}.</p>}

    {data && <>
      <div className="metrics" style={{ marginBottom: 16 }}>
        <article className="metric"><span>Live-run progression</span><strong>{data.liveRunProgressionReady ? 'READY' : 'CHECK'}</strong><small>engine + links + fresh tracking</small></article>
        <article className="metric"><span>Active / valid</span><strong>{data.geofences.active} / {data.geofences.valid}</strong><small>{data.geofences.invalid} invalid polygon(s)</small></article>
        <article className="metric"><span>Linked to Sites</span><strong>{data.geofences.linked}</strong><small>{data.geofences.unlinked} valid but unlinked</small></article>
        <article className="metric"><span>RoadTech age</span><strong>{data.trackingAgeMinutes == null ? '—' : `${Math.round(data.trackingAgeMinutes)}m`}</strong><small>{data.latestTracking ? `${data.latestTracking.vehicleIdentifier} · ${dt(data.latestTracking.eventTimeUtc)}` : 'No tracking event'}</small></article>
      </div>
      <div className="panel" style={{ marginBottom: 16 }}><div className="title-row"><div><p className="eyebrow">Actual progression evidence</p><h3>Latest geofence hits</h3></div></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}><article><strong>Latest entry / visit</strong>{latest ? <p>{latest.geofenceName}<br/><small>{latest.vehicleIdentifier} · {dt(latest.enteredAtUtc)} · {latest.status}<br/>Run {latest.loadId || 'not linked'} · stop {latest.loadStopId || 'not linked'}</small></p> : <p className="hint">No geofence hit has been recorded yet.</p>}</article><article><strong>Latest confirmed dwell hit</strong>{confirmed ? <p>{confirmed.geofenceName}<br/><small>{confirmed.vehicleIdentifier} · confirmed {dt(confirmed.confirmedAtUtc)} · {confirmed.dwellMinutes} min<br/>Run {confirmed.loadId || 'not linked'} · stop {confirmed.loadStopId || 'not linked'}</small></p> : <p className="hint">No confirmed dwell hit has been recorded yet.</p>}</article></div></div>
    </>}

    {selected && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit geofence Master Data" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setSelected(undefined); }}>
      <div className="crm-modal">
        <div className="crm-modal-header"><div><p className="eyebrow">Geofence Master Data record</p><h2>{selected.name}</h2><p className="hint">Geofence execution evidence remains linked to the canonical Site Master. Changing the Linked Site saves that relationship immediately.</p></div><button type="button" disabled={saving} onClick={() => setSelected(undefined)}>Close</button></div>
        <div className="crm-modal-body">
          <section><h3>Geofence identity & Site link</h3><div className="crm-form-grid">
            <label>Name<input value={String(draft.name || '')} onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}/></label>
            <label>Linked Site<select disabled={saving || Boolean(draft.locationOnly)} value={String(draft.siteNumber || draft.siteCode || '')} onChange={e => void changeLinkedSite(e.target.value)}><option value="">Choose SITE###…</option>{sites.map(site => <option key={site.siteId} value={site.siteCode}>{site.siteCode} · {site.siteName}</option>)}</select></label>
            <label>Category<input value={String(draft.category || '')} onChange={e => setDraft(v => ({ ...v, category: e.target.value }))}/></label>
            <label>Category max wait (min)<input type="number" value={String(draft.categoryMaxWaitMinutes ?? '')} onChange={e => setDraft(v => ({ ...v, categoryMaxWaitMinutes: e.target.value === '' ? undefined : Number(e.target.value) }))}/></label>
            <label>Entry confirm (min)<input type="number" value={String(draft.pendingEntryMinutes ?? 0)} onChange={e => setDraft(v => ({ ...v, pendingEntryMinutes: Number(e.target.value) }))}/></label>
            <label>Exit confirm (min)<input type="number" value={String(draft.pendingExitMinutes ?? 0)} onChange={e => setDraft(v => ({ ...v, pendingExitMinutes: Number(e.target.value) }))}/></label>
            <label>Max wait (min)<input type="number" value={String(draft.maxWaitMinutes ?? '')} onChange={e => setDraft(v => ({ ...v, maxWaitMinutes: e.target.value === '' ? undefined : Number(e.target.value) }))}/></label>
            <label style={{ gridColumn: '1 / -1' }}>Polygon JSON<textarea rows={6} value={String(draft.polygonJson || '')} onChange={e => setDraft(v => ({ ...v, polygonJson: e.target.value }))}/></label>
          </div></section>
          <section>
            <div className="notice"><strong>Current registered Site:</strong> {draft.locationOnly ? 'Location only' : draft.siteName ? `${draft.siteCode || draft.siteNumber || 'Code pending'} · ${draft.siteName}` : draft.siteNumber ? `${draft.siteNumber} selected` : 'No Site link'}</div>
            <p className="hint">The Linked Site dropdown autosaves to Site Master immediately. Saving geofence details preserves the selected Site relationship.</p>
            <label className="check-label"><input type="checkbox" checked={Boolean(draft.locationOnly)} onChange={e => setDraft(v => ({ ...v, locationOnly: e.target.checked, siteNumber: e.target.checked ? '' : v.siteNumber, siteCode: e.target.checked ? '' : v.siteCode }))}/> Location only / do not link to a Site</label>
          </section>
        </div>
        <div className="crm-modal-actions"><button className="primary" disabled={saving} onClick={() => void save()}>Save Master Data record</button><button disabled={saving || Boolean(draft.locationOnly) || !String(draft.siteCode || draft.siteNumber || '').trim()} onClick={() => void syncSite(false)}>Re-save Site link</button><button disabled={saving} onClick={() => void syncSite(true)}>Mark location only</button><button disabled={saving} onClick={() => setSelected(undefined)}>Cancel</button></div>
      </div>
    </div>}

    <div className="panel">
      <div className="title-row"><div><h3>Geofences</h3><small>{rows.length} shown</small></div><div className="title-actions"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search geofence, Site or category…"/><label className="check-label"><input type="checkbox" checked={includeArchived} onChange={e => setIncludeArchived(e.target.checked)}/> Include archived</label></div></div>
      {loading && !data ? <div className="state">Loading geofence data…</div> : <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Geofence</th><th>Site code</th><th>Linked site</th><th>Category</th><th>Polygon</th><th>Site link</th><th>Entry confirm</th><th>Max wait</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.locationOnly ? 'Location only' : text(row.siteCode || row.siteNumber)}</td><td>{text(row.siteName)}</td><td>{text(row.category)}</td><td>{row.polygonValid ? 'Valid' : 'Invalid'}</td><td>{row.locationOnly ? 'Location only' : row.siteLinked ? row.manualOverride ? 'Manual' : 'Linked' : 'Unlinked'}</td><td>{row.pendingEntryMinutes} min</td><td>{row.maxWaitMinutes == null ? '—' : `${row.maxWaitMinutes} min`}</td><td>{row.active ? row.validationStatus : 'Archived'}</td><td style={{ whiteSpace: 'nowrap' }}><button onClick={() => { setSelected(row); setDraft({ ...row, siteNumber: row.siteCode || row.siteNumber || '' }); }}>Edit</button>{' '}<button disabled={saving} onClick={() => void setActive(row, !row.active)}>{row.active ? 'Archive' : 'Restore'}</button>{!row.active && <>{' '}<button disabled={saving} onClick={() => void deleteFence(row)} style={{ borderColor: '#b42318', color: '#b42318' }}>Delete</button></>}</td></tr>)}</tbody></table>{!rows.length && <div className="state">No geofences match this filter.</div>}</div>}
    </div>
  </section>;
}