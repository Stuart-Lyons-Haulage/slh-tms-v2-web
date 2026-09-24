import { useCallback, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type DuplicateRecord = {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  postcode?: string | null;
  active: boolean;
  fields: Record<string, unknown>;
};

type DuplicateCandidate = {
  candidateId: string;
  entityType: string;
  confidence: number;
  reason: string;
  canAutoMerge: boolean;
  canonical: DuplicateRecord;
  duplicates: DuplicateRecord[];
  preservedFields: string[];
};

type DuplicateEntityType = 'sites' | 'drivers' | 'vehicles' | 'trailers' | 'markets';
type MergeResult = { merged: number; reviewed: number; messages: string[] };

function fieldValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function MasterDataDuplicateReviewPanel({ entityType = 'sites', inline = false }: { entityType?: DuplicateEntityType; inline?: boolean }) {
  const token = useAccessToken();
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const access = await token();
      const rows = await request<DuplicateCandidate[]>(`/api/v2/operational-master-data/duplicates?entityType=${encodeURIComponent(entityType)}`, access, { cache: 'no-store' });
      setCandidates(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Duplicate check failed.');
    }
  }, [entityType, token]);


  async function merge(candidate: DuplicateCandidate) {
    if (!window.confirm(`Merge ${candidate.duplicates.length} duplicate record(s) into ${candidate.canonical.name}?\n\nAddress, map, geofence and routing fields will be preserved and blanks will not overwrite good data.`)) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const result = await request<MergeResult>(`/api/v2/operational-master-data/duplicates/${candidate.entityType}/merge`, await token(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonicalId: candidate.canonical.id, duplicateIds: candidate.duplicates.map(row => row.id), note: 'Planner duplicate review popup merge' }),
      }, 30000);
      setNotice(result.messages.join(' ') || `${result.merged} duplicate(s) merged.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Merge failed.'); }
    finally { setBusy(false); }
  }

  async function reject(candidate: DuplicateCandidate) {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      await request('/api/v2/operational-master-data/duplicates/reject', await token(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.candidateId, entityType: candidate.entityType, note: 'Planner kept separate from duplicate review popup' }),
      });
      setNotice('Duplicate candidate marked as reviewed/kept separate.');
      setCandidates(rows => rows.filter(row => row.candidateId !== candidate.candidateId));
    } catch (err) { setError(err instanceof Error ? err.message : 'Reject failed.'); }
    finally { setBusy(false); }
  }

  const label = entityType === 'sites' ? 'Sites' : entityType === 'drivers' ? 'Drivers' : entityType === 'vehicles' ? 'Vehicles' : entityType === 'trailers' ? 'Trailers' : 'Markets';

  const controls = <div className="duplicate-control-actions">
    <button onClick={() => void load()} disabled={busy}>{busy ? 'Scanning…' : `Scan ${label}`}</button>
    <button className="primary" onClick={() => setOpen(true)} disabled={!candidates.length || busy}>Review Duplicates{candidates.length > 0 ? <span className="duplicate-count" aria-label={`${candidates.length} duplicate candidates`}>{candidates.length}</span> : null}</button>
  </div>;

  const feedback = <>{error && <p className="notice" style={{ borderColor: '#b42318' }}>{error}</p>}{notice && <p className="notice">{notice}</p>}</>;
  const modal = open && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Review duplicate master data" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
    <div className="crm-modal">
      <div className="crm-modal-header">
        <div><p className="eyebrow">Duplicate review popup</p><h2>Review and merge duplicate master data</h2><p className="hint">Merging keeps the canonical SQL record, fills missing fields from the duplicate, relinks geofences/integration mappings where supported, archives the duplicate and writes an audit entry.</p></div>
        <button type="button" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="crm-modal-body">
        {candidates.length === 0 ? <div className="state">No duplicate candidates are currently waiting for review.</div> : candidates.map(candidate => <section key={candidate.candidateId} style={{ border: '1px solid #d0d5dd', borderRadius: 10, padding: 12 }}>
          <div className="title-row"><div><h3>{candidate.canonical.name}</h3><p className="hint">{candidate.reason} Confidence {candidate.confidence}% · {candidate.canAutoMerge ? 'Safe for auto-merge' : 'Manual review required'}</p></div><span className={candidate.canAutoMerge ? 'status approved' : 'status warning'}>{candidate.canAutoMerge ? 'Auto-safe' : 'Review'}</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table><thead><tr><th>Role</th><th>Code</th><th>Name</th><th>Address</th><th>Postcode</th><th>Key fields</th></tr></thead><tbody>
              <tr><td><strong>Keep</strong></td><td>{candidate.canonical.code}</td><td>{candidate.canonical.name}</td><td>{fieldValue(candidate.canonical.address)}</td><td>{fieldValue(candidate.canonical.postcode)}</td><td>{Object.entries(candidate.canonical.fields).map(([key, value]) => `${key}: ${fieldValue(value)}`).join(' · ')}</td></tr>
              {candidate.duplicates.map(row => <tr key={row.id}><td><strong>Merge/archive</strong></td><td>{row.code}</td><td>{row.name}</td><td>{fieldValue(row.address)}</td><td>{fieldValue(row.postcode)}</td><td>{Object.entries(row.fields).map(([key, value]) => `${key}: ${fieldValue(value)}`).join(' · ')}</td></tr>)}
            </tbody></table>
          </div>
          <p className="hint"><strong>Preserved:</strong> {candidate.preservedFields.join(', ')}</p>
          <div className="crm-modal-actions"><button className="primary" disabled={busy} onClick={() => void merge(candidate)}>Merge into canonical</button><button disabled={busy} onClick={() => void reject(candidate)}>Keep separate</button></div>
        </section>)}
      </div>
      <div className="crm-modal-actions"><button disabled={busy} onClick={() => setOpen(false)}>Close</button></div>
    </div>
  </div>;

  if (inline) return <div className="duplicate-control-inline">{controls}{feedback}{modal}</div>;

  return <div className="duplicate-control" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px', flexWrap: 'wrap' }}>
    <div className="title-row"><strong>Duplicate Control</strong>{controls}</div>
    {feedback}
    {modal}
  </div>;
}
