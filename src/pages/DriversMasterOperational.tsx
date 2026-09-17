import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, request, type Driver } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type DriverRecord = Driver & {
  cpcExpiry?: string;
  digitalTachoCardExpiry?: string;
  medicalExpiry?: string;
};

type DriverMasterHealth = {
  status: 'healthy' | 'review' | 'attention';
  activeDrivers: number;
  activeWithMember: number;
  activeWithCard: number;
  reviewRequiredDrivers: number;
  cardWarningDrivers: number;
  duplicateMemberGroups: number;
  duplicateCardGroups: number;
  latestCanonicalSyncUtc?: string;
  message?: string;
};

type TachoState = 'Linked' | 'Review' | 'No Card' | 'Stale';

type EditState = {
  employeeNumber: string;
  displayName: string;
  tachoName: string;
  tachoMasterDriverId: string;
  tachoCardNumber: string;
  mobileNumber: string;
  driverType: string;
  driverGroup: string;
  skills: string;
  coding: string;
  agencyName: string;
  northEligible: boolean;
  preloadEligible: boolean;
  notes: string;
  drivingLicenceNumber: string;
  licenceExpiry: string;
  cpcExpiry: string;
  digitalTachoCardExpiry: string;
  medicalExpiry: string;
  licenceStatus: string;
  active: boolean;
};

function tachoState(driver: DriverRecord, now = Date.now()): TachoState {
  if (!driver.tachoMasterDriverId?.trim()) return 'Review';
  if (!driver.tachoCardNumber?.trim()) return 'No Card';
  if (!driver.lastTachoSyncUtc) return 'Stale';
  const last = Date.parse(driver.lastTachoSyncUtc);
  if (!Number.isFinite(last) || now - last > 12 * 60 * 60 * 1000) return 'Stale';
  return 'Linked';
}

function toEdit(driver: DriverRecord): EditState {
  return {
    employeeNumber: driver.employeeNumber || '',
    displayName: driver.displayName || '',
    tachoName: driver.tachoName || '',
    tachoMasterDriverId: driver.tachoMasterDriverId || '',
    tachoCardNumber: driver.tachoCardNumber || '',
    mobileNumber: driver.mobileNumber || '',
    driverType: driver.driverType || '',
    driverGroup: driver.driverGroup || '',
    skills: driver.skills || '',
    coding: driver.coding || '',
    agencyName: driver.agencyName || '',
    northEligible: driver.northEligible ?? false,
    preloadEligible: driver.preloadEligible ?? false,
    notes: driver.notes || '',
    drivingLicenceNumber: driver.drivingLicenceNumber || '',
    licenceExpiry: driver.licenceExpiry || '',
    cpcExpiry: driver.cpcExpiry || '',
    digitalTachoCardExpiry: driver.digitalTachoCardExpiry || '',
    medicalExpiry: driver.medicalExpiry || '',
    licenceStatus: driver.licenceStatus || '',
    active: driver.active,
  };
}

function nullable(value: string) {
  const clean = value.trim();
  return clean || null;
}

function formatDateTime(value?: string) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB');
}

function statusStyle(status: TachoState): React.CSSProperties {
  if (status === 'Linked') return { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' };
  if (status === 'Stale') return { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' };
  return { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' };
}

export function DriversMasterOperational() {
  const token = useAccessToken();
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [health, setHealth] = useState<DriverMasterHealth>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [editing, setEditing] = useState<DriverRecord>();
  const [form, setForm] = useState<EditState>();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const access = await token();
      const [rows, status] = await Promise.all([
        api.drivers(access),
        request<DriverMasterHealth>('/api/v1/health/driver-master', access),
      ]);
      setDrivers(rows as DriverRecord[]);
      setHealth(status);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Driver Master could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return drivers
      .filter(driver => !reviewOnly || tachoState(driver) !== 'Linked')
      .filter(driver => !needle || [
        driver.displayName,
        driver.employeeNumber,
        driver.tachoName,
        driver.tachoMasterDriverId,
        driver.tachoCardNumber,
        driver.drivingLicenceNumber,
        driver.driverGroup,
      ].some(value => (value || '').toLowerCase().includes(needle)))
      .sort((a, b) => {
        const rank = (driver: DriverRecord) => tachoState(driver) === 'Linked' ? 1 : 0;
        return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
      });
  }, [drivers, reviewOnly, search]);

  function openEdit(driver: DriverRecord) {
    setEditing(driver);
    setForm(toEdit(driver));
    setNotice(undefined);
  }

  function setField<K extends keyof EditState>(field: K, value: EditState[K]) {
    setForm(current => current ? { ...current, [field]: value } : current);
  }

  async function save() {
    if (!editing || !form) return;
    setSaving(true);
    setNotice(undefined);
    try {
      const payload = {
        employeeNumber: nullable(form.employeeNumber),
        displayName: nullable(form.displayName),
        tachoName: nullable(form.tachoName),
        tachoMasterDriverId: nullable(form.tachoMasterDriverId),
        tachoCardNumber: nullable(form.tachoCardNumber),
        mobileNumber: nullable(form.mobileNumber),
        driverType: nullable(form.driverType),
        driverGroup: nullable(form.driverGroup),
        skills: nullable(form.skills),
        coding: nullable(form.coding),
        agencyName: nullable(form.agencyName),
        northEligible: form.northEligible,
        preloadEligible: form.preloadEligible,
        notes: nullable(form.notes),
        drivingLicenceNumber: nullable(form.drivingLicenceNumber),
        licenceExpiry: nullable(form.licenceExpiry),
        cpcExpiry: nullable(form.cpcExpiry),
        digitalTachoCardExpiry: nullable(form.digitalTachoCardExpiry),
        medicalExpiry: nullable(form.medicalExpiry),
        licenceStatus: nullable(form.licenceStatus),
        active: form.active,
      };
      await request(`/api/v1/driver-master/${editing.id}/manual-details`, await token(), {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setNotice('Driver Master details saved. Manual Tacho identity will be used by the next reconciliation.');
      setEditing(undefined);
      setForm(undefined);
      await refresh();
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : 'Driver details could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function syncTacho() {
    setSyncing(true);
    setNotice(undefined);
    try {
      const result = await request<{ message?: string }>('/api/v1/driver-master/tachomaster/sync', await token(), { method: 'POST' }, 15000);
      setNotice(result.message || 'TachoMaster enrichment queued. Driver Master rows remain live while identities are refreshed.');
      window.setTimeout(() => void refresh(), 2500);
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : 'TachoMaster enrichment could not be queued.');
    } finally {
      setSyncing(false);
    }
  }

  const reviewCount = drivers.filter(driver => tachoState(driver) !== 'Linked').length;

  return <div>
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="title-row">
        <div>
          <p className="eyebrow">Driver Master</p>
          <h2>Employment + Tacho identity</h2>
          <p className="hint" style={{ maxWidth: 850 }}>
            Sage HR keeps employed staff current. Driver Master remains the operational record. TachoMaster adds member/DB number, card and hours evidence but does not remove a live driver. Amber rows stay live and are highlighted for review.
          </p>
        </div>
        <div className="actions">
          <button onClick={() => void refresh()} disabled={loading}>Refresh</button>
          <button className="primary" onClick={() => void syncTacho()} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync TachoMaster'}</button>
        </div>
      </div>

      <div className="stats" style={{ marginTop: 14 }}>
        <div><strong>{health?.activeDrivers ?? drivers.filter(driver => driver.active).length}</strong><span>Active drivers</span></div>
        <div><strong>{health?.activeWithMember ?? drivers.filter(driver => driver.tachoMasterDriverId).length}</strong><span>Tacho linked</span></div>
        <div><strong>{reviewCount}</strong><span>Need review / evidence</span></div>
        <div><strong>{health?.duplicateMemberGroups ?? 0}</strong><span>Duplicate member IDs</span></div>
      </div>

      {health?.message && <div className="notice inline-notice" style={{ marginTop: 12 }}>{health.message}</div>}
      {notice && <div className="notice inline-notice" style={{ marginTop: 12 }}>{notice}</div>}
      {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}
    </div>

    <div className="panel">
      <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search driver, employee, Tacho, card or licence…" style={{ minWidth: 340 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)} />
          Needs review only
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Tacho status</th><th>Driver</th><th>Employee</th><th>Type / group</th><th>Tacho member / DB</th><th>Card</th><th>Licence</th><th>Last Tacho</th><th></th></tr></thead>
          <tbody>
            {filtered.map(driver => {
              const status = tachoState(driver);
              return <tr key={driver.id} style={status === 'Review' ? { background: '#fffbeb' } : undefined}>
                <td><span style={{ ...statusStyle(status), borderRadius: 999, padding: '3px 9px', fontWeight: 700, whiteSpace: 'nowrap' }}>{status}</span></td>
                <td><strong>{driver.displayName}</strong>{driver.tachoName && driver.tachoName !== driver.displayName ? <div className="hint">Tacho: {driver.tachoName}</div> : null}</td>
                <td>{driver.employeeNumber}</td>
                <td>{driver.driverType || '—'}<div className="hint">{driver.driverGroup || ''}</div></td>
                <td>{driver.tachoMasterDriverId || <strong style={{ color: '#92400e' }}>Review</strong>}</td>
                <td>{driver.tachoCardNumber || '—'}</td>
                <td>{driver.drivingLicenceNumber || '—'}<div className="hint">{driver.licenceExpiry || ''}</div></td>
                <td>{formatDateTime(driver.lastTachoSyncUtc)}</td>
                <td><button onClick={() => openEdit(driver)}>Edit</button></td>
              </tr>;
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} className="hint">No drivers match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    {editing && form && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setEditing(undefined); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Edit ${editing.displayName}`} style={{ maxWidth: 980, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="title-row">
          <div><p className="eyebrow">Driver Master edit</p><h2>{editing.displayName}</h2></div>
          <button onClick={() => setEditing(undefined)}>Close</button>
        </div>

        <p className="hint">Stable identity and compliance fields can be entered manually. The next Tacho sync will enrich hours and duty evidence without overwriting Sage HR employment ownership.</p>

        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <label>Employee number<input value={form.employeeNumber} onChange={e => setField('employeeNumber', e.target.value)} /></label>
          <label>Display name<input value={form.displayName} onChange={e => setField('displayName', e.target.value)} /></label>
          <label>Mobile<input value={form.mobileNumber} onChange={e => setField('mobileNumber', e.target.value)} /></label>
          <label>Driver type<input value={form.driverType} onChange={e => setField('driverType', e.target.value)} /></label>
          <label>Driver group<input value={form.driverGroup} onChange={e => setField('driverGroup', e.target.value)} /></label>
          <label>Skills<input value={form.skills} onChange={e => setField('skills', e.target.value)} /></label>
          <label>Coding<input value={form.coding} onChange={e => setField('coding', e.target.value)} /></label>
          <label>Agency<input value={form.agencyName} onChange={e => setField('agencyName', e.target.value)} /></label>
          <label>Tacho name<input value={form.tachoName} onChange={e => setField('tachoName', e.target.value)} /></label>
          <label>Tacho member / DB number<input value={form.tachoMasterDriverId} onChange={e => setField('tachoMasterDriverId', e.target.value)} /></label>
          <label>Tacho card number<input value={form.tachoCardNumber} onChange={e => setField('tachoCardNumber', e.target.value)} /></label>
          <label>Driving licence number<input value={form.drivingLicenceNumber} onChange={e => setField('drivingLicenceNumber', e.target.value)} /></label>
          <label>Licence expiry<input type="date" value={form.licenceExpiry} onChange={e => setField('licenceExpiry', e.target.value)} /></label>
          <label>CPC expiry<input type="date" value={form.cpcExpiry} onChange={e => setField('cpcExpiry', e.target.value)} /></label>
          <label>Digital tacho card expiry<input type="date" value={form.digitalTachoCardExpiry} onChange={e => setField('digitalTachoCardExpiry', e.target.value)} /></label>
          <label>Medical expiry<input type="date" value={form.medicalExpiry} onChange={e => setField('medicalExpiry', e.target.value)} /></label>
          <label>Licence status<input value={form.licenceStatus} onChange={e => setField('licenceStatus', e.target.value)} /></label>
        </div>

        <div className="form-grid" style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.northEligible} onChange={e => setField('northEligible', e.target.checked)} /> North eligible</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.preloadEligible} onChange={e => setField('preloadEligible', e.target.checked)} /> Preload eligible</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.active} onChange={e => setField('active', e.target.checked)} /> Active in Driver Master</label>
        </div>

        <label style={{ display: 'block', marginTop: 12 }}>Notes<textarea value={form.notes} onChange={e => setField('notes', e.target.value)} rows={3} /></label>

        <div className="panel" style={{ marginTop: 14 }}>
          <strong>Read-only Tacho evidence</strong>
          <p className="hint">Last sync: {formatDateTime(editing.lastTachoSyncUtc)} · Drive today: {editing.tachoDriveAvailableTodayMinutes ?? '—'} min · Drive week: {editing.tachoDriveAvailableWeekMinutes ?? '—'} min · Work week: {editing.tachoWorkAvailableWeekMinutes ?? '—'} min</p>
        </div>

        <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={() => setEditing(undefined)} disabled={saving}>Cancel</button>
          <button className="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save Driver Master'}</button>
        </div>
      </div>
    </div>}
  </div>;
}
