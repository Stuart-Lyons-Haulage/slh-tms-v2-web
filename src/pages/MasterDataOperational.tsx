import { useCallback, useEffect, useMemo, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { MasterDocuments } from '../components/MasterDocuments';
import { MasterDataExportButton } from '../components/MasterDataExportButton';
import { SiteTimingProfilePanel } from '../components/SiteTimingProfilePanel';

export type MasterDataTab = 'drivers' | 'vehicles' | 'trailers' | 'sites' | 'geofences' | 'customers';
type Row = Record<string, unknown> & { id: string; active: boolean };
type Audit = { id: string; entityType: string; entityId: string; action: string; changesJson?: string; changedBy?: string; changedAtUtc: string };
type SitePlanningProfile = { siteId: string; externalCode: string; name: string; collectionAddress?: string; defaultTemperatureC?: number; region: string; source: string };
type SiteGeofenceStatus = { siteId: string; siteCode: string; siteName: string; linkedGeofences: string[]; geofenceLinked: boolean; needsReview: boolean };
type SiteSyncResult = { sitesCoded: number; geofencesLinked: number; geofencesUnlinked: number; geofencesCanonicalized: number; sitesMissingGeofence: number; sites: SiteGeofenceStatus[] };
type GeofenceOption = { id: string; name: string; siteId?: string | null; siteNumber?: string; active: boolean };
type EditType = 'text' | 'number' | 'checkbox' | 'textarea' | 'region' | 'date';

const regions = ['North', 'Midlands', 'East', 'London', 'South East', 'South West', 'West / Wales', 'Other'];

const config: Record<MasterDataTab, { title: string; search: string; entityType: string; columns: Array<[string, string]>; editable: Array<[string, string, EditType]> }> = {
  drivers: { title: 'Drivers', search: 'Name, employee number or Tacho name', entityType: 'Driver', columns: [['displayName','Driver'],['employeeNumber','Employee'],['tachoName','Tacho name'],['driverType','Type'],['driverGroup','Group']], editable: [['displayName','Driver name','text'],['employeeNumber','Employee number','text'],['tachoName','Tacho name','text'],['mobileNumber','Mobile','text'],['driverType','Driver type','text'],['driverGroup','Driver group','text'],['skills','Skills','textarea']] },
  vehicles: { title: 'Vehicles', search: 'Registration, last 3, fleet number or abbreviation', entityType: 'Vehicle', columns: [['registration','Registration'],['fleetNumber','Fleet no.'],['abbreviation','Short code'],['transmission','Transmission'],['fleetioStatus','Fleetio']], editable: [['registration','Registration','text'],['vin','VIN','text'],['ownerType','Owner type','text'],['vehicleSite','Vehicle site / depot','text'],['fleetNumber','Fleet number','text'],['abbreviation','Abbreviation / last 3','text'],['transmission','Transmission','text'],['dvsCompliant','DVS compliant','checkbox'],['fuelProvider','Fuel provider','text'],['cabMobile','Cab mobile','text'],['fuelPin','Fuel PIN','text'],['shellCard','Shell card','text'],['bpRedCard','BP red card','text'],['bpPlainCard','BP plain card','text'],['fuelPinSecretName','Fuel PIN secret name','text'],['fuelCardLastFour','Fuel card last four','text'],['motExpiry','MOT expiry','date'],['tachoCalibrationExpiry','Tacho calibration expiry','date'],['vehicleTestExpiry','Vehicle test expiry','date'],['fleetioId','Fleetio ID','text'],['fleetioName','Fleetio name','text'],['fleetioStatus','Fleetio status','text'],['notes','Notes','textarea']] },
  trailers: { title: 'Trailers', search: 'Trailer number or type', entityType: 'Trailer', columns: [['trailerNumber','Trailer'],['type','Type'],['standardCapacity','Standard capacity'],['euroCapacity','Euro capacity']], editable: [['trailerNumber','Trailer number','text'],['type','Type','text'],['standardCapacity','Standard capacity','number'],['euroCapacity','Euro capacity','number'],['notes','Notes','textarea']] },
  sites: { title: 'Sites', search: 'Site name, customer, alias, SITE code, Roadrunner code, postcode, region or driver text name', entityType: 'Site', columns: [['name','Site'],['customerCode','Customer'],['externalCode','Code'],['roadrunnerCode','Roadrunner'],['addressCompleteness','Address'],['linkedGeofence','Linked geofence'],['collectionAddress','Address / postcode'],['region','Planning region']], editable: [['externalCode','Canonical site code','text'],['customerCode','Customer code','text'],['name','Site name','text'],['driverTextName','Driver text name','text'],['roadrunnerCode','Roadrunner code','text'],['aliases','Planner / customer aliases (comma or semicolon separated)','textarea'],['collectionAddress','Address / postcode','textarea'],['collectionInstructions','Collection instructions / notes','textarea'],['mapLink','Map link','text'],['latitude','Latitude','number'],['longitude','Longitude','number'],['operationalRegion','Operational region','text'],['customField1','Custom field 1','text'],['customField2','Custom field 2','text'],['customField3','Custom field 3','text'],['roadrunnerProfileJson','Roadrunner profile JSON','textarea'],['defaultTemperatureC','Default temperature °C','number'],['region','Planning region','region']] },
  geofences: { title: 'Geofences', search: 'Geofence name, site number or category', entityType: 'Geofence', columns: [['name','Geofence'],['siteNumber','Site no.'],['category','Category'],['maxWaitMinutes','Max wait'],['pendingEntryMinutes','Entry confirm']], editable: [['name','Name','text'],['siteNumber','Site number','text'],['category','Category','text'],['categoryMaxWaitMinutes','Category max wait (min)','number'],['maxWaitMinutes','Max wait (min)','number'],['pendingEntryMinutes','Entry confirm (min)','number'],['pendingExitMinutes','Exit confirm (min)','number'],['polygonJson','Polygon JSON','textarea']] },
  customers: { title: 'Customers', search: 'Customer name, trading name or code', entityType: 'Customer', columns: [['name','Customer'],['code','Code'],['tradingName','Trading name'],['accountOwner','Account owner']], editable: [['code','Customer code','text'],['name','Customer name','text'],['tradingName','Trading name','text'],['accountOwner','Account owner','text'],['defaultSiteCode','Default site code','text'],['serviceNotes','Service notes / SOP','textarea']] },
};

function fmt(value: unknown) { if (value == null || value === '') return '—'; if (typeof value === 'boolean') return value ? 'Yes' : 'No'; return String(value); }
function fmtCell(key: string, value: unknown) { if (key === 'defaultTemperatureC' && value != null && value !== '') { const temperature = Number(value); return `${temperature > 0 ? '+' : ''}${temperature}°C`; } return fmt(value); }
function isoDate(value?: string) { return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function matchesQuery(row: Row, query: string) { const value = query.trim().toLowerCase(); if (!value) return true; return Object.values(row).some(item => item != null && String(item).toLowerCase().includes(value)); }

export function MasterDataOperational({ initialTab = 'drivers', showCategoryButtons = true, showHeading = true }: { initialTab?: MasterDataTab; showCategoryButtons?: boolean; showHeading?: boolean }) {
  const token = useAccessToken();
  const [tab, setTab] = useState<MasterDataTab>(initialTab);
  const [query, setQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row>();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [audit, setAudit] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [siteSyncChecked, setSiteSyncChecked] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [bulkDeletePassword, setBulkDeletePassword] = useState('');
  const [bulkDeleteIds, setBulkDeleteIds] = useState<Set<string>>(() => new Set());
  const [forceSiteHistoryOverride, setForceSiteHistoryOverride] = useState(false);
  const [siteGeofences, setSiteGeofences] = useState<GeofenceOption[]>([]);
  const current = config[tab];
  const endpoint = `/api/v1/operational-master-data/${tab}`;
  const crmMode = true;
  const bulkDeleteAvailable = tab === 'drivers' || tab === 'sites';

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const access = await token();
      if (tab === 'sites') {
        const [activeSites, profiles, geofenceStatus, geofenceOptions] = await Promise.all([
          request<Row[]>('/api/v1/sites', access),
          request<SitePlanningProfile[]>('/api/v1/site-planning-profiles', access),
          request<SiteGeofenceStatus[]>('/api/v1/site-geofence-sync/sites', access),
          request<GeofenceOption[]>('/api/v1/operational-master-data/geofences/search?includeInactive=false&take=5000', access),
        ]);
        setSiteGeofences(geofenceOptions);
        let sourceSites = activeSites;
        if (includeInactive) {
          try {
            const archivedSearch = await request<Row[]>(`${endpoint}/search?includeInactive=true`, access);
            sourceSites = Array.from(new Map([...activeSites, ...archivedSearch].map(row => [row.id, row])).values());
          } catch { /* keep the complete active register if archived lookup is unavailable */ }
        }
        const profileBySite = new Map(profiles.map(profile => [profile.siteId, profile]));
        const geofenceBySite = new Map(geofenceStatus.map(status => [status.siteId, status]));
        const merged = sourceSites.map(site => {
          const profile = profileBySite.get(site.id);
          const geofence = geofenceBySite.get(site.id);
          return {
            ...site,
            externalCode: geofence?.siteCode || site.externalCode,
            linkedGeofence: geofence?.linkedGeofences?.join(', ') || 'Missing geofence',
            geofenceMissing: geofence?.needsReview ?? true,
            geofenceLinked: geofence?.geofenceLinked ?? false,
            defaultTemperatureC: profile?.defaultTemperatureC ?? null,
            region: profile?.region || 'Other',
            planningProfileSource: profile?.source || 'No planning profile',
            addressCompleteness: !String(site.collectionAddress || '').trim()
              ? 'Missing'
              : /\\b[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}\\b/i.test(String(site.collectionAddress))
                ? 'Complete'
                : 'Partial',
          } as Row;
        });
        setRows(merged.filter(row => matchesQuery(row, query)).sort((a, b) => String(a.externalCode ?? '').localeCompare(String(b.externalCode ?? '')) || String(a.name ?? '').localeCompare(String(b.name ?? ''))));
      } else {
        const params = new URLSearchParams({ includeInactive: String(includeInactive) });
        if (query.trim()) params.set('q', query.trim());
        try { setRows(await request<Row[]>(`${endpoint}/search?${params}`, access)); }
        catch {
          const fallback = await request<Row[]>(`/api/v1/${tab}`, access);
          setRows(fallback.filter(row => (includeInactive || row.active !== false) && matchesQuery(row, query)));
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load master data.'); }
    finally { setLoading(false); }
  }, [endpoint, includeInactive, query, tab, token]);

  useEffect(() => { const handle = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(handle); }, [load]);
  useEffect(() => { setSelected(undefined); setDraft({}); setAudit([]); setQuery(''); if (tab !== 'sites') setSiteSyncChecked(false); setBulkDeleteMode(false); setBulkDeletePassword(''); setBulkDeleteIds(new Set()); }, [tab]);
  useEffect(() => { setBulkDeleteIds(selectedIds => new Set([...selectedIds].filter(id => rows.some(row => row.id === id)))); }, [rows]);

  const openEdit = async (row: Row) => {
    setSelected(row); setDraft({ ...row }); setAudit([]); setError(undefined); setNotice(undefined);
    try { const access = await token(); setAudit(await request<Audit[]>(`/api/v1/operational-master-data/audit/${current.entityType}/${row.id}`, access)); } catch { /* history optional */ }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const access = await token();
      if (tab === 'sites') {
        const temperatureValue = draft.defaultTemperatureC == null || draft.defaultTemperatureC === '' ? null : Number(draft.defaultTemperatureC);
        if (temperatureValue != null && (!Number.isFinite(temperatureValue) || temperatureValue < -30 || temperatureValue > 30)) throw new Error('Default temperature must be between -30°C and +30°C, or left blank.');
        const sitePayload = { ...draft, externalCode: draft.externalCode || selected.externalCode };
        await request(`${endpoint}/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sitePayload) });
        await request(`/api/v1/sites/${selected.id}/aliases`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aliases: draft.aliases == null ? null : String(draft.aliases) }) });
        await request(`/api/v1/site-planning-profiles/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultTemperatureC: temperatureValue, region: String(draft.region || 'Other') }) });
      } else {
        try { await request(`${endpoint}/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); }
        catch { await request(`/api/v1/${tab}/${selected.id}`, access, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); }
      }
      setNotice(tab === 'sites' ? 'Site details, aliases and planning profile updated. Planner/customer aliases now resolve to this canonical Site and its linked geofence.' : `${current.entityType} updated in the Live TMS Master Database.`);
      setSelected(undefined); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed.'); }
    finally { setSaving(false); }
  };

  const syncSites = async () => {
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const result = await request<SiteSyncResult>('/api/v1/site-geofence-sync/sync-sites', await token(), { method: 'POST' });
      setSiteSyncChecked(true);
      setNotice(`Sites synced: ${result.sitesCoded} code(s) set to SITE###, ${result.geofencesLinked} geofence link(s) added, ${result.geofencesUnlinked} stale/unsupported link(s) removed, ${result.sitesMissingGeofence} site(s) need geofence review.`);
      setSelected(undefined);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Site/geofence sync failed.'); }
    finally { setSaving(false); }
  };

  const linkSiteGeofence = async (site: Row, geofenceId: string) => {
    if (!geofenceId) return;
    const geofence = siteGeofences.find(item => item.id === geofenceId);
    if (!geofence) { setError('The selected geofence is no longer available. Refresh the Sites list and try again.'); return; }
    const siteCode = String(site.externalCode || '').trim();
    if (!siteCode) { setError('This Site has no canonical Site code, so the geofence cannot be saved yet. Run Sync Sites and try again.'); return; }
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const access = await token();
      await request<SiteGeofenceStatus>(`/api/v1/site-geofence-sync/geofences/${geofence.id}/link`, access, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteCode }),
      });
      const statuses = await request<SiteGeofenceStatus[]>('/api/v1/site-geofence-sync/sites', access, { cache: 'no-store' });
      const persisted = statuses.find(status => status.siteId === site.id);
      const selectedName = geofence.name.trim().toLowerCase();
      const confirmed = persisted?.geofenceLinked === true
        && persisted.linkedGeofences.some(name => name.trim().toLowerCase() === selectedName);
      if (!confirmed) throw new Error('The geofence link was accepted but could not be confirmed in Site Master. It has not been marked as linked.');
      setNotice(`${geofence.name} is linked to ${fmt(site.name)} and the saved Site Master link has been verified.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'The geofence link could not be saved.'); }
    finally { setSaving(false); }
  };

  const setActive = async (row: Row, active: boolean) => {
    if (!window.confirm(`${active ? 'Restore' : 'Archive'} this ${current.entityType.toLowerCase()}? ${active ? 'It will return to active master-data lists.' : 'It will be removed from normal planning selections but historical records will be retained.'}`)) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const access = await token();
      try { await request(`/api/v1/master-data-cleanup/${tab}/${row.id}/${active ? 'restore' : 'archive'}`, access, { method: 'POST' }); }
      catch { await request(`${endpoint}/${row.id}/${active ? 'restore' : 'archive'}`, access, { method: 'POST' }); }
      setNotice(`${current.entityType} ${active ? 'restored' : 'archived'}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Archive/restore failed.'); }
    finally { setSaving(false); }
  };

  const deleteRecord = async (row: Row) => {
    if (row.active) { setError('Archive this record before deleting it.'); return; }
    const label = fmt(row[current.columns[0][0]]);
    if (!window.confirm(`Permanently delete ${current.entityType.toLowerCase()} “${label}” from the TMS master?\n\nUse Delete only for a duplicate or incorrect master record. If it is referenced by operational history, the TMS will block deletion and keep it archived.`)) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      await request(`/api/v1/master-data-cleanup/${tab}/${row.id}`, await token(), { method: 'DELETE' });
      setNotice(`${current.entityType} permanently deleted from the TMS master.`);
      if (selected?.id === row.id) setSelected(undefined);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed. This record may be in use; leave it archived instead.'); }
    finally { setSaving(false); }
  };

  const startBulkDelete = () => {
    const password = window.prompt('Admin delete password');
    if (!password) return;
    setBulkDeletePassword(password);
    setBulkDeleteMode(true);
    setBulkDeleteIds(new Set());
    setError(undefined);
    setNotice(undefined);
  };

  const toggleBulkDeleteRow = (id: string, checked: boolean) => {
    setBulkDeleteIds(previous => {
      const next = new Set(previous);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleBulkDeleteAll = (checked: boolean) => {
    setBulkDeleteIds(checked ? new Set(rows.map(row => row.id)) : new Set());
  };

  const bulkDeleteSelected = async () => {
    const ids = [...bulkDeleteIds];
    if (!ids.length) { setError('Tick at least one row to delete.'); return; }
    const forceMessage = forceSiteHistoryOverride && tab === 'sites'
      ? '\n\nThis will detach linked geofences from the selected archived sites. Geofence visit history will be retained.'
      : '\n\nRows linked to live TMS history will be blocked and kept.';
    if (!window.confirm(`Permanently delete ${ids.length} selected ${current.title.toLowerCase()} record${ids.length === 1 ? '' : 's'}?${forceMessage}`)) return;
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      const access = await token();
      const result = await request<{
        deleted: number;
        blocked: number;
        notFound: number;
        message?: string;
        blockedRows?: { label?: string; references?: { area?: string; count?: number }[] }[];
      }>(`/api/v1/master-data-cleanup/${tab}/bulk-delete`, access, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, adminPassword: bulkDeletePassword, forceHistoryOverride: tab === 'sites' && forceSiteHistoryOverride }),
      });
      const blockedDetail = (result.blockedRows || [])
        .slice(0, 8)
        .map(row => {
          const refs = (row.references || []).map(ref => `${ref.area || 'Reference'}${ref.count ? ` (${ref.count})` : ''}`).join(', ');
          return `${row.label || 'Selected row'}: ${refs || 'live/history reference'}`;
        })
        .join('; ');
      setNotice(`${result.message || `${result.deleted} deleted. ${result.blocked} blocked. ${result.notFound} already removed.`}${blockedDetail ? ` Blocked: ${blockedDetail}` : ''}`);
      setBulkDeleteIds(new Set());
      setForceSiteHistoryOverride(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Bulk delete failed.'); }
    finally { setSaving(false); }
  };

  const tabs = useMemo(() => Object.keys(config) as MasterDataTab[], []);
  const documentEntity = tab === 'sites' ? 'Site' : tab === 'customers' ? 'Customer' : undefined;
  const selectedMissingGeofence = tab === 'sites' && Boolean(selected?.geofenceMissing);

  return <section>
    {showHeading && <div className="title-row"><div><p className="eyebrow">Master data control</p><h1>Edit, archive, delete and audit master data</h1><p>Sites are the physical-location master. Use aliases for planner/customer wording and Sync Sites to assign canonical SITE### codes and validate geofence links.</p></div></div>}
    {showCategoryButtons && <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{tabs.map(key => <button key={key} className={tab === key ? 'primary' : ''} onClick={() => setTab(key)}>{config[key].title}</button>)}</div>}

    {selected && (crmMode ? <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Edit ${current.entityType}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(undefined); }}>
      <div className="crm-modal">
        <div className="crm-modal-header">
          <div><p className="eyebrow">{current.entityType} Master Data record</p><h2>{fmt(selected[current.columns[0][0]])}</h2><p className="hint">{tab === 'sites' ? 'Site is the master physical location. Add every verified address, Roadrunner identity and planner/customer alias here.' : tab === 'customers' ? 'Maintain the full customer master record and supporting documents from one place.' : 'Edit all maintained Master Data fields here. Integration data remains enrichment evidence against this canonical record.'}</p></div>
          <button type="button" onClick={() => setSelected(undefined)}>Close</button>
        </div>
        <div className="crm-modal-body">
          {tab === 'sites' && <section style={selectedMissingGeofence && siteSyncChecked ? { border: '2px solid #b42318', borderRadius: 8, padding: 12, background: '#fff1f0' } : undefined}>
            <h3>Site identity & geofence</h3>
            <p><strong>Canonical code:</strong> {fmt(selected.externalCode)}</p>
            <p><strong>Linked geofence:</strong> {fmt(selected.linkedGeofence)}</p>
            <p><strong>Known aliases:</strong> {fmt(selected.aliases)}</p>
            {selectedMissingGeofence && <p style={{ color: '#b42318', fontWeight: 800 }}>No name-confirmed geofence is linked to this Site. Run Sync Sites, then amend the matching geofence or its Site assignment.</p>}
          </section>}
          <section>
            <h3>Core information</h3>
            <div className="crm-form-grid">
              {current.editable.map(([key,label,type]) => <label key={key}>{label}{type === 'textarea' ? <textarea rows={3} value={String(draft[key] ?? '')} onChange={e => setDraft(v => ({...v,[key]:e.target.value}))} /> : type === 'checkbox' ? <input type="checkbox" checked={Boolean(draft[key])} onChange={e => setDraft(v => ({...v,[key]:e.target.checked}))} /> : type === 'region' ? <select value={String(draft[key] ?? 'Other')} onChange={e => setDraft(v => ({...v,[key]:e.target.value}))}>{regions.map(item => <option key={item}>{item}</option>)}</select> : <input type={type} step={key === 'defaultTemperatureC' ? '0.5' : undefined} value={String(draft[key] ?? '')} onChange={e => setDraft(v => ({...v,[key]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value}))} />}</label>)}
            </div>
          </section>
          {tab === 'sites' && <SiteTimingProfilePanel siteId={selected.id} />}
          <section><h3>Audit</h3>{audit.length ? <div className="crm-audit-list">{audit.slice(0, 8).map(item => <article key={item.id}><strong>{item.action}</strong><span>{isoDate(item.changedAtUtc)}</span><small>{item.changedBy || '—'}</small></article>)}</div> : <p className="hint">No recorded changes yet.</p>}</section>
          {documentEntity && <section className="crm-documents"><MasterDocuments entityType={documentEntity} entityId={selected.id} title={String(selected[current.columns[0][0]] ?? documentEntity)} /></section>}
        </div>
        <div className="crm-modal-actions"><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Master Data record'}</button><button disabled={saving} onClick={() => setSelected(undefined)}>Cancel</button></div>
      </div>
    </div> : <div className="panel" style={{ scrollMarginTop: 90 }}>
      <div className="title-row"><div><p className="eyebrow">Edit {current.entityType}</p><h2>{fmt(selected[current.columns[0][0]])}</h2></div><button onClick={() => setSelected(undefined)}>Close</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
        {current.editable.map(([key,label,type]) => <label key={key}>{label}{type === 'textarea' ? <textarea rows={3} value={String(draft[key] ?? '')} onChange={e => setDraft(v => ({...v,[key]:e.target.value}))} /> : type === 'checkbox' ? <input type="checkbox" checked={Boolean(draft[key])} onChange={e => setDraft(v => ({...v,[key]:e.target.checked}))} /> : type === 'region' ? <select value={String(draft[key] ?? 'Other')} onChange={e => setDraft(v => ({...v,[key]:e.target.value}))}>{regions.map(item => <option key={item}>{item}</option>)}</select> : <input type={type} step={key === 'defaultTemperatureC' ? '0.5' : undefined} value={String(draft[key] ?? '')} onChange={e => setDraft(v => ({...v,[key]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value}))} />}</label>)}
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button><button disabled={saving} onClick={() => setSelected(undefined)}>Cancel</button></div>
      {documentEntity && <MasterDocuments entityType={documentEntity} entityId={selected.id} title={String(selected[current.columns[0][0]] ?? documentEntity)} />}
      <hr/><h3>Change history</h3>{audit.length ? <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Date</th><th>Action</th><th>Changed by</th></tr></thead><tbody>{audit.map(item => <tr key={item.id}><td>{isoDate(item.changedAtUtc)}</td><td>{item.action}</td><td>{item.changedBy || '—'}</td></tr>)}</tbody></table></div> : <p className="hint">No recorded changes yet.</p>}
    </div>)}

    <div className="panel"><div className="title-row"><div><h2>{current.title}</h2><small>{rows.length} record{rows.length === 1 ? '' : 's'} shown</small><p className="hint">{tab === 'sites' ? 'Aliases are operational identity: add every planner/customer variation to the canonical Site. Sync Sites validates physical geofence links; missing links are highlighted red after the check.' : tab === 'customers' ? 'Open CRM on a customer to maintain its SOPs, instructions and supporting Documents.' : 'For duplicates: Archive first. Turn on Include archived, then Delete the unused duplicate. Records with operational history are protected from permanent deletion.'}</p></div><div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}><label>Search<input value={query} onChange={e => setQuery(e.target.value)} placeholder={current.search}/></label><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)}/> Include archived</label>{tab === 'sites' && <button className="primary" onClick={() => void syncSites()} disabled={saving || bulkDeleteMode}>{saving ? 'Syncing…' : 'Sync Sites'}</button>}{tab === 'sites' && <MasterDataExportButton section="sites" label="Sites" rows={rows as unknown as Record<string, unknown>[]} />} {bulkDeleteAvailable && (bulkDeleteMode ? <>{tab === 'sites' && <label style={{ display: 'flex', gap: 6, alignItems: 'center', maxWidth: 260 }}><input type="checkbox" checked={forceSiteHistoryOverride} onChange={event => setForceSiteHistoryOverride(event.target.checked)}/> Detach linked geofences and delete</label>}<button disabled={saving || bulkDeleteIds.size === 0} onClick={() => void bulkDeleteSelected()} style={{ borderColor: '#b42318', color: '#b42318', fontWeight: 800 }}>{forceSiteHistoryOverride && tab === 'sites' ? `Force delete selected (${bulkDeleteIds.size})` : `Delete selected (${bulkDeleteIds.size})`}</button><button disabled={saving} onClick={() => { setBulkDeleteMode(false); setBulkDeletePassword(''); setBulkDeleteIds(new Set()); setForceSiteHistoryOverride(false); }}>Exit delete</button></> : <button disabled={saving} onClick={startBulkDelete}>Mass delete</button>)}<button onClick={() => void load()} disabled={loading}>Refresh</button></div></div>
      {error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}{notice && <p className="notice">{notice}</p>}
      {loading ? <div className="state">Loading {current.title.toLowerCase()}…</div> : <div style={{ overflowX: 'auto' }}><table><thead><tr>{bulkDeleteMode && <th><input type="checkbox" aria-label="Select all visible rows" checked={rows.length > 0 && rows.every(row => bulkDeleteIds.has(row.id))} onChange={event => toggleBulkDeleteAll(event.target.checked)} /></th>}{current.columns.map(([,label]) => <th key={label}>{label}</th>)}<th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(row => {
        const needsGeofence = tab === 'sites' && siteSyncChecked && Boolean(row.geofenceMissing);
        return <tr key={row.id} className={crmMode ? 'crm-click-row' : undefined} style={needsGeofence ? { background: '#fff1f0', boxShadow: 'inset 4px 0 #b42318' } : undefined} onClick={crmMode && !bulkDeleteMode ? () => void openEdit(row) : undefined}>{bulkDeleteMode && <td><input type="checkbox" aria-label={`Select ${fmt(row[current.columns[0][0]])}`} checked={bulkDeleteIds.has(row.id)} onChange={event => toggleBulkDeleteRow(row.id, event.target.checked)} onClick={event => event.stopPropagation()} /></td>}{current.columns.map(([key]) => <td key={key} style={needsGeofence && key === 'linkedGeofence' ? { color: '#b42318', fontWeight: 800 } : undefined}>{key === 'linkedGeofence' && tab === 'sites' && row.active && Boolean(row.geofenceMissing) && !bulkDeleteMode ? <div style={{ display: 'grid', gap: 6, minWidth: 220 }} onClick={event => event.stopPropagation()}><span>{fmtCell(key, row[key])}</span><select aria-label={`Link a geofence to ${fmt(row.name)}`} defaultValue="" disabled={saving || !siteGeofences.length} onChange={event => void linkSiteGeofence(row, event.target.value)}><option value="">Choose geofence…</option>{siteGeofences.map(geofence => <option key={geofence.id} value={geofence.id}>{geofence.name}{geofence.siteNumber ? ` (${geofence.siteNumber})` : ''}</option>)}</select></div> : fmtCell(key, row[key])}</td>)}<td>{needsGeofence ? <strong style={{ color: '#b42318' }}>Needs geofence</strong> : row.active ? 'Active' : 'Archived'}</td><td style={{ whiteSpace: 'nowrap' }}><button onClick={(event) => { event.stopPropagation(); void openEdit(row); }}>Edit</button>{' '}<button onClick={(event) => { event.stopPropagation(); void setActive(row, !row.active); }} disabled={saving || bulkDeleteMode}>{row.active ? 'Archive' : 'Restore'}</button>{!row.active && <>{' '}<button disabled={saving || bulkDeleteMode} onClick={(event) => { event.stopPropagation(); void deleteRecord(row); }} style={{ borderColor: '#b42318', color: '#b42318', fontWeight: 800 }}>Delete</button></>}</td></tr>;
      })}</tbody></table>{rows.length === 0 && <div className="state">No records match this search.</div>}</div>}
    </div>
  </section>;
}
