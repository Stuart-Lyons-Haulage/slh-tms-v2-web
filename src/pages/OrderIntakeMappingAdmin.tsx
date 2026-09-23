import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, request, type Customer } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';

type Mapping = {
  id: string;
  customerCode: string;
  emailAddress?: string;
  emailDomain?: string;
  subjectContains?: string;
  parserType?: string;
  requiresReview: boolean;
  active: boolean;
};

type RouteRule = {
  id: string;
  customerCode: string;
  originSiteCode?: string;
  originSiteName?: string;
  retailerCode?: string;
  destinationSiteCode?: string;
  destinationCode?: string;
  destinationName?: string;
  destinationPostcode?: string;
  priority: number;
  confidenceScore: number;
  active: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
};

type MappingDraft = Omit<Mapping, 'id'>;
type RuleDraft = Omit<RouteRule, 'id'>;

const emptyMapping: MappingDraft = {
  customerCode: '', emailAddress: '', emailDomain: '', subjectContains: '', parserType: '', requiresReview: true, active: true,
};
const emptyRule: RuleDraft = {
  customerCode: '', originSiteCode: '', originSiteName: '', retailerCode: '', destinationSiteCode: '', destinationCode: '',
  destinationName: '', destinationPostcode: '', priority: 100, confidenceScore: 80, active: true, effectiveFrom: '', effectiveTo: '', notes: '',
};

function clean(value?: string) { return String(value || '').trim(); }
function customerLabel(customer: Customer) { return `${customer.code} · ${customer.name}`; }

export function OrderIntakeMappingAdmin() {
  const token = useAccessToken();
  const customers = useApi(useCallback(async () => api.customers(await token()), [token]));
  const [mode, setMode] = useState<'mappings' | 'rules'>('mappings');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [rules, setRules] = useState<RouteRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [mappingId, setMappingId] = useState<string>();
  const [mappingEditorOpen, setMappingEditorOpen] = useState(false);
  const [mappingDraft, setMappingDraft] = useState<MappingDraft>(emptyMapping);
  const [ruleId, setRuleId] = useState<string>();
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(emptyRule);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  const customerOptions = useMemo(() => (customers.data || []).filter(customer => customer.active).sort((a, b) => a.code.localeCompare(b.code)), [customers.data]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(undefined);
    try {
      const access = await token();
      const [mappingRows, ruleRows] = await Promise.all([
        request<Mapping[]>('/api/v1/customer-email-mappings?includeInactive=true', access),
        request<RouteRule[]>('/api/v1/order-intake-route-rules?includeInactive=true', access),
      ]);
      setMappings(mappingRows);
      setRules(ruleRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Intake mapping data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const visibleMappings = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return mappings;
    return mappings.filter(row => [row.customerCode, row.emailAddress, row.emailDomain, row.subjectContains, row.parserType].some(value => clean(value).toLowerCase().includes(needle)));
  }, [mappings, filter]);

  const visibleRules = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rules;
    return rules.filter(row => [row.customerCode, row.originSiteCode, row.originSiteName, row.retailerCode, row.destinationSiteCode, row.destinationCode, row.destinationName, row.destinationPostcode].some(value => clean(value).toLowerCase().includes(needle)));
  }, [rules, filter]);

  const ruleHasDimension = [ruleDraft.originSiteCode, ruleDraft.originSiteName, ruleDraft.retailerCode, ruleDraft.destinationSiteCode, ruleDraft.destinationCode, ruleDraft.destinationName, ruleDraft.destinationPostcode].some(value => clean(value));

  async function saveMapping() {
    if (!clean(mappingDraft.customerCode) || (!clean(mappingDraft.emailAddress) && !clean(mappingDraft.emailDomain))) return;
    setSaving(true); setMessage(undefined);
    try {
      const access = await token();
      const path = mappingId ? `/api/v1/customer-email-mappings/${mappingId}` : '/api/v1/customer-email-mappings';
      await request(path, access, { method: mappingId ? 'PATCH' : 'POST', body: JSON.stringify(mappingDraft) });
      setMappingId(undefined); setMappingEditorOpen(false); setMappingDraft(emptyMapping);
      await load();
      setMessage('Email mapping saved to SQL.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Email mapping could not be saved.');
    } finally { setSaving(false); }
  }

  async function saveRule() {
    if (!clean(ruleDraft.customerCode) || !ruleHasDimension) return;
    setSaving(true); setMessage(undefined);
    try {
      const access = await token();
      const path = ruleId ? `/api/v1/order-intake-route-rules/${ruleId}` : '/api/v1/order-intake-route-rules';
      const payload = {
        ...ruleDraft,
        effectiveFrom: clean(ruleDraft.effectiveFrom) || null,
        effectiveTo: clean(ruleDraft.effectiveTo) || null,
      };
      await request(path, access, { method: ruleId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setRuleId(undefined); setRuleEditorOpen(false); setRuleDraft(emptyRule);
      await load();
      setMessage('Route rule saved to SQL.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Route rule could not be saved.');
    } finally { setSaving(false); }
  }

  async function deactivate(kind: 'mapping' | 'rule', id: string) {
    setSaving(true); setMessage(undefined);
    try {
      const access = await token();
      await request(kind === 'mapping' ? `/api/v1/customer-email-mappings/${id}` : `/api/v1/order-intake-route-rules/${id}`, access, { method: 'DELETE' });
      await load();
      setMessage(kind === 'mapping' ? 'Email mapping deactivated.' : 'Route rule deactivated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Record could not be deactivated.');
    } finally { setSaving(false); }
  }

  function editMapping(row: Mapping) {
    setMappingId(row.id);
    setMappingDraft({ customerCode: row.customerCode, emailAddress: row.emailAddress || '', emailDomain: row.emailDomain || '', subjectContains: row.subjectContains || '', parserType: row.parserType || '', requiresReview: row.requiresReview, active: row.active });
    setMode('mappings'); setMappingEditorOpen(true); setMessage(undefined);
  }

  function editRule(row: RouteRule) {
    setRuleId(row.id);
    setRuleDraft({ customerCode: row.customerCode, originSiteCode: row.originSiteCode || '', originSiteName: row.originSiteName || '', retailerCode: row.retailerCode || '', destinationSiteCode: row.destinationSiteCode || '', destinationCode: row.destinationCode || '', destinationName: row.destinationName || '', destinationPostcode: row.destinationPostcode || '', priority: row.priority, confidenceScore: row.confidenceScore, active: row.active, effectiveFrom: row.effectiveFrom || '', effectiveTo: row.effectiveTo || '', notes: row.notes || '' });
    setMode('rules'); setRuleEditorOpen(true); setMessage(undefined);
  }

  return <div>
    <div className="title-row">
      <div><p className="eyebrow">SQL intake control</p><h1>Email mappings &amp; route rules</h1></div>
      <button type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
    </div>
    <p className="intro">Sender mappings identify the customer. Route rules then use customer, origin, retailer and destination evidence. Generic senders do not create route assumptions.</p>

    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="horizontal-tabs" role="tablist" aria-label="Intake mapping sections">
        <button role="tab" aria-selected={mode === 'mappings'} className={mode === 'mappings' ? 'primary' : ''} onClick={() => setMode('mappings')}>Email mappings <span>{mappings.filter(row => row.active).length}</span></button>
        <button role="tab" aria-selected={mode === 'rules'} className={mode === 'rules' ? 'primary' : ''} onClick={() => setMode('rules')}>Route rules <span>{rules.filter(row => row.active).length}</span></button>
      </div>
      <div className="form-grid" style={{ marginTop: 14 }}><label>Filter<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Customer, sender, site, depot…" /></label></div>
    </section>

    {message && <p className="notice inline-notice">{message}</p>}
    {loading && <div className="state">Loading SQL intake rules…</div>}

    {!loading && mode === 'mappings' && <>
      <section className="panel" style={{ marginBottom: 18 }}><div className="title-row"><div><p className="eyebrow">Sender identity master</p><h2>Email mappings</h2><p className="hint">Maintain sender-to-customer identity in a controlled pop-out editor.</p></div><button className="primary" onClick={() => { setMappingId(undefined); setMappingDraft(emptyMapping); setMappingEditorOpen(true); }}>Add mapping</button></div></section>
      <div className="master-table-wrap"><table className="master-table"><thead><tr><th>Customer</th><th>Email</th><th>Domain</th><th>Subject</th><th>Review</th><th>Active</th><th>Action</th></tr></thead><tbody>{visibleMappings.map(row => <tr key={row.id}><td>{row.customerCode}</td><td>{row.emailAddress || '—'}</td><td>{row.emailDomain || '—'}</td><td>{row.subjectContains || '—'}</td><td>{row.requiresReview ? 'Yes' : 'No'}</td><td>{row.active ? 'Yes' : 'No'}</td><td><div className="actions"><button onClick={() => editMapping(row)}>Edit</button>{row.active && <button disabled={saving} onClick={() => void deactivate('mapping', row.id)}>Deactivate</button>}</div></td></tr>)}</tbody></table></div>
      {mappingEditorOpen && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit email mapping" onMouseDown={event => { if (event.target === event.currentTarget && !saving) { setMappingEditorOpen(false); setMappingId(undefined); setMappingDraft(emptyMapping); } }}>
        <div className="crm-modal">
          <div className="crm-modal-header"><div><p className="eyebrow">{mappingId ? 'Edit' : 'Add'} Master Data mapping</p><h2>Sender → customer</h2></div><button disabled={saving} onClick={() => { setMappingEditorOpen(false); setMappingId(undefined); setMappingDraft(emptyMapping); }}>Close</button></div>
          <div className="crm-modal-body"><section><h3>Mapping details</h3><div className="crm-form-grid">
            <label>Customer<select value={mappingDraft.customerCode} onChange={event => setMappingDraft({ ...mappingDraft, customerCode: event.target.value })}><option value="">Select customer…</option>{customerOptions.map(customer => <option key={customer.id} value={customer.code}>{customerLabel(customer)}</option>)}</select></label>
            <label>Exact sender email<input value={mappingDraft.emailAddress || ''} onChange={event => setMappingDraft({ ...mappingDraft, emailAddress: event.target.value })} placeholder="planner@customer.co.uk" /></label>
            <label>Sender domain<input value={mappingDraft.emailDomain || ''} onChange={event => setMappingDraft({ ...mappingDraft, emailDomain: event.target.value })} placeholder="customer.co.uk" /></label>
            <label>Subject contains<input value={mappingDraft.subjectContains || ''} onChange={event => setMappingDraft({ ...mappingDraft, subjectContains: event.target.value })} /></label>
            <label>Parser type<input value={mappingDraft.parserType || ''} onChange={event => setMappingDraft({ ...mappingDraft, parserType: event.target.value })} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={mappingDraft.requiresReview} onChange={event => setMappingDraft({ ...mappingDraft, requiresReview: event.target.checked })} /> Requires planner review</label>
            <label className="checkbox-label"><input type="checkbox" checked={mappingDraft.active} onChange={event => setMappingDraft({ ...mappingDraft, active: event.target.checked })} /> Active</label>
          </div></section></div>
          <div className="crm-modal-actions"><button className="primary" disabled={saving || !clean(mappingDraft.customerCode) || (!clean(mappingDraft.emailAddress) && !clean(mappingDraft.emailDomain))} onClick={() => void saveMapping()}>{saving ? 'Saving…' : 'Save Master Data mapping'}</button><button disabled={saving} onClick={() => { setMappingEditorOpen(false); setMappingId(undefined); setMappingDraft(emptyMapping); }}>Cancel</button></div>
        </div>
      </div>}
    </>}

    {!loading && mode === 'rules' && <>
      <section className="panel" style={{ marginBottom: 18 }}><div className="title-row"><div><p className="eyebrow">Route identity master</p><h2>Evidence → route rules</h2><p className="hint">Maintain route evidence in a controlled pop-out editor.</p></div><button className="primary" onClick={() => { setRuleId(undefined); setRuleDraft(emptyRule); setRuleEditorOpen(true); }}>Add route rule</button></div></section>
      <div className="master-table-wrap"><table className="master-table"><thead><tr><th>Customer</th><th>Origin</th><th>Retailer</th><th>Destination</th><th>Priority</th><th>Confidence</th><th>Active</th><th>Action</th></tr></thead><tbody>{visibleRules.map(row => <tr key={row.id}><td>{row.customerCode}</td><td>{row.originSiteCode || row.originSiteName || '—'}</td><td>{row.retailerCode || '—'}</td><td>{row.destinationCode || row.destinationSiteCode || row.destinationName || row.destinationPostcode || '—'}</td><td>{row.priority}</td><td>{row.confidenceScore}%</td><td>{row.active ? 'Yes' : 'No'}</td><td><div className="actions"><button onClick={() => editRule(row)}>Edit</button>{row.active && <button disabled={saving} onClick={() => void deactivate('rule', row.id)}>Deactivate</button>}</div></td></tr>)}</tbody></table></div>
      {ruleEditorOpen && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit route rule" onMouseDown={event => { if (event.target === event.currentTarget && !saving) { setRuleEditorOpen(false); setRuleId(undefined); setRuleDraft(emptyRule); } }}>
        <div className="crm-modal">
          <div className="crm-modal-header"><div><p className="eyebrow">{ruleId ? 'Edit' : 'Add'} Master Data route rule</p><h2>Evidence → route</h2></div><button disabled={saving} onClick={() => { setRuleEditorOpen(false); setRuleId(undefined); setRuleDraft(emptyRule); }}>Close</button></div>
          <div className="crm-modal-body"><section><h3>Route evidence</h3><div className="crm-form-grid">
            <label>Customer<select value={ruleDraft.customerCode} onChange={event => setRuleDraft({ ...ruleDraft, customerCode: event.target.value })}><option value="">Select customer…</option>{customerOptions.map(customer => <option key={customer.id} value={customer.code}>{customerLabel(customer)}</option>)}</select></label>
            <label>Origin site code<input value={ruleDraft.originSiteCode || ''} onChange={event => setRuleDraft({ ...ruleDraft, originSiteCode: event.target.value })} /></label>
            <label>Origin site name<input value={ruleDraft.originSiteName || ''} onChange={event => setRuleDraft({ ...ruleDraft, originSiteName: event.target.value })} /></label>
            <label>Retailer code<input value={ruleDraft.retailerCode || ''} onChange={event => setRuleDraft({ ...ruleDraft, retailerCode: event.target.value })} placeholder="ALDI / MORRISONS / WAITROSE" /></label>
            <label>Destination site code<input value={ruleDraft.destinationSiteCode || ''} onChange={event => setRuleDraft({ ...ruleDraft, destinationSiteCode: event.target.value })} /></label>
            <label>Destination/depot code<input value={ruleDraft.destinationCode || ''} onChange={event => setRuleDraft({ ...ruleDraft, destinationCode: event.target.value })} placeholder="ALD20 / MOR06" /></label>
            <label>Destination name<input value={ruleDraft.destinationName || ''} onChange={event => setRuleDraft({ ...ruleDraft, destinationName: event.target.value })} /></label>
            <label>Destination postcode<input value={ruleDraft.destinationPostcode || ''} onChange={event => setRuleDraft({ ...ruleDraft, destinationPostcode: event.target.value })} /></label>
            <label>Priority<input type="number" min={0} max={10000} value={ruleDraft.priority} onChange={event => setRuleDraft({ ...ruleDraft, priority: Number(event.target.value) })} /></label>
            <label>Base confidence<input type="number" min={0} max={100} value={ruleDraft.confidenceScore} onChange={event => setRuleDraft({ ...ruleDraft, confidenceScore: Number(event.target.value) })} /></label>
            <label>Effective from<input type="date" value={ruleDraft.effectiveFrom || ''} onChange={event => setRuleDraft({ ...ruleDraft, effectiveFrom: event.target.value })} /></label>
            <label>Effective to<input type="date" value={ruleDraft.effectiveTo || ''} onChange={event => setRuleDraft({ ...ruleDraft, effectiveTo: event.target.value })} /></label>
            <label style={{ gridColumn: '1 / -1' }}>Notes<textarea value={ruleDraft.notes || ''} onChange={event => setRuleDraft({ ...ruleDraft, notes: event.target.value })} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={ruleDraft.active} onChange={event => setRuleDraft({ ...ruleDraft, active: event.target.checked })} /> Active</label>
          </div></section></div>
          <div className="crm-modal-actions"><button className="primary" disabled={saving || !clean(ruleDraft.customerCode) || !ruleHasDimension} onClick={() => void saveRule()}>{saving ? 'Saving…' : 'Save Master Data route rule'}</button><button disabled={saving} onClick={() => { setRuleEditorOpen(false); setRuleId(undefined); setRuleDraft(emptyRule); }}>Cancel</button></div>
        </div>
      </div>}
    </>}
  </div>;
}
