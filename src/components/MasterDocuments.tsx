import { useCallback, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';

type MasterDocument = {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  documentType: string;
  description?: string;
  storageUrl: string;
  storageItemId?: string;
  expiryOrReviewDate?: string;
  active: boolean;
  createdAtUtc: string;
  createdBy?: string;
  updatedAtUtc: string;
  updatedBy?: string;
};

type Draft = { fileName: string; documentType: string; description: string; storageUrl: string; expiryOrReviewDate: string };
const empty: Draft = { fileName: '', documentType: 'Other', description: '', storageUrl: '', expiryOrReviewDate: '' };

export function MasterDocuments({ entityType, entityId, title }: { entityType: 'Site' | 'Customer' | 'Driver'; entityId: string; title: string }) {
  const token = useAccessToken();
  const [draft, setDraft] = useState<Draft>(empty);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string>();
  const documents = useApi(useCallback(async () => request<MasterDocument[]>(`/api/v1/master-documents/${entityType}/${entityId}`, await token()), [entityId, entityType, token]));

  async function add() {
    if (!draft.fileName.trim() || !draft.storageUrl.trim()) { setMessage('File name and SharePoint/OneDrive link are required.'); return; }
    setAdding(true); setMessage(undefined);
    try {
      await request(`/api/v1/master-documents/${entityType}/${entityId}`, await token(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          fileName: draft.fileName.trim(), documentType: draft.documentType.trim() || 'Other', description: draft.description.trim() || null,
          storageUrl: draft.storageUrl.trim(), storageItemId: null, expiryOrReviewDate: draft.expiryOrReviewDate || null,
        })
      });
      setDraft(empty); setMessage('Document added to the TMS library.'); await documents.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Document could not be added.'); }
    finally { setAdding(false); }
  }

  async function archive(id: string) {
    if (!window.confirm('Archive this document entry? The SharePoint/OneDrive file will be retained.')) return;
    try { await request(`/api/v1/master-documents/${id}/archive`, await token(), { method: 'POST' }); await documents.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Document could not be archived.'); }
  }

  return <div className="panel" style={{ marginTop: 16 }}>
    <div className="title-row"><div><p className="eyebrow">Documents</p><h3>{title} document library</h3><p className="hint">Files remain in SharePoint/OneDrive; the TMS keeps the operational index, notes and review/expiry date.</p></div></div>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:10 }}>
      <label>File name<input value={draft.fileName} onChange={e=>setDraft(v=>({...v,fileName:e.target.value}))} placeholder="e.g. Access map.pdf" /></label>
      <label>Document type<input value={draft.documentType} onChange={e=>setDraft(v=>({...v,documentType:e.target.value}))} placeholder="SOP, Licence, CPC, RAMS…" /></label>
      <label>Review / expiry date<input type="date" value={draft.expiryOrReviewDate} onChange={e=>setDraft(v=>({...v,expiryOrReviewDate:e.target.value}))} /></label>
      <label style={{ gridColumn:'1 / -1' }}>SharePoint / OneDrive link<input value={draft.storageUrl} onChange={e=>setDraft(v=>({...v,storageUrl:e.target.value}))} placeholder="https://..." /></label>
      <label style={{ gridColumn:'1 / -1' }}>Notes<textarea rows={2} value={draft.description} onChange={e=>setDraft(v=>({...v,description:e.target.value}))} /></label>
    </div>
    <div style={{ marginTop:10 }}><button className="primary" disabled={adding} onClick={()=>void add()}>{adding ? 'Adding…' : 'Add document'}</button></div>
    {message && <p className="notice inline-notice">{message}</p>}
    {documents.error && <p className="notice inline-notice">{documents.error}</p>}
    <div style={{ overflowX:'auto', marginTop:12 }}><table><thead><tr><th>Document</th><th>Type</th><th>Notes</th><th>Review / expiry</th><th>Added</th><th></th></tr></thead>
      <tbody>{(documents.data || []).map(doc => <tr key={doc.id}>
        <td><a href={doc.storageUrl} target="_blank" rel="noreferrer"><strong>{doc.fileName}</strong></a></td>
        <td>{doc.documentType}</td><td>{doc.description || '—'}</td><td>{doc.expiryOrReviewDate || '—'}</td>
        <td>{new Date(doc.createdAtUtc).toLocaleDateString('en-GB')}<br/><small>{doc.createdBy || '—'}</small></td>
        <td><button onClick={()=>void archive(doc.id)}>Archive</button></td>
      </tr>)}</tbody></table>{!documents.loading && !(documents.data || []).length && <p className="hint">No documents linked yet.</p>}</div>
  </div>;
}
