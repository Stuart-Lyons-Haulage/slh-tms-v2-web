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

type FilterState = {
  status: string;
  driver: string;
  employee: string;
  typeGroup: string;
  member: string;
  card: string;
  licence: string;
  lastTacho: string;
};

const emptyFilters: FilterState = {
  status: '',
  driver: '',
  employee: '',
  typeGroup: '',
  member: '',
  card: '',
  licence: '',
  lastTacho: '',
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

function includes(value: unknown, filter: string) {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return String(value ?? '').toLowerCase().includes(needle);
}

export function DriversMasterOperational() {
  const token = useAccessToken();
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [health, setHealth] = useState<DriverMasterHealth>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
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

  const filtered = useMemo(() => drivers
    .filter(driver => !filters.status || tachoState(driver) === filters.status)
    .filter(driver => includes(`${driver.displayName} ${driver.tachoName || ''}`, filters.driver))
    .filter(driver => includes(driver.employeeNumber, filters.employee))
    .filter(driver => includes(`${driver.driverType || ''} ${driver.driverGroup || ''} ${driver.agencyName || ''}`, filters.typeGroup))
    .filter(driver => includes(driver.tachoMasterDriverId, filters.member))
    .filter(driver => includes(driver.tachoCardNumber, filters.card))
    .filter(driver => includes(`${driver.drivingLicenceNumber || ''} ${driver.licenceExpiry || ''}`, filters.licence))
    .filter(driver => includes(formatDateTime(driver.lastTachoSyncUtc), filters.lastTacho))
    .sort((a, b) => {
      const rank = (driver: DriverRecord) => tachoState(driver) === 'Linked' ? 1 : 0;
      return rank(a) - rank(b) || a.displayName.localeCompare(b.displayName);
    }), [drivers, filters]);

  function setFilter<K extends keyof FilterState>(field: K, value: FilterState[K]) {
    setFilters(current => ({ ...current, [field]: value }));
  }

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
      setNotice('Driver Master details saved.');
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
      setNotice(result.message || 'TachoMaster refresh queued. Driver identity, card, duty and hours evidence will be refreshed.');
      window.setTimeout(() => void refresh(), 2500);
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : 'TachoMaster refresh could not be queued.');
    } finally {
      setSyncing(false);
    }
  }

  const reviewCount = drivers.filter(driver => tachoState(driver) !== 'Linked').length;
  const anyFilter = Object.values(filters).some(value => value.trim());

  return <div>
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="title-row">
        <div>
          <p className="eyebrow">Driver Master</p>
          <h2>Employment + Tacho identity</h2>
          <p className="hint" style={{ maxWidth: 850 }}>
            Driver Master remains the operational record. Sage HR owns employment information and TachoMaster enriches member, card, duty and hours evidence. Missing Tacho evidence never removes a valid Driver Master record.
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
      <div className="title-row" style={{ marginBottom: 10 }}>
        <div><p className="eyebrow">Driver records</p><h3>{filtered.length} shown</h3></div>
        {anyFilter && <button type="button" onClick={() => setFilters(emptyFilters)}>Clear filters</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tacho status</th><th>Driver</th><th>Employee</th><th>Type / group</th><th>Tacho member / DB</th><th>Card</th><th>Licence</th><th>Last Tacho</th><th></th>
            </tr>
            <tr className="table-filter-row">
              <th>
                <select value={filters.status} onChange={event => setFilter('status', event.target.value)} aria-label="Filter Tacho status">
                  <option value="">All</option><option value="Linked">Linked</option><option value="Review">Review</option><option value="No Card">No Card</option><option value="Stale">Stale</option>
                </select>
              </th>
              <th><input value={filters.driver} onChange={event => setFilter('driver', event.target.value)} placeholder="Filter driver" aria-label="Filter driver" /></th>
              <th><input value={filters.employee} onChange={event => setFilter('employee', event.target.value)} placeholder="Filter employee" aria-label="Filter employee" /></th>
              <th><input value={filters.typeGroup} onChange={event => setFilter('typeGroup', event.target.value)} placeholder="Filter type/group" aria-label="Filter type or group" /></th>
              <th><input value={filters.member} onChange={event => setFilter('member', event.target.value)} placeholder="Filter member" aria-label="Filter Tacho member" /></th>
              <th><input value={filters.card} onChange={event => setFilter('card', event.target.value)} placeholder="Filter card" aria-label="Filter Tacho card" /></th>
              <th><input value={filters.licence} onChange={event => setFilter('licence', event.target.value)} placeholder="Filter licence" aria-label="Filter licence" /></th>
              <th><input value={filters.lastTacho} onChange={event => setFilter('lastTacho', event.target.value)} placeholder="Filter sync" aria-label="Filter last Tacho sync" /></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(driver => {
              const status = tachoState(driver);
              return <tr key={driver.id} style={status === 'Review' ? { background: '#fffbeb' } : undefined}>
                <td><span style={{ ...statusStyle(status), borderRadius: 999, padding: '3px 9px', fontWeight: 700, whiteSpace: 'nowrap' }}>{status}</span></td>
                <td><strong>{driver.displayName}</strong>{driver.tachoName && driver.tachoName !== driver.displayName ? <div className="hint">Tacho: {driver.tachoName}</div> : null}</td>
                <td>{driver.employeeNumber}</td>
                <td>{driver.driverType || '—'}<div className="hint">{driver.driverGroup || driver.agencyName || ''}</div></td>
                <td>{driver.tachoMasterDriverId || <strong style={{ color: '#92400e' }}>Review</strong>}</td>
                <td>{driver.tachoCardNumber || '—'}</td>
                <td>{driver.drivingLicenceNumber || '—'}<div className="hint">{driver.licenceExpiry || ''}</div></td>
                <td>{formatDateTime(driver.lastTachoSyncUtc)}</td>
                <td><button onClick={() => openEdit(driver)}>Edit</button></td>
              </tr>;
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={9} className="hint">No drivers match these column filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    {editing && form && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Edit ${editing.displayName}`} onMouseDown={event => { if (event.currentTarget === event.target && !saving) setEditing(undefined); }}>
      <div className="crm-modal" style={{ maxWidth: 1050 }}>
        <div className="crm-modal-header">
          <div><p className="eyebrow">Driver Master record</p><h2>{editing.displayName}</h2><p className="hint">Edit maintained Driver Master fields here. TachoMaster Sync refreshes provider-owned evidence without replacing the canonical operational record.</p></div>
          <button type="button" onClick={() => setEditing(undefined)} disabled={saving}>Close</button>
        </div>

        <div className="crm-modal-body">
          <section>
            <h3>Identity & classification</h3>
            <div className="crm-form-grid">
              <label>Employee number<input value={form.employeeNumber} onChange={e => setField('employeeNumber', e.target.value)} /></label>
              <label>Display name<input value={form.displayName} onChange={e => setField('displayName', e.target.value)} /></label>
              <label>Mobile<input value={form.mobileNumber} onChange={e => setField('mobileNumber', e.target.value)} /></label>
              <label>Driver type<input value={form.driverType} onChange={e => setField('driverType', e.target.value)} /></label>
              <label>Driver group<input value={form.driverGroup} onChange={e => setField('driverGroup', e.target.value)} /></label>
              <label>Agency<input value={form.agencyName} onChange={e => setField('agencyName', e.target.value)} /></label>
              <label>Skills<input value={form.skills} onChange={e => setField('skills', e.target.value)} /></label>
              <label>Coding<input value={form.coding} onChange={e => setField('coding', e.target.value)} /></label>
            </div>
          </section>

          <section>
            <h3>TachoMaster identity</h3>
            <div className="crm-form-grid">
              <label>Tacho name<input value={form.tachoName} onChange={e => setField('tachoName', e.target.value)} /></label>
              <label>Tacho member / DB number<input value={form.tachoMasterDriverId} onChange={e => setField('tachoMasterDriverId', e.target.value)} /></label>
              <label>Tacho card number<input value={form.tachoCardNumber} onChange={e => setField('tachoCardNumber', e.target.value)} /></label>
              <label>Digital tacho card expiry<input type="date" value={form.digitalTachoCardExpiry} onChange={e => setField('digitalTachoCardExpiry', e.target.value)} /></label>
            </div>
          </section>

          <section>
            <h3>Licence & compliance</h3>
            <div className="crm-form-grid">
              <label>Driving licence number<input value={form.drivingLicenceNumber} onChange={e => setField('drivingLicenceNumber', e.target.value)} /></label>
              <label>Licence expiry<input type="date" value={form.licenceExpiry} onChange={e => setField('licenceExpiry', e.target.value)} /></label>
              <label>CPC expiry<input type="date" value={form.cpcExpiry} onChange={e => setField('cpcExpiry', e.target.value)} /></label>
              <label>Medical expiry<input type="date" value={form.medicalExpiry} onChange={e => setField('medicalExpiry', e.target.value)} /></label>
              <label>Licence status<input value={form.licenceStatus} onChange={e => setField('licenceStatus', e.target.value)} /></label>
            </div>
          </section>

          <section>
            <div className="crm-form-grid">
              <label className="checkbox-label"><input type="checkbox" checked={form.northEligible} onChange={e => setField('northEligible', e.target.checked)} /> North eligible</label>
              <label className="checkbox-label"><input type="checkbox" checked={form.preloadEligible} onChange={e => setField('preloadEligible', e.target.checked)} /> Preload eligible</label>
              <label className="checkbox-label"><input type="checkbox" checked={form.active} onChange={e => setField('active', e.target.checked)} /> Active in Driver Master</label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<textarea value={form.notes} onChange={e => setField('notes', e.target.value)} rows={4} /></label>
            </div>
          </section>

          <section className="panel">
            <strong>Read-only Tacho evidence</strong>
            <p className="hint">Last sync: {formatDateTime(editing.lastTachoSyncUtc)} · Drive today: {editing.tachoDriveAvailableTodayMinutes ?? '—'} min · Drive week: {editing.tachoDriveAvailableWeekMinutes ?? '—'} min · Work week: {editing.tachoWorkAvailableWeekMinutes ?? '—'} min</p>
          </section>
        </div>

        <div className="crm-modal-actions">
          <button type="button" onClick={() => setEditing(undefined)} disabled={saving}>Cancel</button>
          <button className="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save Driver Master'}</button>
        </div>
      </div>
    </div>}
  </div>;
}
