import { useCallback, useMemo, useState } from 'react';
import { api, type RoadrunnerSiteReview as ReviewRow } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';

type Proposal = Record<string, unknown>;
const reviewFields = ['Name', 'DriverTextName', 'CollectionAddress', 'Aliases', 'Latitude', 'Longitude'] as const;

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function proposal(row: ReviewRow): Proposal {
  return row.proposal && typeof row.proposal === 'object' ? row.proposal : {};
}

function roadRunner(row: ReviewRow): Proposal {
  const value = proposal(row).roadRunner;
  return value && typeof value === 'object' ? value as Proposal : {};
}

function address(rr: Proposal): string {
  return ['Add1', 'Add2', 'Add3', 'AddTown', 'AddCounty', 'AddPostcode', 'AddCountry']
    .map(key => text(rr[key] ?? rr[`${key.charAt(0).toLowerCase()}${key.slice(1)}`]).trim()).filter(Boolean).join(', ');
}

function received(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export function RoadrunnerSiteReview() {
  const token = useAccessToken();
  const reviews = useApi(useCallback(async () => api.roadrunnerSiteReviews(await token()), [token]));
  const sites = useApi(useCallback(async () => api.sites(await token()), [token]));
  const [selectedId, setSelectedId] = useState<string>();
  const [targetSiteId, setTargetSiteId] = useState('');
  const [alias, setAlias] = useState('');
  const [fields, setFields] = useState<string[]>(['Name']);
  const [note, setNote] = useState('');
  const [createName, setCreateName] = useState('');
  const [createDriverName, setCreateDriverName] = useState('');
  const [createAddress, setCreateAddress] = useState('');
  const [createAlias, setCreateAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const selected = reviews.data?.find(row => row.id === selectedId);
  const selectedRoadRunner = selected ? roadRunner(selected) : {};
  const activeSites = useMemo(() => (sites.data || []).filter(site => site.active), [sites.data]);

  function select(row: ReviewRow) {
    const rr = roadRunner(row);
    setSelectedId(row.id);
    setTargetSiteId('');
    setAlias(text(rr.Company || rr.company));
    setCreateName(text(rr.Company || rr.company));
    setCreateDriverName(text(rr.Company || rr.company));
    setCreateAddress(address(rr));
    setCreateAlias('');
    setNote('');
    setFields(['Name']);
    setMessage(undefined);
  }

  async function act(action: (accessToken: string) => Promise<unknown>, success: string) {
    setBusy(true); setMessage(undefined);
    try {
      await action(await token());
      await Promise.all([reviews.refresh(), sites.refresh()]);
      setSelectedId(undefined);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The RoadRunner review action failed.');
    } finally { setBusy(false); }
  }

  if (reviews.loading && !reviews.data) return <section><p className="eyebrow">Master data review</p><h1>RoadRunner Site Review</h1><div className="state">Loading pending RoadRunner proposals…</div></section>;

  return <section className="roadrunner-review-page">
    <div className="title-row">
      <div><p className="eyebrow">SQL Site Master governance</p><h1>RoadRunner Site Review</h1><p className="intro">Review imported RoadRunner identities before they become canonical TMS Sites. Reconciliation is proposal-only; approval is explicit and audited.</p></div>
      <button onClick={() => void Promise.all([reviews.refresh(), sites.refresh()])} disabled={busy}>Refresh</button>
    </div>
    {message && <p className="notice inline-notice" role="status">{message}</p>}
    {(reviews.error || sites.error) && <p className="notice error" role="alert">{reviews.error || sites.error}</p>}
    <div className="master-counts">
      <article><span>Pending proposals</span><strong>{reviews.data?.length || 0}</strong></article>
      <article><span>Active target Sites</span><strong>{activeSites.length}</strong></article>
      <article><span>Approval rule</span><strong className="review-rule">Planner decision required</strong></article>
    </div>
    {!reviews.data?.length ? <div className="state"><strong>No pending RoadRunner proposals.</strong><p>New reconciliation rows will appear here for planner review.</p></div> : <div className="roadrunner-review-layout">
      <div className="panel roadrunner-proposal-list"><div className="panel-heading"><div><p className="eyebrow">Inbox</p><h2>Pending proposals</h2></div><span className="status review">{reviews.data.length} awaiting review</span></div>
        {reviews.data.map(row => { const rr = roadRunner(row); return <button type="button" className={`roadrunner-proposal ${selectedId === row.id ? 'selected' : ''}`} key={row.id} onClick={() => select(row)}>
          <span className="roadrunner-proposal-top"><strong>{text(rr.Company || rr.company) || 'Unnamed RoadRunner site'}</strong><span className="status review">{text(proposal(row).confidence) || 'Review'}</span></span>
          <span className="roadrunner-proposal-meta"><b>{text(rr.Code || rr.code) || 'No code'}</b>{text(rr.AddPostcode || rr.addPostcode) && <> · {text(rr.AddPostcode || rr.addPostcode)}</>}<br />Received {received(row.receivedAtUtc)}</span>
          <span className="roadrunner-proposal-reason">{text(proposal(row).reason) || row.reviewNote || 'Requires planner decision.'}</span>
        </button>; })}
      </div>
      <div className="roadrunner-review-detail">
        {!selected ? <div className="state"><strong>Select a proposal.</strong><p>Review the source identity and choose the smallest safe approval action.</p></div> : <>
          <div className="panel roadrunner-source-panel"><div className="panel-heading"><div><p className="eyebrow">Source identity</p><h2>{text(selectedRoadRunner.Company || selectedRoadRunner.company) || 'Unnamed site'}</h2></div><span className="status review">Pending review</span></div><div className="roadrunner-facts"><div><small>RoadRunner code</small><strong>{text(selectedRoadRunner.Code || selectedRoadRunner.code) || 'Missing'}</strong></div><div><small>Address</small><strong>{address(selectedRoadRunner) || 'No address supplied'}</strong></div><div><small>Match reason</small><strong>{text(proposal(selected).reason) || 'Manual review'}</strong></div></div></div>
          <div className="panel roadrunner-action-panel"><p className="eyebrow">Approve against SQL Site Master</p><h2>Link without changing fields</h2><p className="hint">Use this when the existing canonical Site is correct. The RoadRunner identity is retained as integration evidence.</p><div className="form-grid"><label>Active canonical Site<select value={targetSiteId} onChange={event => setTargetSiteId(event.target.value)}><option value="">Choose a Site…</option>{activeSites.map(site => <option value={site.id} key={site.id}>{site.externalCode} · {site.name}</option>)}</select></label><label className="wide">Planner note<input value={note} onChange={event => setNote(event.target.value)} placeholder="Optional audit note" /></label></div><div className="roadrunner-action-buttons"><button className="primary" disabled={busy || !targetSiteId} onClick={() => void act(accessToken => api.linkRoadrunnerSiteReview(selected.id, { siteId: targetSiteId, note: note || undefined }, accessToken), 'RoadRunner identity linked without changing canonical fields.')}>Link identity</button><button className="approve" disabled={busy || !targetSiteId} onClick={() => void act(accessToken => api.addRoadrunnerSiteAlias(selected.id, { siteId: targetSiteId, alias: alias || undefined, note: note || undefined }, accessToken), 'RoadRunner identity linked and alias retained.')}>Link + add alias</button></div><label className="roadrunner-inline-field">Alias to add<input value={alias} onChange={event => setAlias(event.target.value)} placeholder="RoadRunner company name" /></label></div>
          <div className="panel roadrunner-action-panel"><p className="eyebrow">Selective correction</p><h2>Accept selected fields</h2><p className="hint">Only checked fields will change the canonical Site. RoadRunner identity is linked as part of the same approval.</p><div className="roadrunner-field-checks">{reviewFields.map(field => <label key={field}><input type="checkbox" checked={fields.includes(field)} onChange={event => setFields(current => event.target.checked ? [...current, field] : current.filter(value => value !== field))} /> {field}</label>)}</div><button className="primary" disabled={busy || !targetSiteId || !fields.length} onClick={() => void act(accessToken => api.acceptRoadrunnerSiteFields(selected.id, { siteId: targetSiteId, fields, note: note || undefined }, accessToken), 'Selected RoadRunner fields accepted.')}>Accept selected fields</button></div>
          <div className="panel roadrunner-action-panel"><p className="eyebrow">New canonical record</p><h2>Create a Site</h2><p className="hint">Use only when no existing canonical Site is suitable. The new code is allocated as `SITE###`; the RoadRunner code is not used as the Site code.</p><div className="form-grid"><label>Site name<input value={createName} onChange={event => setCreateName(event.target.value)} /></label><label>Driver text name<input value={createDriverName} onChange={event => setCreateDriverName(event.target.value)} /></label><label className="wide">Collection address<input value={createAddress} onChange={event => setCreateAddress(event.target.value)} /></label><label>Alias<input value={createAlias} onChange={event => setCreateAlias(event.target.value)} /></label></div><button className="primary" disabled={busy || !createName.trim()} onClick={() => void act(accessToken => api.createRoadrunnerSite(selected.id, { name: createName.trim(), driverTextName: createDriverName.trim() || undefined, collectionAddress: createAddress.trim() || undefined, alias: createAlias.trim() || undefined, note: note || undefined }, accessToken), 'New canonical Site created from the approved proposal.')}>Create canonical Site</button></div>
          <div className="roadrunner-dismiss"><button className="reject" disabled={busy} onClick={() => { if (window.confirm('Dismiss this proposal? The source evidence will be retained and no Site Master fields will change.')) void act(accessToken => api.dismissRoadrunnerSiteReview(selected.id, { note: note || undefined }, accessToken), 'Proposal dismissed; no canonical Site data changed.'); }}>Dismiss proposal</button></div>
        </>}
      </div>
    </div>}
  </section>;
}
