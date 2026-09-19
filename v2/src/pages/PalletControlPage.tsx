import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, PalletMatrixCell, PlanningSnapshot } from '../lib/api';

type ViewMode = 'outstanding' | 'planned' | 'summary';
type Tone = 'standard' | 'euro' | 'trolley' | 'mixed' | 'unknown';

function queryDate() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('date');
  if (value) return value;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toneFor(cell: PalletMatrixCell, mode: ViewMode): Tone {
  const standard = mode === 'outstanding' ? cell.outstandingStandardPallets : mode === 'planned' ? cell.plannedStandardPallets : cell.totalStandardPallets;
  const euro = mode === 'outstanding' ? cell.outstandingEuroPallets : mode === 'planned' ? cell.plannedEuroPallets : cell.totalEuroPallets;
  const trolley = mode === 'outstanding' ? cell.outstandingTrolleys : mode === 'planned' ? cell.plannedTrolleys : cell.totalTrolleys;
  const types = [standard > 0, euro > 0, trolley > 0].filter(Boolean).length;
  if (types > 1) return 'mixed';
  if (standard > 0) return 'standard';
  if (euro > 0) return 'euro';
  if (trolley > 0) return 'trolley';
  return 'unknown';
}

function toneStyle(tone: Tone) {
  if (tone === 'standard') return { background: '#dbeafe', borderColor: '#2563eb' };
  if (tone === 'euro') return { background: '#ffedd5', borderColor: '#ea580c' };
  if (tone === 'trolley') return { background: '#fef9c3', borderColor: '#ca8a04' };
  if (tone === 'mixed') return { background: 'linear-gradient(135deg,#dbeafe 0 33%,#ffedd5 33% 66%,#fef9c3 66% 100%)', borderColor: '#7c3aed' };
  return { background: '#f3f4f6', borderColor: '#9ca3af' };
}

function values(cell: PalletMatrixCell, mode: ViewMode) {
  return {
    standard: mode === 'outstanding' ? cell.outstandingStandardPallets : mode === 'planned' ? cell.plannedStandardPallets : cell.totalStandardPallets,
    euro: mode === 'outstanding' ? cell.outstandingEuroPallets : mode === 'planned' ? cell.plannedEuroPallets : cell.totalEuroPallets,
    trolley: mode === 'outstanding' ? cell.outstandingTrolleys : mode === 'planned' ? cell.plannedTrolleys : cell.totalTrolleys,
  };
}

function total(cell: PalletMatrixCell, mode: ViewMode) {
  const v = values(cell, mode);
  return v.standard + v.euro + v.trolley;
}

export function PalletControlPage() {
  const [date, setDate] = useState(queryDate());
  const [data, setData] = useState<PlanningSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api.planningSnapshot(date));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh Pallet Control.');
    }
  }, [date]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const collections = useMemo(() => Array.from(new Set((data?.palletMatrix ?? []).map(x => x.collectionSite))).sort(), [data]);
  const deliveries = useMemo(() => Array.from(new Set((data?.palletMatrix ?? []).map(x => x.deliverySite))).sort(), [data]);
  const map = useMemo(() => new Map((data?.palletMatrix ?? []).map(x => [`${x.collectionSite}||${x.deliverySite}`, x])), [data]);

  const totals = useMemo(() => {
    const cells = data?.palletMatrix ?? [];
    return {
      outstanding: cells.reduce((sum, cell) => sum + total(cell, 'outstanding'), 0),
      planned: cells.reduce((sum, cell) => sum + total(cell, 'planned'), 0),
      summary: cells.reduce((sum, cell) => sum + total(cell, 'summary'), 0),
    };
  }, [data]);

  function matrix(mode: ViewMode, title: string) {
    return (
      <section className="panel pallet-board">
        <div className="pallet-board-title">
          <div><p className="eyebrow">{mode === 'outstanding' ? 'Work remaining' : mode === 'planned' ? 'Allocated work' : 'All ordered work'}</p><h2>{title}</h2></div>
          <strong>{totals[mode]}</strong>
        </div>
        <div className="pallet-matrix-wrap">
          <table className="pallet-matrix">
            <thead>
              <tr>
                <th className="pallet-row-heading">Collection</th>
                {deliveries.map(delivery => <th key={delivery}>{delivery}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {collections.map(collection => {
                const cells = deliveries.map(delivery => map.get(`${collection}||${delivery}`));
                const rowTotal = cells.reduce((sum, cell) => sum + (cell ? total(cell, mode) : 0), 0);
                if (!rowTotal) return null;
                return (
                  <tr key={collection}>
                    <td className="pallet-row-heading"><strong>{collection}</strong></td>
                    {deliveries.map((delivery, index) => {
                      const cell = cells[index];
                      if (!cell || !total(cell, mode)) return <td key={delivery} />;
                      const v = values(cell, mode);
                      return (
                        <td key={delivery}>
                          <div className="pallet-cell" style={toneStyle(toneFor(cell, mode))}>
                            <strong>{total(cell, mode)}</strong>
                            <small>
                              {v.standard ? `${v.standard} Std` : ''}
                              {v.euro ? `${v.standard ? ' · ' : ''}${v.euro} Euro` : ''}
                              {v.trolley ? `${v.standard || v.euro ? ' · ' : ''}${v.trolley} Trolley` : ''}
                            </small>
                          </div>
                        </td>
                      );
                    })}
                    <td className="pallet-total"><strong>{rowTotal}</strong></td>
                  </tr>
                );
              })}
              <tr className="destination-totals">
                <td className="pallet-row-heading"><strong>Delivery total</strong></td>
                {deliveries.map(delivery => {
                  const value = collections.reduce((sum, collection) => {
                    const cell = map.get(`${collection}||${delivery}`);
                    return sum + (cell ? total(cell, mode) : 0);
                  }, 0);
                  return <td key={delivery}><strong>{value || ''}</strong></td>;
                })}
                <td className="pallet-total"><strong>{totals[mode]}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className="pallet-control-page">
      <header className="page-header pallet-control-header">
        <div>
          <p className="eyebrow">Planner second screen · auto refresh</p>
          <h1>Pallet Control</h1>
          <p>Collections down the left, deliveries across the top. Updates automatically when Run Builder allocations change.</p>
        </div>
        <div className="planning-header-actions">
          <label>Planning date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <button className="button secondary" onClick={() => void refresh()}>Refresh now</button>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="pallet-legend">
        <span><i style={toneStyle('standard')} />Standard</span>
        <span><i style={toneStyle('euro')} />Euro</span>
        <span><i style={toneStyle('trolley')} />Trolleys</span>
        <span><i style={toneStyle('mixed')} />Mixed</span>
        <small>Auto-refresh every 3 seconds while this window is visible.</small>
      </div>

      <div className="pallet-control-stack">
        {matrix('outstanding', 'To Be Planned')}
        {matrix('planned', 'Planned')}
        {matrix('summary', 'Pallet Summary')}
      </div>
    </section>
  );
}
