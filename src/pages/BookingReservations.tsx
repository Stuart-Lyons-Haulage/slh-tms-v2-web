import { useCallback, useMemo, useState } from 'react';
import { api, type BookingCandidateOrder, type BookingReservation } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { formatDateLong, todayIsoDate } from '../lib/dateUtils';
import { useApi } from '../lib/useApi';

const dateLabel = (value?: string) => value ? formatDateLong(value) : 'TBC';

export function BookingReservations() {
  const token = useAccessToken();
  const today = todayIsoDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<BookingReservation>();
  const [matchReservation, setMatchReservation] = useState<BookingReservation>();
  const rows = useApi(useCallback(async () => api.bookingReservations({ from, to, status, customerCode: customer }, await token()), [customer, from, status, to, token]));
  const counts = useMemo(() => ({ pre: rows.data?.filter(row => /preorder|awaiting|amended/i.test(row.status)).length || 0, allocated: rows.data?.filter(row => /assigned/i.test(row.status)).length || 0, unassigned: rows.data?.filter(row => row.assignedUnits < row.reservedUnits && !/cancel/i.test(row.status)).length || 0 }), [rows.data]);

  async function cancel() {
    if (!selected || !window.confirm(`Cancel booking ${selected.collectionReference || selected.stableBookingKey}?`)) return;
    await api.cancelBookingReservation(selected.id, 'Cancelled by planner in Booking & Capacity', await token());
    setSelected(undefined); await rows.refresh();
  }

  const rangeLabel = from === to ? dateLabel(from) : `${dateLabel(from)} to ${dateLabel(to)}`;
  return <section>
    <div className="title-row"><div><p className="eyebrow">Planner control / retained capacity</p><h1>Booking &amp; Capacity</h1><p className="intro">NWF crate and inbound reservations stay visible until they are matched to real orders, amended, cancelled or dispatched.</p></div></div>
    <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}><div style={{ flexBasis: '100%' }}><strong>Operational date window</strong><p className="hint" style={{ margin: '4px 0 0' }}>Only reservations whose collection date falls within this window are shown. Dates are UK operational dates.</p></div><label>From<input aria-label="Operational date from" type="date" value={from} onChange={event => { const value = event.target.value; setFrom(value); if (value > to) setTo(value); }} /></label><label>To<input aria-label="Operational date to" type="date" min={from} value={to} onChange={event => setTo(event.target.value)} /></label><button type="button" onClick={() => { setFrom(today); setTo(today); }}>Today</button><label>Customer<input value={customer} onChange={event => setCustomer(event.target.value.toUpperCase())} placeholder="NWF" /></label><label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{['PreOrder', 'AwaitingDetails', 'Amended', 'PartiallyAssigned', 'Assigned', 'Cancelled'].map(value => <option key={value}>{value}</option>)}</select></label><button type="button" onClick={() => void rows.refresh()}>Refresh</button></div>
    <div className="panel" style={{ marginTop: 12 }}><strong>Showing: {rangeLabel}</strong><p className="hint" style={{ margin: '4px 0 0' }}>This date filter is applied to the retained booking list and its matching-order workflow.</p></div>
    <div className="metrics"><article className="metric"><span>Reservations</span><strong>{rows.data?.length || 0}</strong><small>{rangeLabel}</small></article><article className="metric"><span>Pre-order / amended</span><strong>{counts.pre}</strong><small>Needs customer detail or review</small></article><article className="metric"><span>Partly/unassigned</span><strong>{counts.unassigned}</strong><small>Capacity not yet matched to orders</small></article><article className="metric"><span>Fully allocated</span><strong>{counts.allocated}</strong><small>Ready to follow through planning</small></article></div>
    {rows.loading && <div className="state">Loading retained bookings…</div>}{rows.error && <p className="notice">{rows.error}</p>}
    {!rows.loading && !rows.error && !rows.data?.length && <div className="state">No retained bookings match this period.</div>}
    {!!rows.data?.length && <div className="panel" style={{ overflowX: 'auto' }}><table><thead><tr><th>Collection</th><th>Reference</th><th>Route</th><th>Capacity</th><th>Status</th><th>Revision</th><th /></tr></thead><tbody>{rows.data.map(row => <tr key={row.id}><td><strong>{dateLabel(row.collectionDate)}</strong><br/><small>{row.bookingType}</small></td><td><strong>{row.collectionReference || 'No collection ref'}</strong><br/><small>{row.customerCode} · {row.cratePurchaseOrder || row.transportPurchaseOrder || 'PO TBC'}</small></td><td>{row.collectionDepot || 'Collection TBC'}<br/><small>→ {row.deliverySite || 'Destination TBC'}</small></td><td><strong>{row.assignedUnits}/{row.reservedUnits}</strong><br/><small>{row.unitType}</small></td><td><span className={`status ${row.status.toLowerCase()}`}>{row.status}</span></td><td>v{row.revisionNumber}</td><td><button type="button" onClick={() => setSelected(row)}>Inspect</button> <button type="button" onClick={() => setMatchReservation(row)}>Match order</button></td></tr>)}</tbody></table></div>}
    {selected && <ReservationDrawer reservation={selected} onClose={() => setSelected(undefined)} onCancel={cancel} onUpdated={async () => { setSelected(undefined); await rows.refresh(); }} />}
    {matchReservation && <ReservationMatchPanel reservation={matchReservation} onClose={() => setMatchReservation(undefined)} onMatched={async () => { setMatchReservation(undefined); await rows.refresh(); }} />}
  </section>;
}

function ReservationDrawer({ reservation, onClose, onCancel, onUpdated }: { reservation: BookingReservation; onClose: () => void; onCancel: () => Promise<void>; onUpdated: () => Promise<void> }) {
  const token = useAccessToken();
  const detail = useApi(useCallback(async () => api.bookingReservation(reservation.id, await token()), [reservation.id, token]));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [evidence, setEvidence] = useState<{ stagedPayloadJson: string; sourceEvidencePayloadJson?: string; sourceMessageId?: string; source?: string; receivedAtUtc: string }>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [form, setForm] = useState({
    collectionDate: reservation.collectionDate,
    deliveryDate: reservation.deliveryDate || '',
    reservedUnits: String(reservation.reservedUnits),
    collectionDepot: reservation.collectionDepot || '',
    deliverySite: reservation.deliverySite || '',
    collectionReference: reservation.collectionReference || '',
    cratePurchaseOrder: reservation.cratePurchaseOrder || '',
    transportPurchaseOrder: reservation.transportPurchaseOrder || '',
    plannerNotes: '',
    changeNote: ''
  });
  const update = (field: keyof typeof form, value: string) => setForm(current => ({ ...current, [field]: value }));
  async function saveAmendment() {
    const units = Number(form.reservedUnits);
    if (!form.collectionDate || !Number.isFinite(units) || units < 0 || !form.changeNote.trim()) return;
    setSaving(true);
    try {
      await api.reviseBookingReservation(reservation.id, { ...form, reservedUnits: units, deliveryDate: form.deliveryDate || undefined, changeNote: form.changeNote.trim() }, await token());
      await onUpdated();
    } finally { setSaving(false); }
  }
  async function loadEvidence() {
    setEvidenceLoading(true);
    try { setEvidence(await api.bookingReservationSourceEvidence(reservation.id, await token())); }
    finally { setEvidenceLoading(false); }
  }
  async function unmatch(allocationId: string) {
    if (!window.confirm('Unmatch this order but retain the allocation history?')) return;
    await api.unmatchBookingReservation(reservation.id, allocationId, 'Planner corrected the reservation match', await token());
    await onUpdated();
  }
  return <div className="drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer"><div className="title-row"><div><p className="eyebrow">Booking trail</p><h2>{reservation.collectionReference || reservation.stableBookingKey}</h2></div><button type="button" onClick={onClose}>Close</button></div><p><strong>{reservation.customerCode}</strong> · {reservation.bookingType} · collection {dateLabel(reservation.collectionDate)}</p><p>{reservation.collectionDepot || 'Collection TBC'} → {reservation.deliverySite || 'Destination TBC'}</p><p><strong>{reservation.assignedUnits}/{reservation.reservedUnits} {reservation.unitType}</strong> · status {reservation.status} · revision {reservation.revisionNumber}</p><p className="hint">Source staging: {reservation.sourceStagedImportId || 'not linked'} · movement: {reservation.sourceMovementId || 'not yet approved'}</p>{reservation.sourceStagedImportId && <button type="button" onClick={() => void loadEvidence()} disabled={evidenceLoading}>{evidenceLoading ? 'Loading source…' : 'View retained source evidence'}</button>}{evidence && <details open><summary>Retained source ({evidence.source || 'import'})</summary><small>{evidence.sourceMessageId || 'No message ID'} · {evidence.receivedAtUtc}</small><pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{evidence.sourceEvidencePayloadJson || evidence.stagedPayloadJson}</pre></details>}{reservation.status !== 'Cancelled' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" onClick={() => setEditing(value => !value)}>{editing ? 'Close amendment' : 'Amend reservation'}</button><button className="danger" type="button" onClick={() => void onCancel()}>Cancel reservation</button></div>}{editing && <div className="panel" style={{ marginTop: 12 }}><h3>Record amendment</h3><div className="form-grid"><label>Collection date<input type="date" value={form.collectionDate} onChange={event => update('collectionDate', event.target.value)} /></label><label>Delivery date<input type="date" value={form.deliveryDate} onChange={event => update('deliveryDate', event.target.value)} /></label><label>Reserved units<input type="number" min="0" step="0.01" value={form.reservedUnits} onChange={event => update('reservedUnits', event.target.value)} /></label><label>Collection reference<input value={form.collectionReference} onChange={event => update('collectionReference', event.target.value)} /></label><label>Collection depot<input value={form.collectionDepot} onChange={event => update('collectionDepot', event.target.value)} /></label><label>Delivery site<input value={form.deliverySite} onChange={event => update('deliverySite', event.target.value)} /></label><label>Crate PO<input value={form.cratePurchaseOrder} onChange={event => update('cratePurchaseOrder', event.target.value)} /></label><label>Transport PO<input value={form.transportPurchaseOrder} onChange={event => update('transportPurchaseOrder', event.target.value)} /></label></div><label>Planner notes<textarea value={form.plannerNotes} onChange={event => update('plannerNotes', event.target.value)} /></label><label>Reason for amendment<input required value={form.changeNote} onChange={event => update('changeNote', event.target.value)} placeholder="e.g. NWF amended crate dump reference and quantity" /></label><button className="primary" type="button" disabled={saving || !form.changeNote.trim()} onClick={() => void saveAmendment()}>{saving ? 'Saving…' : 'Save amendment'}</button></div>}<h3>Recorded revisions</h3>{detail.loading && <p className="hint">Loading source and amendment trail…</p>}{detail.data?.revisions.map((revision, index) => <article className="history-item" key={String(revision.id || index)}><strong>Revision {String(revision.revisionNumber || index + 1)}</strong><small>{String(revision.status || '')} · {String(revision.createdAtUtc || '')}</small><p>{String(revision.changeNote || 'Source snapshot received')}</p></article>)}<h3>Assignments</h3>{detail.data?.allocations.length ? detail.data.allocations.map(item => <article className="history-item" key={item.id}><strong>{item.units} {item.unitType}</strong><small>{item.isActive ? 'Active match' : 'Unmatched (retained for audit)'} · {item.destination || 'Destination TBC'}{item.transportOrderId ? ` · order ${item.transportOrderId}` : ''}</small>{item.isActive && item.transportOrderId && <button type="button" onClick={() => void unmatch(item.id)}>Unmatch order</button>}</article>) : <p className="hint">No real order has been matched to this reservation yet.</p>}</aside></div>;
}

function ReservationMatchPanel({ reservation, onClose, onMatched }: { reservation: BookingReservation; onClose: () => void; onMatched: () => Promise<void> }) {
  const token = useAccessToken();
  const candidates = useApi(useCallback(async () => api.bookingCandidateOrders(reservation.id, await token()), [reservation.id, token]));
  async function match(order: BookingCandidateOrder) {
    await api.matchBookingOrder(reservation.id, { transportOrderId: order.id, units: order.pallets, note: 'Matched by planner from Booking & Capacity' }, await token());
    await onMatched();
  }
  return <div className="drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer"><div className="title-row"><div><p className="eyebrow">Order matching</p><h2>{reservation.collectionReference || reservation.stableBookingKey}</h2></div><button type="button" onClick={onClose}>Close</button></div><p>Find a confirmed {reservation.customerCode} movement within the retained booking date window, then record the match against the reservation capacity. Exact retained collection-reference matches appear first.</p>{candidates.loading && <p className="hint">Finding confirmed orders…</p>}{candidates.error && <p className="notice">{candidates.error}</p>}{candidates.data?.length ? candidates.data.map(order => <article className="history-item" key={order.id}><strong>{order.reference}</strong><small>{dateLabel(order.collectionDate)} · {order.pallets || '—'} pallets · {order.status}{order.collectionReference ? ` · source ref ${order.collectionReference}` : ''}</small><button type="button" onClick={() => void match(order)}>Match this order</button></article>) : !candidates.loading && !candidates.error && <p className="hint">No unmatched confirmed order falls within the booking date window.</p>}</aside></div>;
}
