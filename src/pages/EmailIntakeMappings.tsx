import { useCallback, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';

type SenderMapping = { id: string; customerCode: string; emailAddress?: string; emailDomain?: string; subjectContains?: string; parserType?: string; requiresReview: boolean; active: boolean };
type RouteRule = { id: string; customerCode: string; originSiteCode?: string; originSiteName?: string; retailerCode?: string; destinationSiteCode?: string; destinationCode?: string; destinationName?: string; destinationPostcode?: string; priority: number; confidenceScore: number; active: boolean; effectiveFrom?: string; effectiveTo?: string; notes?: string };
const emptyMapping = { customerCode: '', emailAddress: '', emailDomain: '', subjectContains: '', parserType: '', requiresReview: true };
const emptyRule = { customerCode: '', originSiteCode: '', originSiteName: '', retailerCode: '', destinationSiteCode: '', destinationCode: '', destinationName: '', destinationPostcode: '', priority: 100, confidenceScore: 80, notes: '' };
const clean = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item.trim() || undefined : item])) as T;

export function EmailIntakeMappings() {
  const token = useAccessToken();
  const mappings = useApi(useCallback(async () => request<SenderMapping[]>('/api/v1/customer-email-mappings', await token()), [token]));
  const rules = useApi(useCallback(async () => request<RouteRule[]>('/api/v1/order-intake-route-rules', await token()), [token]));
  const [mapping, setMapping] = useState(emptyMapping);
  const [rule, setRule] = useState(emptyRule);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  async function saveMapping() {
    setSaving(true); setMessage(undefined);
    try {
      await request('/api/v1/customer-email-mappings', await token(), { method: 'POST', body: JSON.stringify(clean(mapping)) });
      setMapping(emptyMapping); await mappings.refresh(); setMessage('Sender mapping saved to the SQL master. It identifies a customer only; it does not imply a route.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sender mapping could not be saved.'); } finally { setSaving(false); }
  }
  async function saveRule() {
    setSaving(true); setMessage(undefined);
    try {
      await request('/api/v1/order-intake-route-rules', await token(), { method: 'POST', body: JSON.stringify(clean(rule)) });
      setRule(emptyRule); await rules.refresh(); setMessage('Route rule saved to SQL. Matching emails will still enter planner review.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Route rule could not be saved.'); } finally { setSaving(false); }
  }
  async function deactivate(path: string) {
    if (!window.confirm('Deactivate this mapping? Historical intake evidence will be retained.')) return;
    try { await request(path, await token(), { method: 'DELETE' }); await Promise.all([mappings.refresh(), rules.refresh()]); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The mapping could not be deactivated.'); }
  }
  return <section>
    <div className="title-row"><div><p className="eyebrow">Staged email order controls</p><h1>Email intake mappings</h1><p className="intro">SQL is the single mapping authority. Every email-derived order remains in Staging Review until an authorised planner approves it.</p></div><button onClick={() => void Promise.all([mappings.refresh(), rules.refresh()])}>Refresh</button></div>
    {message && <p className="notice inline-notice">{message}</p>}
    <div className="panel" style={{ marginBottom: 18 }}><h2>Add sender/customer mapping</h2><p className="hint">Use an exact sender or domain to identify the SQL customer. Add a subject condition only when the sender is genuinely used for different customer work.</p><div className="form-grid"><label>Customer code<input value={mapping.customerCode} onChange={e => setMapping({ ...mapping, customerCode: e.target.value })} /></label><label>Sender email<input type="email" value={mapping.emailAddress} onChange={e => setMapping({ ...mapping, emailAddress: e.target.value })} /></label><label>Sender domain<input value={mapping.emailDomain} onChange={e => setMapping({ ...mapping, emailDomain: e.target.value })} placeholder="customer.co.uk" /></label><label>Subject contains<input value={mapping.subjectContains} onChange={e => setMapping({ ...mapping, subjectContains: e.target.value })} /></label><label>Parser type<input value={mapping.parserType} onChange={e => setMapping({ ...mapping, parserType: e.target.value })} /></label><label><input type="checkbox" checked={mapping.requiresReview} onChange={e => setMapping({ ...mapping, requiresReview: e.target.checked })} /> Require review</label></div><button className="primary" disabled={saving || !mapping.customerCode || (!mapping.emailAddress && !mapping.emailDomain)} onClick={() => void saveMapping()}>Save sender mapping</button></div>
    <div className="panel" style={{ marginBottom: 18 }}><h2>Add route rule</h2><p className="hint">Rules fill only missing route values after sender matching. Tied, weak or conflicting matches stay reviewable.</p><div className="form-grid"><label>Customer code<input value={rule.customerCode} onChange={e => setRule({ ...rule, customerCode: e.target.value })} /></label><label>Origin site code<input value={rule.originSiteCode} onChange={e => setRule({ ...rule, originSiteCode: e.target.value })} /></label><label>Origin site name<input value={rule.originSiteName} onChange={e => setRule({ ...rule, originSiteName: e.target.value })} /></label><label>Retailer<input value={rule.retailerCode} onChange={e => setRule({ ...rule, retailerCode: e.target.value })} /></label><label>Destination code<input value={rule.destinationCode} onChange={e => setRule({ ...rule, destinationCode: e.target.value })} /></label><label>Destination name<input value={rule.destinationName} onChange={e => setRule({ ...rule, destinationName: e.target.value })} /></label><label>Priority<input type="number" value={rule.priority} onChange={e => setRule({ ...rule, priority: Number(e.target.value) })} /></label><label>Confidence %<input type="number" min="0" max="100" value={rule.confidenceScore} onChange={e => setRule({ ...rule, confidenceScore: Number(e.target.value) })} /></label><label className="wide">Notes<input value={rule.notes} onChange={e => setRule({ ...rule, notes: e.target.value })} /></label></div><button className="primary" disabled={saving || !rule.customerCode} onClick={() => void saveRule()}>Save route rule</button></div>
    <div className="master-table-wrap" style={{ overflowX: 'auto', marginBottom: 18 }}><h2>Active sender mappings</h2><table className="master-table"><thead><tr><th>Customer</th><th>Sender</th><th>Subject</th><th>Review</th><th /></tr></thead><tbody>{(mappings.data || []).map(row => <tr key={row.id}><td>{row.customerCode}</td><td>{row.emailAddress || `@${row.emailDomain}`}</td><td>{row.subjectContains || 'Any'}</td><td>{row.requiresReview ? 'Required' : 'Normal staging'}</td><td><button onClick={() => void deactivate(`/api/v1/customer-email-mappings/${row.id}`)}>Deactivate</button></td></tr>)}</tbody></table></div>
    <div className="master-table-wrap" style={{ overflowX: 'auto' }}><h2>Active route rules</h2><table className="master-table"><thead><tr><th>Customer</th><th>Origin</th><th>Retailer</th><th>Destination</th><th>Confidence</th><th /></tr></thead><tbody>{(rules.data || []).map(row => <tr key={row.id}><td>{row.customerCode}</td><td>{row.originSiteCode || row.originSiteName || 'Any'}</td><td>{row.retailerCode || 'Any'}</td><td>{row.destinationCode || row.destinationName || 'Any'}</td><td>{row.confidenceScore}%</td><td><button onClick={() => void deactivate(`/api/v1/order-intake-route-rules/${row.id}`)}>Deactivate</button></td></tr>)}</tbody></table></div>
  </section>;
}
