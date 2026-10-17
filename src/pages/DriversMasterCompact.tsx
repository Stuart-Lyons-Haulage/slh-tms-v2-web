import { useCallback, useMemo, useState } from 'react';
import { api, request, type Driver } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { MasterDocuments } from '../components/MasterDocuments';
import { MasterDataExportButton } from '../components/MasterDataExportButton';

type Audit = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changedBy?: string;
  changedAtUtc: string;
};

type TachoCanonicalSyncResult = {
  message: string;
  sourceWorkers: number;
  canonicalActiveDrivers: number;
  created: number;
  duplicateRecordsRetired: number;
  driversArchivedNotInTachoMaster: number;
  workersWithoutCard: number;
};

type TachoCanonicalSyncJob = {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  requestedAtUtc: string;
  startedAtUtc?: string;
  completedAtUtc?: string;
  message?: string;
  result?: {
    success: boolean;
    canonical: TachoCanonicalSyncResult;
    message: string;
  };
};

type TachoIdentityDuplicate = {
  identityValue: string;
  drivers: Array<{
    driverId: string;
    employeeNumber: string;
    displayName: string;
  }>;
};

type TachoDriverMasterQuality = {
  activeDrivers: number;
  activeWithMember: number;
  activeWithCard: number;
  duplicateMemberGroups: number;
  duplicateCardGroups: number;
  duplicateMembers?: TachoIdentityDuplicate[];
  duplicateCards?: TachoIdentityDuplicate[];
  activeWithoutMember: number;
  activeWithoutCard: number;
  latestCanonicalSyncUtc?: string;
};

type TachoProfile = {
  memberCode: number;
  displayName: string;
  cardNumber?: string;
  employeeNumber?: string;
  workerType?: string;
  agencyName?: string;
  email?: string;
  started?: string;
  cardLastRead?: string;
  driverCardExpiry?: string;
  licencePassDate?: string;
  drivingLicenceExpiry?: string;
  licenceCheckDue?: string;
  licencePhotoExpiry?: string;
  cpcExpiry?: string;
  dqcExpiry?: string;
};

const columns: Array<{ key: keyof Driver; label: string }> = [
  { key: 'employeeNumber', label: 'Employee / ref' },
  { key: 'displayName', label: 'Driver' },
  { key: 'mobileNumber', label: 'Mobile' },
  { key: 'driverType', label: 'Type' },
  { key: 'agencyName', label: 'Agency' },
  { key: 'driverGroup', label: 'Group' },
  { key: 'skills', label: 'Skills' },
  { key: 'coding', label: 'Coding' },
  { key: 'tachoMasterDriverId', label: 'Tacho member' },
  { key: 'tachoCardNumber', label: 'Tacho card' },
];

function value(input: unknown) {
  if (input == null || input === '') return '—';
  if (typeof input === 'boolean') return input ? 'Yes' : 'No';
  return String(input);
}

function auditDate(input?: string) {
  if (!input) return '—';
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : parsed.toLocaleString('en-GB');
}

function sourceDate(input?: string) {
  if (!input) return '—';
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : parsed.toLocaleDateString('en-GB');
}

function wait(milliseconds: number) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

export function DriversMasterCompact() {
  const token = useAccessToken();
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const quality = useApi(useCallback(async () => request<TachoDriverMasterQuality>(
    '/api/v1/driver-master/tachomaster/quality', await token(),
  ), [token]));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Driver>();
  const [draft, setDraft] = useState<Driver>();
  const [audit, setAudit] = useState<Audit[]>([]);
  const [tachoProfile, setTachoProfile] = useState<TachoProfile | null>();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return drivers.data || [];
    return (drivers.data || []).filter(driver => columns.some(({ key }) => String(driver[key] ?? '').toLowerCase().includes(needle)));
  }, [drivers.data, query]);

  const edit = <K extends keyof Driver>(key: K, next: Driver[K]) => {
    setDraft(current => current ? { ...current, [key]: next } : current);
  };

  async function openDriver(driver: Driver) {
    setSelected(driver);
    setDraft({ ...driver });
    setAudit([]);
    setTachoProfile(undefined);
    setError(undefined);
    setMessage(undefined);
    const access = await token();
    const [auditResult, profileResult] = await Promise.allSettled([
      request<Audit[]>(`/api/v1/operational-master-data/audit/Driver/${driver.id}`, access),
      request<TachoProfile>(`/api/v1/driver-master/${driver.id}/tachomaster-profile`, access),
    ]);
    setAudit(auditResult.status === 'fulfilled' ? auditResult.value : []);
    setTachoProfile(profileResult.status === 'fulfilled' ? profileResult.value : null);
  }

  function closeDriver() {
    if (saving) return;
    setSelected(undefined);
    setDraft(undefined);
    setAudit([]);
    setTachoProfile(undefined);
  }

  async function saveDriver() {
    if (!draft) return;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const {
        id,
        lastTachoSyncUtc: _lastSync,
        agencyName: _agency,
        tachoName: _tachoName,
        tachoCardNumber: _card,
        tachoMasterDriverId: _member,
        tachoDriveAvailableTodayMinutes: _today,
        tachoDriveAvailableWeekMinutes: _week,
        tachoWorkAvailableWeekMinutes: _work,
        northEligible: _north,
        preloadEligible: _preload,
        ...payload
      } = draft;
      void _lastSync; void _agency; void _tachoName; void _card; void _member;
      void _today; void _week; void _work; void _north; void _preload;
      await api.updateDriver(id, payload, await token());
      setMessage(`${draft.displayName} updated.`);
      setSelected(undefined);
      setDraft(undefined);
      setAudit([]);
      setTachoProfile(undefined);
      await Promise.all([drivers.refresh(), quality.refresh()]);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Driver update failed.');
    } finally {
      setSaving(false);
    }
  }

  async function syncTacho() {
    setSyncing(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const access = await token();
      let job = await request<TachoCanonicalSyncJob>(
        '/api/v1/driver-master/tachomaster/sync',
        access,
        { method: 'POST' },
        15000,
      );
      setMessage(job.message || 'TachoMaster canonical sync queued.');

      const pollDeadline = Date.now() + 12 * 60 * 1000;
      while ((job.status === 'queued' || job.status === 'running') && Date.now() < pollDeadline) {
        await wait(2000);
        job = await request<TachoCanonicalSyncJob>(
          `/api/v1/driver-master/tachomaster/sync/${job.jobId}`,
          access,
          undefined,
          15000,
        );
        if (job.message) setMessage(job.message);
      }

      if (job.status === 'failed') {
        throw new Error(job.message || 'TachoMaster canonical sync failed.');
      }
      if (job.status !== 'succeeded') {
        setMessage('TachoMaster sync is still running in the background. Refresh Driver Master to check the latest canonical state.');
        return;
      }

      setMessage(job.result?.message || job.result?.canonical?.message || job.message || 'TachoMaster canonical sync completed.');
      await Promise.all([drivers.refresh(), quality.refresh()]);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'TachoMaster canonical sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  const q = quality.data;
  const identityHealthy = q && q.duplicateMemberGroups === 0 && q.duplicateCardGroups === 0 && q.activeWithoutMember === 0;

  return <section className="drivers-unified-page">
    <div className="title-row">
      <div>
        <p className="eyebrow">Driver master · CRM</p>
        <h1>Drivers</h1>
        <p className="hint">One real driver, one active CRM record. TachoMaster owns Member/Card identity and the active worker population; Sage HR enriches employed staff, including employment and leave data.</p>
      </div>
      <div className="title-actions">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search driver…" aria-label="Search drivers" />
        <button onClick={() => void Promise.all([drivers.refresh(), quality.refresh()])} disabled={drivers.loading}>Refresh</button><MasterDataExportButton section="drivers" label="Drivers" rows={(drivers.data || []) as unknown as Record<string, unknown>[]} />
        <button className="primary" onClick={() => void syncTacho()} disabled={syncing}>{syncing ? 'Refreshing eligible drivers…' : 'Refresh drivers with recent card reads'}</button>
      </div>
    </div>

    {q && <div className="notice inline-notice" style={identityHealthy ? undefined : { borderColor: '#b42318' }}>
      <strong>{identityHealthy ? 'Canonical identity healthy.' : 'Driver identity needs attention.'}</strong>{' '}
      {q.activeDrivers} active · {q.activeWithMember} with Member Code · {q.activeWithCard} with card · {q.duplicateMemberGroups} duplicate member group(s) · {q.duplicateCardGroups} duplicate card group(s) · {q.activeWithoutCard} without card in the live source.
      {q.latestCanonicalSyncUtc ? ` Last canonical sync ${auditDate(q.latestCanonicalSyncUtc)}.` : ' Canonical sync has not completed yet.'}
      {!identityHealthy && ((q.duplicateMembers?.length || 0) > 0 || (q.duplicateCards?.length || 0) > 0) && <div style={{ marginTop: 6 }}>
        {(q.duplicateMembers || []).map(group => <div key={`member-${group.identityValue}`}><strong>Member {group.identityValue}:</strong> {group.drivers.map(driver => `${driver.displayName} (${driver.employeeNumber}, ${driver.driverId})`).join(' · ')}</div>)}
        {(q.duplicateCards || []).map(group => <div key={`card-${group.identityValue}`}><strong>Card {group.identityValue}:</strong> {group.drivers.map(driver => `${driver.displayName} (${driver.employeeNumber}, ${driver.driverId})`).join(' · ')}</div>)}
      </div>}
    </div>}
    {message && <p className="notice inline-notice">{message}</p>}
    {error && <p className="notice inline-notice" style={{ borderColor: '#b42318' }}>{error}</p>}

    {drivers.error ? <div className="state error"><p>{drivers.error}</p></div> : drivers.loading && !drivers.data ? <div className="state">Loading drivers…</div> : <div className="master-table-wrap" style={{ overflowX: 'auto' }}>
      <table className="master-table driver-unified-table" style={{ minWidth: 1320 }}>
        <thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{visible.map(driver => <tr
          key={driver.id}
          className="crm-click-row"
          tabIndex={0}
          onClick={() => void openDriver(driver)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void openDriver(driver);
            }
          }}
          aria-label={`Open ${driver.displayName}`}
        >
          {columns.map(column => <td key={column.key}>{column.key === 'displayName' ? <strong>{value(driver[column.key])}</strong> : value(driver[column.key])}</td>)}
        </tr>)}</tbody>
      </table>
      {!drivers.loading && visible.length === 0 && <div className="state">No drivers match this search.</div>}
    </div>}
    <p className="hint">{visible.length} active driver{visible.length === 1 ? '' : 's'} shown. Retired duplicate identities remain in audit/history but are not allocatable.</p>

    {selected && draft && <div
      className="crm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit driver ${selected.displayName}`}
      onMouseDown={event => { if (event.target === event.currentTarget) closeDriver(); }}
    >
      <div className="crm-modal">
        <div className="crm-modal-header">
          <div>
            <p className="eyebrow">Driver CRM record</p>
            <h2>{selected.displayName}</h2>
            <p className="hint">Operational CRM information stays with the canonical driver. Tacho identity is read-only here and refreshed from TachoMaster.</p>
          </div>
          <button type="button" onClick={closeDriver} disabled={saving}>Close</button>
        </div>

        <div className="crm-modal-body">
          <section>
            <h3>Core information</h3>
            <div className="crm-form-grid">
              <label>Employee / agency ref<input value={draft.employeeNumber} onChange={event => edit('employeeNumber', event.target.value)} /></label>
              <label>Driver<input value={draft.displayName} onChange={event => edit('displayName', event.target.value)} /></label>
              <label>Mobile<input value={draft.mobileNumber || ''} onChange={event => edit('mobileNumber', event.target.value)} /></label>
              <label>Type<input value={draft.driverType || ''} onChange={event => edit('driverType', event.target.value)} /></label>
              <label>Agency<input value={draft.agencyName || tachoProfile?.agencyName || ''} readOnly /></label>
              <label>Group<input value={draft.driverGroup || ''} onChange={event => edit('driverGroup', event.target.value)} /></label>
              <label>Skills<textarea rows={3} value={draft.skills || ''} onChange={event => edit('skills', event.target.value)} /></label>
              <label>Coding<input value={draft.coding || ''} onChange={event => edit('coding', event.target.value)} /></label>
            </div>
          </section>

          <section>
            <h3>TachoMaster identity</h3>
            <div className="crm-form-grid">
              <label>Tacho name<input value={draft.tachoName || tachoProfile?.displayName || ''} readOnly /></label>
              <label>Tacho member<input value={draft.tachoMasterDriverId || (tachoProfile?.memberCode ? String(tachoProfile.memberCode) : '')} readOnly /></label>
              <label>Tacho card<input value={draft.tachoCardNumber || tachoProfile?.cardNumber || ''} readOnly /></label>
              <label>Last Tacho sync<input value={auditDate(draft.lastTachoSyncUtc)} readOnly /></label>
              <label>Drive available today<input value={draft.tachoDriveAvailableTodayMinutes == null ? '—' : `${draft.tachoDriveAvailableTodayMinutes} min`} readOnly /></label>
              <label>Drive available week<input value={draft.tachoDriveAvailableWeekMinutes == null ? '—' : `${draft.tachoDriveAvailableWeekMinutes} min`} readOnly /></label>
            </div>
            <p className="hint">Member Code and driver card are authoritative identities. Name matching is only used as controlled recovery when the live Tacho name is unique and no strong identity conflicts.</p>
          </section>

          <section>
            <h3>TachoMaster worker profile</h3>
            {tachoProfile === undefined ? <p className="hint">Loading live-source profile…</p> : tachoProfile === null ? <p className="hint">No stored TachoMaster profile is available yet. Run the canonical sync.</p> : <div className="crm-form-grid">
              <label>Worker type<input value={tachoProfile.workerType || ''} readOnly /></label>
              <label>Agency<input value={tachoProfile.agencyName || ''} readOnly /></label>
              <label>Email<input value={tachoProfile.email || ''} readOnly /></label>
              <label>Started<input value={sourceDate(tachoProfile.started)} readOnly /></label>
              <label>Card last read<input value={sourceDate(tachoProfile.cardLastRead)} readOnly /></label>
              <label>Driver card expiry<input value={sourceDate(tachoProfile.driverCardExpiry)} readOnly /></label>
              <label>Licence pass date<input value={sourceDate(tachoProfile.licencePassDate)} readOnly /></label>
              <label>Driving licence expiry<input value={sourceDate(tachoProfile.drivingLicenceExpiry)} readOnly /></label>
              <label>Licence check due<input value={sourceDate(tachoProfile.licenceCheckDue)} readOnly /></label>
              <label>Licence photo expiry<input value={sourceDate(tachoProfile.licencePhotoExpiry)} readOnly /></label>
              <label>CPC expiry<input value={sourceDate(tachoProfile.cpcExpiry)} readOnly /></label>
              <label>DQC expiry<input value={sourceDate(tachoProfile.dqcExpiry)} readOnly /></label>
            </div>}
          </section>

          <section>
            <h3>Licence & notes</h3>
            <div className="crm-form-grid">
              <label>Licence no.<input value={draft.drivingLicenceNumber || ''} onChange={event => edit('drivingLicenceNumber', event.target.value)} /></label>
              <label>Licence expiry<input type="date" value={draft.licenceExpiry || ''} onChange={event => edit('licenceExpiry', event.target.value)} /></label>
              <label>Licence status<input value={draft.licenceStatus || ''} onChange={event => edit('licenceStatus', event.target.value)} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Notes<textarea rows={3} value={draft.notes || ''} onChange={event => edit('notes', event.target.value)} /></label>
            </div>
          </section>

          <section>
            <h3>Audit</h3>
            {audit.length ? <div className="crm-audit-list">{audit.slice(0, 12).map(item => <article key={item.id}><strong>{item.action}</strong><span>{auditDate(item.changedAtUtc)}</span><small>{item.changedBy || '—'}</small></article>)}</div> : <p className="hint">No recorded changes yet.</p>}
          </section>

          <section className="crm-documents">
            <MasterDocuments entityType="Driver" entityId={selected.id} title={selected.displayName} />
          </section>
        </div>

        <div className="crm-modal-actions">
          <button className="primary" disabled={saving} onClick={() => void saveDriver()}>{saving ? 'Saving…' : 'Save CRM record'}</button>
          <button disabled={saving} onClick={closeDriver}>Cancel</button>
        </div>
      </div>
    </div>}
  </section>;
}
