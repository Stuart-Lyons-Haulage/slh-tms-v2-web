import { useMemo, useRef, useState } from 'react';
import { api, request } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { filterImportSites, importRowsReady, type DotImportDecision, type DotImportRow, type DotImportStatus, type SiteOption } from './DotGeofenceImportLogic';

type Preview = { category?: string | null; total: number; rows: DotImportRow[] };
type ImportResult = { supplied: number; created: number; updated: number; linked: number; skipped: number };

function statusLabel(status: DotImportStatus) {
  return ({
    Matched: 'Matched',
    NeedsLinking: 'Needs linking',
    AlreadyImported: 'Already imported',
    PossibleRename: 'Possible rename',
    Invalid: 'Invalid',
  } as const)[status];
}

function errorText(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}

export function DotGeofenceImport({ onImported }: { onImported: () => void }) {
  const token = useAccessToken();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sourceExport, setSourceExport] = useState<unknown>();
  const [preview, setPreview] = useState<Preview>();
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [decisions, setDecisions] = useState<Record<string, DotImportDecision>>({});
  const [pickerKey, setPickerKey] = useState<string>();
  const [siteQuery, setSiteQuery] = useState('');
  const [createKey, setCreateKey] = useState<string>();
  const [newSiteCode, setNewSiteCode] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteDriverName, setNewSiteDriverName] = useState('');
  const [creatingSite, setCreatingSite] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const counts = useMemo(() => {
    const rows = preview?.rows || [];
    return {
      ready: rows.filter(row => importRowsReady([row], decisions)).length,
      attention: rows.filter(row => row.status !== 'Invalid' && !importRowsReady([row], decisions)).length,
      invalid: rows.filter(row => row.status === 'Invalid').length,
    };
  }, [decisions, preview]);

  function updateDecision(clientKey: string, patch: Partial<DotImportDecision>) {
    setDecisions(current => ({ ...current, [clientKey]: { ...current[clientKey], ...patch } }));
  }

  function resetReview() {
    setFileName('');
    setSourceExport(undefined);
    setPreview(undefined);
    setSites([]);
    setDecisions({});
    setPickerKey(undefined);
    setCreateKey(undefined);
    setMessage(undefined);
    setError(undefined);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function chooseFile(file?: File) {
    if (!file) return;
    setLoading(true); setError(undefined); setMessage(undefined);
    try {
      if (!file.name.toLocaleLowerCase().endsWith('.json')) throw new Error('Choose a DOT geofence export ending in .json.');
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error('This file is not valid JSON. Export the geofence category from DOT Tracking and try again.'); }
      const accessToken = await token();
      const [nextPreview, nextSites] = await Promise.all([
        request<Preview>('/api/v1/geofences/import-falcon/preview', accessToken, { method: 'POST', body: JSON.stringify(parsed) }),
        api.sites(accessToken),
      ]);
      const initialDecisions = Object.fromEntries(nextPreview.rows.map(row => [row.clientKey, {
        ...(row.suggestedSiteId ? { siteId: row.suggestedSiteId } : {}),
      }]));
      setFileName(file.name);
      setSourceExport(parsed);
      setPreview(nextPreview);
      setSites(nextSites);
      setDecisions(initialDecisions);
    } catch (value) {
      setError(errorText(value, 'The DOT geofence export could not be read.'));
    } finally { setLoading(false); }
  }

  function openPicker(row: DotImportRow) {
    setPickerKey(row.clientKey);
    setCreateKey(undefined);
    setSiteQuery('');
    setError(undefined);
  }

  function openCreator(row: DotImportRow) {
    setCreateKey(row.clientKey);
    setPickerKey(undefined);
    setNewSiteCode('');
    setNewSiteName(row.name);
    setNewSiteDriverName(row.name);
    setError(undefined);
  }

  async function createSite() {
    if (!createKey) return;
    const externalCode = newSiteCode.trim();
    const name = newSiteName.trim();
    if (!externalCode || !name) { setError('Site code and site name are required.'); return; }
    setCreatingSite(true); setError(undefined);
    try {
      const accessToken = await token();
      const result = await api.applyMasterData([{
        entityType: 'site',
        idempotencyKey: `dot-geofence-site:${externalCode.toLocaleLowerCase()}`,
        source: 'DOT Geofence Import',
        payload: { externalCode, name, driverTextName: newSiteDriverName.trim() || name, active: true },
      }], accessToken);
      if (result.failed > 0 && result.applied === 0 && !result.registered) {
        throw new Error(result.results?.[0]?.error || 'The Site could not be created.');
      }
      const refreshed = await api.sites(accessToken);
      const created = refreshed.find(site => site.externalCode.trim().toLocaleLowerCase() === externalCode.toLocaleLowerCase());
      if (!created) throw new Error('The Site was saved but could not be selected. Refresh the Sites tab and try linking it.');
      setSites(refreshed);
      updateDecision(createKey, { siteId: created.id, skip: false });
      setCreateKey(undefined);
      setMessage(`${created.externalCode} · ${created.name} was created and selected.`);
    } catch (value) {
      setError(errorText(value, 'The Site could not be created.'));
    } finally { setCreatingSite(false); }
  }

  async function commit() {
    if (!preview || sourceExport === undefined || !importRowsReady(preview.rows, decisions)) return;
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      const result = await request<ImportResult>('/api/v1/geofences/import-falcon/commit', await token(), {
        method: 'POST',
        body: JSON.stringify({
          sourceFileName: fileName,
          export: sourceExport,
          decisions: preview.rows.map(row => ({ clientKey: row.clientKey, ...decisions[row.clientKey] })),
        }),
      });
      setMessage(`${result.supplied} checked: ${result.created} created, ${result.updated} updated, ${result.linked} linked and ${result.skipped} skipped.`);
      onImported();
    } catch (value) {
      setError(errorText(value, 'The import could not be completed. Your review choices have been kept.'));
    } finally { setSaving(false); }
  }

  return <div className="panel" style={{ marginBottom: 18, border: '2px solid #d5e0e4' }}>
    <div className="title-row">
      <div>
        <p className="eyebrow">DOT Tracking</p>
        <h2>Import geofences</h2>
        <p className="hint">Upload the JSON exported from DOT Tracking, then review how every geofence links to Site Master before saving.</p>
      </div>
      <button className="primary" onClick={() => setOpen(true)}>Import DOT Geofences</button>
    </div>

    {open && <div role="dialog" aria-modal="true" aria-label="Import DOT Geofences" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(16, 35, 43, .58)', padding: 24, overflowY: 'auto' }}>
      <div className="panel" style={{ maxWidth: 1180, margin: '24px auto', background: '#fff' }}>
        <div className="title-row">
          <div><p className="eyebrow">Sites · DOT Tracking</p><h2>Import DOT Geofences</h2></div>
          <button onClick={() => setOpen(false)} aria-label="Close DOT geofence import">Close</button>
        </div>

        <div className="actions" style={{ marginBottom: 14 }}>
          <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={event => void chooseFile(event.target.files?.[0])} />
          <button className="primary" disabled={loading || saving} onClick={() => fileInput.current?.click()}>{loading ? 'Checking file…' : preview ? 'Choose another JSON file' : 'Choose DOT JSON file'}</button>
          {fileName && <span className="hint">{fileName}</span>}
        </div>

        {error && <p className="notice inline-notice" role="alert" style={{ borderColor: '#b42318' }}>{error}</p>}
        {message && <p className="notice inline-notice" role="status">{message}</p>}

        {preview && <>
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            <article><strong>{preview.total}</strong><span>Total{preview.category ? ` · ${preview.category}` : ''}</span></article>
            <article><strong>{counts.ready}</strong><span>Ready / skipped</span></article>
            <article><strong>{counts.attention}</strong><span>Needs attention</span></article>
            <article><strong>{counts.invalid}</strong><span>Invalid</span></article>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '52vh', overflowY: 'auto' }}>
            <table>
              <thead><tr><th>DOT geofence</th><th>Status</th><th>Site link</th><th>Action</th></tr></thead>
              <tbody>{preview.rows.map(row => {
                const decision = decisions[row.clientKey] || {};
                const selected = sites.find(site => site.id === (decision.siteId || row.suggestedSiteId));
                const skipped = Boolean(decision.skip);
                return <tr key={`${row.clientKey}-${row.index ?? ''}`} style={{ opacity: skipped ? .55 : 1 }}>
                  <td><strong>{row.name || `Row ${(row.index ?? 0) + 1}`}</strong>{row.error && <div className="hint" style={{ color: '#b42318' }}>{row.error}</div>}</td>
                  <td><span className={`status ${row.status === 'Matched' || row.status === 'AlreadyImported' ? 'approved' : ''}`}>{statusLabel(row.status)}</span></td>
                  <td>{skipped ? 'Skipped' : selected ? `${selected.externalCode} · ${selected.name}` : row.suggestedSiteName || 'Not linked'}</td>
                  <td>
                    <div className="actions">
                      {!skipped && row.status !== 'Invalid' && <button onClick={() => openPicker(row)}>Link to Existing Site</button>}
                      {!skipped && row.status !== 'Invalid' && <button onClick={() => openCreator(row)}>Create New Site</button>}
                      <button onClick={() => updateDecision(row.clientKey, { skip: !skipped })}>{skipped ? 'Include' : 'Skip'}</button>
                    </div>
                    {!skipped && row.status === 'PossibleRename' && <label className="check-label" style={{ marginTop: 8 }}>
                      <input type="checkbox" checked={decision.confirmRenameGeofenceId === row.possibleRenameGeofenceId} onChange={event => updateDecision(row.clientKey, { confirmRenameGeofenceId: event.target.checked ? row.possibleRenameGeofenceId || undefined : undefined })} /> Confirm this is the renamed existing geofence
                    </label>}
                  </td>
                </tr>;
              })}</tbody>
            </table>
          </div>

          {pickerKey && <div className="panel" style={{ marginTop: 14, border: '2px solid #8ba4ae' }}>
            <div className="title-row"><div><p className="eyebrow">Link to existing Site</p><h3>{preview.rows.find(row => row.clientKey === pickerKey)?.name}</h3></div><button onClick={() => setPickerKey(undefined)}>Cancel</button></div>
            <label>Search by Site code or name<input autoFocus value={siteQuery} onChange={event => setSiteQuery(event.target.value)} placeholder="Start typing…" /></label>
            <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 10 }}>
              {filterImportSites(sites, siteQuery).map(site => <button key={site.id} style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }} onClick={() => { updateDecision(pickerKey, { siteId: site.id, skip: false }); setPickerKey(undefined); }}>{site.externalCode} · {site.name}</button>)}
              {filterImportSites(sites, siteQuery).length === 0 && <p className="hint">No active Sites match that search.</p>}
            </div>
          </div>}

          {createKey && <div className="panel" style={{ marginTop: 14, border: '2px solid #8ba4ae' }}>
            <div className="title-row"><div><p className="eyebrow">Create and link Site</p><h3>{preview.rows.find(row => row.clientKey === createKey)?.name}</h3></div><button onClick={() => setCreateKey(undefined)}>Cancel</button></div>
            <div className="form-grid">
              <label>Site code<input autoFocus value={newSiteCode} onChange={event => setNewSiteCode(event.target.value)} /></label>
              <label>Site name<input value={newSiteName} onChange={event => setNewSiteName(event.target.value)} /></label>
              <label>Driver text name<input value={newSiteDriverName} onChange={event => setNewSiteDriverName(event.target.value)} /></label>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="primary" disabled={creatingSite} onClick={() => void createSite()}>{creatingSite ? 'Creating Site…' : 'Create Site and link'}</button></div>
          </div>}

          <div className="actions" style={{ marginTop: 16 }}>
            <button className="primary" disabled={saving || !importRowsReady(preview.rows, decisions)} onClick={() => void commit()}>{saving ? 'Importing…' : 'Import and Update'}</button>
            <button disabled={saving} onClick={resetReview}>Clear review</button>
            {!importRowsReady(preview.rows, decisions) && <span className="hint">Link or skip every row requiring attention before importing.</span>}
          </div>
        </>}
      </div>
    </div>}
  </div>;
}
