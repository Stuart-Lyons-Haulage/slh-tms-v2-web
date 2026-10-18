import { useCallback, useMemo, useState } from 'react';
import { api, type BookingCandidateOrder, type BookingReservation } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { formatDateLong } from '../lib/dateUtils';
import { useApi } from '../lib/useApi';

const dateLabel = (value?: string) => value ? formatDateLong(value) : 'TBC';

export type SouthboundOrder = { id: string; reference: string; customerCode: string; collection: string; destination: string; orderedPallets: number; plannedPallets: number; outstandingPallets: number; loadUnitType?: string; palletType?: string; allocations: Array<{ loadReference?: string }> };

/**
 * Crates, trays and IFCO collected southbound on the way back from a delivery.
 * NWF's crate and tray spreadsheet is imported automatically as bookings; each booking
 * stays here until it is matched to a confirmed order, then the order is planned on a run.
 */
export function SouthboundCollections({ date, confirmedOrders }: { date: string; confirmedOrders: SouthboundOrder[] }) {
  const token = useAccessToken();
  const [range, setRange] = useState<'day' | 'week'>('day');
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState<BookingReservation>();
  const [matchReservation, setMatchReservation] = useState<BookingReservation>();
  const to = range === 'day' ? date : addDaysIso(date, 6);
  const rows = useApi(useCallback(async () => api.bookingReservations({ from: date, to, status: status === 'open' || status === 'all' ? '' : status }, await token()), [date, status, to, token]));
  const visible = useMemo(() => (rows.data || []).filter(row => status !== 'open' || (!/cancel/i.test(row.status) && row.assignedUnits < row.reservedUnits)), [rows.data, status]);
  const waiting = (rows.data || []).filter(row => !/cancel/i.test(row.status) && row.assignedUnits < row.reservedUnits);
  const unitsWaiting = waiting.reduce((sum, row) => sum + Math.max(0, row.reservedUnits - row.assignedUnits), 0);
  const toPlan = confirmedOrders.filter(order => order.outstandingPallets > 0);

  async function cancel() {
    if (!selected || !window.confirm(`Cancel booking ${selected.collectionReference || selected.stableBookingKey}?`)) return;
    await api.cancelBookingReservation(selected.id, 'Cancelled by planner in Southbound collections', await token());
    setSelected(undefined); await rows.refresh();
  }

  return <section className="ui-page southbound-page">
    <div className="ui-grid">
      <div className={`ui-metric ${waiting.length ? 'amber' : 'green'}`}><span>Bookings waiting for an order</span><strong>{waiting.length}</strong><small>{Math.round(unitsWaiting)} units not yet confirmed</small></div>
      <div className={`ui-metric ${toPlan.length ? 'amber' : 'green'}`}><span>Confirmed, still to plan</span><strong>{toPlan.length}</strong><small>{toPlan.reduce((sum, order) => sum + order.outstandingPallets, 0)} units to put on a run</small></div>
      <div className="ui-metric"><span>On runs</span><strong>{confirmedOrders.filter(order => order.plannedPallets > 0).length}</strong><small>collected on the way back</small></div>
    </div>

    <section className="ui-card">
      <div className="ui-card-head"><h2>Confirmed collections for {formatDateLong(date)}</h2></div>
      {confirmedOrders.length === 0 ? <div className="ui-empty">No confirmed crate or tray collections for this date.</div> : <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Collect from</th><th>Take to</th><th>Units</th><th>Run</th><th>Reference</th></tr></thead><tbody>
        {confirmedOrders.map(order => <tr key={order.id}>
          <td><strong>{order.collection}</strong><br /><small>{order.customerCode}</small></td>
          <td>{order.destination}</td>
          <td><strong>{order.orderedPallets}</strong> {order.loadUnitType && order.loadUnitType !== 'Pallet' ? order.loadUnitType : order.palletType || 'units'}</td>
          <td>{order.outstandingPallets > 0 ? <span className="ui-chip amber">{order.outstandingPallets} to plan</span> : <span className="ui-chip green">{order.allocations.map(item => item.loadReference).filter(Boolean).join(', ') || 'Planned'}</span>}</td>
          <td><small>{order.reference}</small></td>
        </tr>)}
      </tbody></table></div>}
    </section>

    <section className="ui-card">
      <div className="ui-card-head">
        <h2>Bookings from the NWF crate and tray sheet</h2>
        <div className="ui-page-actions">
          <div className="ui-seg" role="group" aria-label="Date range">
            <button type="button" aria-pressed={range === 'day'} onClick={() => setRange('day')}>This day</button>
            <button type="button" aria-pressed={range === 'week'} onClick={() => setRange('week')}>Next 7 days</button>
          </div>
          <select aria-label="Booking status" value={status} onChange={event => setStatus(event.target.value)}>
            <option value="open">Waiting for an order</option>
            <option value="all">All bookings</option>
            {['PreOrder', 'AwaitingDetails', 'Amended', 'PartiallyAssigned', 'Assigned', 'Cancelled'].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="button" onClick={() => void rows.refresh()}>Refresh</button>
        </div>
      </div>
      <p className="hint">Imported automatically when NWF send the crate and tray spreadsheet. A booking matches itself to the order when it is confirmed; use Match only if it did not.</p>
      {rows.error && <p className="ui-error">{rows.error}</p>}
      {rows.loading && !rows.data ? <div className="ui-empty">Loading bookings…</div> : visible.length === 0 ? <div className="ui-empty">{status === 'open' ? 'Every booking in this period is matched to an order.' : 'No bookings in this period.'}</div> : <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>Collection</th><th>Reference</th><th>Route</th><th>Matched</th><th>Status</th><th /></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td><strong>{dateLabel(row.collectionDate)}</strong><br /><small>{row.bookingType}</small></td><td><strong>{row.collectionReference || 'No collection ref'}</strong><br /><small>{row.customerCode} · {row.cratePurchaseOrder || row.transportPurchaseOrder || 'PO TBC'}</small></td><td>{row.collectionDepot || 'Collection TBC'}<br /><small>→ {row.deliverySite || 'Destination TBC'}</small></td><td><strong>{row.assignedUnits}/{row.reservedUnits}</strong><br /><small>{row.unitType}</small></td><td><span className={`ui-chip ${/cancel/i.test(row.status) ? '' : row.assignedUnits >= row.reservedUnits ? 'green' : /amended|awaiting/i.test(row.status) ? 'amber' : 'blue'}`}>{row.status}</span>{row.revisionNumber > 1 && <small> v{row.revisionNumber}</small>}</td><td><button type="button" onClick={() => setSelected(row)}>Details</button> {row.assignedUnits < row.reservedUnits && !/cancel/i.test(row.status) && <button type="button" onClick={() => setMatchReservation(row)}>Match</button>}</td></tr>)}</tbody></table></div>}
    </section>
    {selected && <ReservationDrawer reservation={selected} onClose={() => setSelected(undefined)} onCancel={cancel} onUpdated={async () => { setSelected(undefined); await rows.refresh(); }} />}
    {matchReservation && <ReservationMatchPanel reservation={matchReservation} onClose={() => setMatchReservation(undefined)} onMatched={async () => { setMatchReservation(undefined); await rows.refresh(); }} />}
  </section>;
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  return <div className="drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="drawer"><div className="title-row"><div><p className="eyebrow">Order matching</p><h2>{reservation.collectionReference || reservation.stableBookingKey}</h2></div><button type="button" onClick={onClose}>Close</button></div><p>Only confirmed crate/tray movements with a matching retained PO, load or collection reference are shown. Use this control when an unambiguous match could not be applied automatically.</p>{candidates.loading && <p className="hint">Finding confirmed crate/tray orders…</p>}{candidates.error && <p className="notice">{candidates.error}</p>}{candidates.data?.length ? candidates.data.map(order => <article className="history-item" key={order.id}><strong>{order.reference}</strong><small>{dateLabel(order.collectionDate)} · {order.pallets || '—'} pallets · {order.status}{order.collectionReference ? ` · source ref ${order.collectionReference}` : ''}</small><button type="button" onClick={() => void match(order)}>Match this order</button></article>) : !candidates.loading && !candidates.error && <p className="hint">No unmatched confirmed crate/tray order shares a retained reference with this booking.</p>}</aside></div>;
}
