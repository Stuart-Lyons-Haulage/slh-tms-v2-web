import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkingDate } from '../lib/workingDate';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { startVisiblePolling } from '../lib/visiblePolling';
import { expectedAt, sortByExpected, unitLabel, type WarehouseDailyResult, type WarehouseMovement } from './warehousePlanningData';

function clock(value?: string) {
  return value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}
function expectedText(row: WarehouseMovement) {
  if (row.liveEtaUtc) return clock(row.liveEtaUtc);
  if (row.expectedAtUtc) return clock(row.expectedAtUtc);
  if (row.dueTime) return row.dueTime.slice(0, 5);
  return row.period && row.period !== 'Unallocated' ? row.period : 'Time TBC';
}
function totals(rows: WarehouseMovement[]) {
  const sums = new Map<string, number>();
  rows.forEach(row => sums.set(unitLabel(row), (sums.get(unitLabel(row)) || 0) + row.plannedPallets));
  return [...sums.entries()].map(([unit, count]) => `${count} ${unit}`).join(' · ') || 'Nothing';
}

/**
 * Barnham (SLH) warehouse board: what is arriving and what needs loading, with live
 * ETAs for our trucks from tracking. The warehouse confirms each movement with the
 * count actually received or loaded; every count is kept as an audit trail.
 */
export function WarehousePlanning() {
  const token = useAccessToken();
  const [date] = useWorkingDate();
  const data = useApi(useCallback(async () => request<WarehouseDailyResult>(`/api/v1/warehouse/daily?date=${encodeURIComponent(date)}`, await token()), [date, token]));
  const refresh = data.refresh;
  useEffect(() => startVisiblePolling(refresh, 60_000), [refresh]);
  const inbound = useMemo(() => data.data ? sortByExpected(data.data.inbound, data.data.planningDate) : [], [data.data]);
  const outbound = useMemo(() => data.data ? sortByExpected(data.data.outbound, data.data.planningDate) : [], [data.data]);

  return <section className="page warehouse-page">
    <div className="page-heading warehouse-heading">
      <div><p className="eyebrow">Barnham warehouse</p><h1>Warehouse board</h1><p>What's coming in and what needs loading at SLH. Live ETAs come from tracking; confirm each movement with the count you actually handled.</p></div>
      <div className="warehouse-actions"><button type="button" onClick={() => window.print()}>Print</button><button type="button" onClick={() => void refresh()}>Refresh</button></div>
    </div>
    {data.loading && !data.data && <p className="notice">Loading warehouse movements…</p>}
    {data.error && <p className="notice error">Warehouse movements could not be loaded: {data.error}</p>}
    {data.data && <>
      <div className="warehouse-totals">
        <article><span>Coming in</span><strong>{inbound.length}</strong><small>{totals(inbound)}</small></article>
        <article><span>To load out</span><strong>{outbound.length}</strong><small>{totals(outbound)}</small></article>
        <article><span>Still to confirm</span><strong>{[...inbound, ...outbound].filter(row => row.actualQuantity == null).length}</strong><small>movements without a count</small></article>
      </div>
      <MovementList title="Coming in" empty="Nothing due in to SLH for this date." rows={inbound} date={date} onSaved={refresh} />
      <MovementList title="To load out" empty="Nothing to load out of SLH for this date." rows={outbound} date={date} onSaved={refresh} />
    </>}
  </section>;
}

function MovementList({ title, empty, rows, date, onSaved }: { title: string; empty: string; rows: WarehouseMovement[]; date: string; onSaved: () => Promise<void> }) {
  return <section className="warehouse-section" aria-label={title}>
    <h2>{title}</h2>
    {rows.length === 0 && <p className="empty-state">{empty}</p>}
    <ul className="warehouse-list">
      {rows.map(row => <MovementCard key={row.movementKey || `${row.loadId}-${row.loadReference}-${row.customer}`} row={row} date={date} onSaved={onSaved} />)}
    </ul>
  </section>;
}

function MovementCard({ row, date, onSaved }: { row: WarehouseMovement; date: string; onSaved: () => Promise<void> }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(String(row.actualQuantity ?? row.plannedPallets));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const inbound = row.direction === 'Inbound';
  const unit = unitLabel(row);
  const action = inbound ? 'Received' : 'Loaded';

  async function save() {
    const actual = Number(quantity);
    if (!row.movementKey || !Number.isInteger(actual) || actual < 0) { setError('Enter the number actually handled.'); return; }
    setSaving(true); setError(undefined);
    try {
      await request('/api/v1/warehouse/checks', await token(), { method: 'POST', body: JSON.stringify({ movementKey: row.movementKey, date, direction: row.direction, actualQuantity: actual, note: note || undefined }) });
      setOpen(false); setNote('');
      await onSaved();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'The count could not be saved.');
    } finally { setSaving(false); }
  }

  const confirmed = row.actualQuantity != null;
  return <li className={`warehouse-card ${inbound ? 'inbound' : 'outbound'}${confirmed ? ' confirmed' : ''}`}>
    <div className="warehouse-card-time">
      <strong>{expectedText(row)}</strong>
      <small>{row.liveEtaUtc ? `Live ETA${row.etaRisk ? ` · ${row.etaRisk}` : ''}` : expectedAt(row) ? 'Planned' : row.runReference}</small>
    </div>
    <div className="warehouse-card-main">
      <div className="warehouse-card-title">
        <span className={`warehouse-direction ${inbound ? 'inbound' : 'outbound'}`}>{inbound ? 'In' : 'Out'}</span>
        <strong>{row.plannedPallets} {unit}</strong>
        <span>{row.customer}</span>
        {row.palletType && unit === 'pallets' && <small>{row.palletType}</small>}
        {row.temperature && <small>{row.temperature}</small>}
      </div>
      <div className="warehouse-card-route">{inbound ? `From ${row.from || 'TBC'}` : `To ${row.to || 'TBC'}`}{inbound && row.onwardTo ? ` · then out to ${row.onwardTo}` : ''}</div>
      <div className="warehouse-card-meta">
        <span>{row.runReference}{row.period && row.period !== 'Unallocated' ? ` ${row.period}` : ''}</span>
        {row.driver && <span>{row.driver}</span>}
        {row.vehicle && <span>{row.vehicle}{row.trailer ? ` / ${row.trailer}` : ''}</span>}
        {(row.poReference || row.loadReference) && <span>{row.poReference || row.loadReference}</span>}
        <span>{row.status}</span>
      </div>
      {confirmed && <div className="warehouse-card-check">
        {action} {row.actualQuantity}{row.difference ? ` (${row.difference > 0 ? '+' : ''}${row.difference})` : ''} · {row.checkedBy || 'warehouse'} {clock(row.checkedAtUtc)}
        {row.checkHistory && row.checkHistory.length > 1 && <details><summary>{row.checkHistory.length} counts recorded</summary><ul>{row.checkHistory.map(check => <li key={check.recordedAtUtc}>{clock(check.recordedAtUtc)} · {check.actualQuantity} · {check.recordedBy || 'warehouse'}{check.note ? ` · ${check.note}` : ''}</li>)}</ul></details>}
      </div>}
      {open && <div className="warehouse-card-form">
        <label>{action}<input inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label>Note<input value={note} placeholder="Optional, e.g. 1 damaged" onChange={event => setNote(event.target.value)} /></label>
        <button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save count'}</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        {error && <p className="notice error">{error}</p>}
      </div>}
    </div>
    {!open && row.movementKey && <button type="button" className="warehouse-card-action" onClick={() => setOpen(true)}>{confirmed ? 'Recount' : action}</button>}
  </li>;
}
