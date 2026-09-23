import { useState, type ChangeEvent } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type ReviewedImportPayload = {
  counts?: Record<string, number>;
  master_sites?: unknown[];
  site_aliases?: unknown[];
  site_geofences?: unknown[];
  geofence_locations_only?: unknown[];
};

function count(payload: ReviewedImportPayload, key: keyof ReviewedImportPayload) {
  const value = payload[key];
  return Array.isArray(value) ? value.length : 0;
}

export function MasterDataResetImportPanel({ onApplied }: { onApplied: () => void }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [payload, setPayload] = useState<ReviewedImportPayload>();
  const [confirmText, setConfirmText] = useState('');
  const [deleteSites, setDeleteSites] = useState(true);
  const [deleteGeofences, setDeleteGeofences] = useState(true);
  const [deleteAliases, setDeleteAliases] = useState(true);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setMessage(undefined);
    setError(undefined);
    setPayload(undefined);
    setConfirmText('');
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = JSON.parse(await file.text()) as ReviewedImportPayload;
      if (!Array.isArray(parsed.master_sites) || !Array.isArray(parsed.site_geofences) || !Array.isArray(parsed.geofence_locations_only)) {
        throw new Error('Use the reviewed final_master_data_import_pack.json file. It must include master_sites, site_geofences and geofence_locations_only arrays.');
      }
      setPayload(parsed);
      setMessage(`${count(parsed, 'master_sites')} sites, ${count(parsed, 'site_aliases')} aliases, ${count(parsed, 'site_geofences')} linked geofences and ${count(parsed, 'geofence_locations_only')} geofence-only locations ready.`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Could not read the reviewed import JSON.');
    }
  }

  async function apply() {
    if (!payload || confirmText !== 'REBUILD MASTER') return;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await request<{ message?: string; deleted?: Record<string, number>; inserted?: Record<string, number> }>(
        '/api/v1/master-data/rebuild-reviewed-register',
        await token(),
        {
          method: 'POST',
          body: JSON.stringify({
            deleteExisting: {
              sites: deleteSites,
              siteAliases: deleteAliases,
              geofences: deleteGeofences,
            },
            payload,
          }),
        },
        120000,
      );
      const inserted = result.inserted ? Object.entries(result.inserted).map(([key, value]) => `${value} ${key}`).join(' · ') : '';
      setMessage(result.message || `Reviewed master data rebuilt.${inserted ? ` ${inserted}` : ''}`);
      onApplied();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'The TMS API could not rebuild the reviewed master register. The backend may need the rebuild-reviewed-register endpoint deployed first.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="panel master-reset-panel">
    <div className="title-row">
      <div>
        <p className="eyebrow">Reviewed CRM master rebuild</p>
        <h2>Replace Sites, aliases and geofences</h2>
        <p className="hint">Use this only with the reviewed import pack. It asks the API to clear the selected master sections, then create the reviewed CRM master register and location-only geofences.</p>
      </div>
      <button type="button" className={open ? '' : 'primary'} onClick={() => setOpen(value => !value)}>{open ? 'Close rebuild' : 'Open rebuild'}</button>
    </div>

    {open && <div className="master-reset-grid">
      <label>Reviewed import JSON<input type="file" accept="application/json,.json" onChange={(event) => void chooseFile(event)} /></label>
      {fileName && <strong>{fileName}</strong>}
      {payload && <div className="master-reset-options">
        <label><input type="checkbox" checked={deleteSites} onChange={(event) => setDeleteSites(event.target.checked)} /> Delete existing Sites section first</label>
        <label><input type="checkbox" checked={deleteAliases} onChange={(event) => setDeleteAliases(event.target.checked)} /> Delete existing Site alias rows first</label>
        <label><input type="checkbox" checked={deleteGeofences} onChange={(event) => setDeleteGeofences(event.target.checked)} /> Delete existing Master Data geofence rows first</label>
      </div>}
      {payload && <label>Type REBUILD MASTER to confirm<input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="REBUILD MASTER" /></label>}
      {message && <p className="notice ready">{message}</p>}
      {error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}
      <div className="actions">
        <button type="button" className="danger" disabled={!payload || confirmText !== 'REBUILD MASTER' || saving} onClick={() => void apply()}>{saving ? 'Rebuilding…' : 'Delete and rebuild reviewed master'}</button>
      </div>
    </div>}
  </div>;
}
