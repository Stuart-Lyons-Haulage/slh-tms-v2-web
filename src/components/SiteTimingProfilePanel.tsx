import { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type SiteCutoffTiming = {
  siteId?: string;
  siteName?: string;
  matchedLiveSite?: boolean;
  plan?: string;
  temperature?: string;
  palletType?: string;
  standardCutoff?: string;
  extendedCutoff?: string;
  cutoffCheck?: string;
  fallbackCutoff?: string;
  lastDespatch?: string;
  collectFrom?: string;
  collectTo?: string;
  depotDeadline?: string;
  latestCollectionTime?: string;
  wallBoardDeadline?: string;
  firstGeofenceResetsLiveEtos?: boolean;
  source?: string;
  reviewedAtUtc?: string;
};

type SiteRouteTiming = {
  routeCombination: string;
  collectionContext?: string;
  collectionKey?: string;
  deliveryKey?: string;
  palletType?: string;
  lastDespatch?: string;
  collectFrom?: string;
  collectTo?: string;
  depotDeadline?: string;
  latestCollectionTime?: string;
  firstGeofenceResetsLiveEtos?: boolean;
  source?: string;
  reviewedAtUtc?: string;
};

type SiteTimingProfile = {
  siteId: string;
  externalCode: string;
  name: string;
  aliases?: string;
  latestCollectionTime?: string;
  wallBoardDeadline?: string;
  firstGeofenceResetsLiveEtos: boolean;
  cutoffs: SiteCutoffTiming[];
  routeTimings: SiteRouteTiming[];
};

function fmt(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function fmtTime(value?: string) {
  if (!value) return '—';
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function isoDate(value?: string) {
  return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

export function SiteTimingProfilePanel({ siteId }: { siteId: string }) {
  const token = useAccessToken();
  const [profile, setProfile] = useState<SiteTimingProfile>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError(undefined);
    try {
      const access = await token();
      setProfile(await request<SiteTimingProfile>(`/api/v1/sites/${siteId}/timing-profile`, access, { cache: 'no-store' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load site timing profile.');
    } finally {
      setLoading(false);
    }
  }, [siteId, token]);

  useEffect(() => { void load(); }, [load]);

  const hasCutoffs = Boolean(profile?.cutoffs?.length);
  const hasRoutes = Boolean(profile?.routeTimings?.length);

  return <section>
    <div className="title-row">
      <div>
        <h3>Site timings & dispatch rules</h3>
        <p className="hint">Single source for cut-offs, latest collection, route timings and wall-board risk before live geofence ETO takes over.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh timings'}</button>
    </div>

    {error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}
    {loading && !profile && <p className="hint">Loading timing profile…</p>}

    {profile && <>
      <div className="crm-form-grid">
        <p><strong>Latest collection:</strong><br />{fmtTime(profile.latestCollectionTime)}</p>
        <p><strong>Wall-board deadline:</strong><br />{fmtTime(profile.wallBoardDeadline)}</p>
        <p><strong>Live ETO trigger:</strong><br />{profile.firstGeofenceResetsLiveEtos ? 'First geofence hit' : 'Manual / not set'}</p>
      </div>

      <p className="hint">Dispatch may set an earlier planned start. Until the first geofence event is received, the wall board should use latest collection time as the at-risk point.</p>

      {hasCutoffs ? <div style={{ overflowX: 'auto' }}>
        <h4>Cut-offs</h4>
        <table>
          <thead><tr><th>Plan</th><th>Pallet</th><th>Cut-off</th><th>Collect</th><th>Latest collection</th><th>Depot deadline</th></tr></thead>
          <tbody>{profile.cutoffs.map((item, index) => <tr key={`${item.siteId || profile.siteId}-cutoff-${index}`}>
            <td>{fmt(item.plan || item.temperature)}</td>
            <td>{fmt(item.palletType)}</td>
            <td>{fmtTime(item.standardCutoff || item.cutoffCheck || item.fallbackCutoff)}</td>
            <td>{fmtTime(item.collectFrom)} – {fmtTime(item.collectTo)}</td>
            <td><strong>{fmtTime(item.latestCollectionTime || item.wallBoardDeadline)}</strong></td>
            <td>{fmtTime(item.depotDeadline)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="hint">No site cut-off records are linked yet. Re-run the master workbook import after duplicate review if timings should exist for this site.</p>}

      {hasRoutes && <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <h4>Route timings</h4>
        <table>
          <thead><tr><th>Route</th><th>Pallet</th><th>Last despatch</th><th>Collect</th><th>Latest collection</th><th>Depot deadline</th></tr></thead>
          <tbody>{profile.routeTimings.slice(0, 30).map((item, index) => <tr key={`${item.routeCombination}-${item.palletType || 'any'}-${index}`}>
            <td>{fmt(item.routeCombination)}</td>
            <td>{fmt(item.palletType)}</td>
            <td>{fmtTime(item.lastDespatch)}</td>
            <td>{fmtTime(item.collectFrom)} – {fmtTime(item.collectTo)}</td>
            <td><strong>{fmtTime(item.latestCollectionTime)}</strong></td>
            <td>{fmtTime(item.depotDeadline)}</td>
          </tr>)}</tbody>
        </table>
        {profile.routeTimings.length > 30 && <p className="hint">Showing first 30 route timing rules. Use aliases/route filters later if this grows further.</p>}
      </div>}
    </>}
  </section>;
}
