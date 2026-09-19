import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, MasterRecord, PlanningMovement, PlanningRun, PlanningSnapshot } from '../lib/api';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodLabel(value: unknown) {
  return value === 1 || value === 'PM' ? 'PM' : 'AM';
}

function capacityClass(status: string) {
  if (status === 'red') return 'capacity red';
  if (status === 'amber') return 'capacity amber';
  if (status === 'green') return 'capacity green';
  return 'capacity neutral';
}

function qtyLabel(movement: PlanningMovement) {
  const parts: string[] = [];
  if (movement.remainingStandardPallets) parts.push(`${movement.remainingStandardPallets} Std`);
  if (movement.remainingEuroPallets) parts.push(`${movement.remainingEuroPallets} Euro`);
  if (movement.remainingTrolleys) parts.push(`${movement.remainingTrolleys} Trolley`);
  return parts.join(' · ') || 'Fully planned';
}

export function PlanningPage() {
  const [date, setDate] = useState(today());
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [drivers, setDrivers] = useState<MasterRecord[]>([]);
  const [vehicles, setVehicles] = useState<MasterRecord[]>([]);
  const [trailers, setTrailers] = useState<MasterRecord[]>([]);
  const [query, setQuery] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, { standard: string; euro: string; trolley: string }>>({});
  const [runDrafts, setRunDrafts] = useState<Record<string, { standard: string; euro: string; trolley: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setSnapshot(await api.planningSnapshot(date));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Planning.');
    }
  }, [date]);

  useEffect(() => {
    void Promise.all([
      api.drivers().then(setDrivers),
      api.vehicles().then(setVehicles),
      api.trailers().then(setTrailers),
    ]).catch(err => setError(err instanceof Error ? err.message : 'Unable to load Master Data.'));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredMovements = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const movements = snapshot?.movements ?? [];
    if (!needle) return movements;
    return movements.filter(movement =>
      `${movement.collectionSite} ${movement.deliverySite} ${movement.temperatureRequirement ?? ''} ${movement.trailerRequirement ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [snapshot, query]);

  const grouped = useMemo(() => ({
    AM: filteredMovements.filter(x => periodLabel(x.period) === 'AM'),
    PM: filteredMovements.filter(x => periodLabel(x.period) === 'PM'),
  }), [filteredMovements]);

  function signalPlanningChange() {
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('slh-v2-planning');
      channel.postMessage({ type: 'planning-changed', date });
      channel.close();
    }
  }

  function movementDraft(movement: PlanningMovement) {
    return drafts[movement.movementKey] ?? {
      standard: String(movement.remainingStandardPallets),
      euro: String(movement.remainingEuroPallets),
      trolley: String(movement.remainingTrolleys),
    };
  }

  function builtMovementDraft(run: PlanningRun, movement: PlanningRun['movements'][number]) {
    const key = `${run.id}|${movement.movementKey}`;
    return runDrafts[key] ?? {
      standard: String(movement.standardPallets),
      euro: String(movement.euroPallets),
      trolley: String(movement.trolleys),
    };
  }

  async function saveBuiltMovement(run: PlanningRun, movement: PlanningRun['movements'][number]) {
    const key = `${run.id}|${movement.movementKey}`;
    const draft = builtMovementDraft(run, movement);
    const standard = Number(draft.standard || 0);
    const euro = Number(draft.euro || 0);
    const trolley = Number(draft.trolley || 0);

    if (![standard, euro, trolley].every(value => Number.isInteger(value) && value >= 0)) {
      setError('Run quantities must be whole numbers of zero or more.');
      return;
    }

    setBusy(key);
    setError(null);
    try {
      await api.setPlanningMovement(run.id, movement.movementKey, standard, euro, trolley);
      setRunDrafts(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      signalPlanningChange();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update run quantity.');
    } finally {
      setBusy(null);
    }
  }

  async function createRun(period: 'AM' | 'PM') {
    setBusy(`create-${period}`);
    setError(null);
    try {
      await api.createPlanningRun(date, period);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create run.');
    } finally {
      setBusy(null);
    }
  }

  async function saveMovement(movement: PlanningMovement) {
    if (!selectedRunId) {
      setError('Select a run before allocating an order movement.');
      return;
    }

    const run = snapshot?.runs.find(x => x.id === selectedRunId);
    if (!run || periodLabel(run.period) !== periodLabel(movement.period)) {
      setError(`Select a ${periodLabel(movement.period)} run for this movement.`);
      return;
    }

    const draft = movementDraft(movement);
    const standard = Number(draft.standard || 0);
    const euro = Number(draft.euro || 0);
    const trolley = Number(draft.trolley || 0);

    if (![standard, euro, trolley].every(value => Number.isInteger(value) && value >= 0)) {
      setError('Quantities must be whole numbers of zero or more.');
      return;
    }

    setBusy(movement.movementKey);
    setError(null);
    try {
      await api.setPlanningMovement(selectedRunId, movement.movementKey, standard, euro, trolley);
      signalPlanningChange();
      setDrafts(current => {
        const next = { ...current };
        delete next[movement.movementKey];
        return next;
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not allocate movement.');
    } finally {
      setBusy(null);
    }
  }

  async function updateRun(run: PlanningRun, patch: Record<string, unknown>) {
    setBusy(run.id);
    setError(null);
    try {
      await api.updatePlanningRun(run.id, {
        driverId: patch.driverId ?? run.driverId ?? null,
        vehicleId: patch.vehicleId ?? run.vehicleId ?? null,
        trailerId: patch.trailerId ?? run.trailerId ?? null,
        startTime: patch.startTime ?? run.startTime ?? null,
        nightOut: patch.nightOut ?? run.nightOut,
        trailerSwapNotes: patch.trailerSwapNotes ?? run.trailerSwapNotes ?? null,
        notes: patch.notes ?? run.notes ?? null,
        capacityOverrideReason: patch.capacityOverrideReason ?? run.capacityOverrideReason ?? null,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update run.');
    } finally {
      setBusy(null);
    }
  }

  function openPalletControl() {
    const url = `/planning/pallet-control?date=${encodeURIComponent(date)}`;
    window.open(url, 'slh-v2-pallet-control', 'width=1600,height=950,resizable=yes,scrollbars=yes');
  }

  return (
    <section className="planning-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Planning package</p>
          <h1>Run Builder</h1>
          <p>Orders stay simple on the left; runs are built on the right. Quantities and Pallet Control update from the same allocation records.</p>
        </div>
        <div className="planning-header-actions">
          <label>Planning date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <button className="button secondary" onClick={() => void refresh()}>Refresh</button>
          <button className="button" onClick={openPalletControl}>Open Pallet Control</button>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="planning-layout">
        <aside className="orders-column panel">
          <div className="orders-column-header">
            <div><p className="eyebrow">Orders to plan</p><h2>Available movements</h2></div>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search collect or delivery…" />
          </div>

          {(['AM', 'PM'] as const).map(period => (
            <section className="order-period" key={period}>
              <div className="order-period-title">
                <strong>{period}</strong>
                <span>{grouped[period].length}</span>
              </div>
              {grouped[period].map(movement => {
                const draft = movementDraft(movement);
                return (
                  <article className="movement-card" key={movement.movementKey}>
                    <div className="movement-line">
                      <span>Collect</span>
                      <strong>{movement.collectionSite}</strong>
                    </div>
                    <div className="movement-qty">{qtyLabel(movement)}</div>
                    <div className="movement-line">
                      <span>Deliver</span>
                      <strong>{movement.deliverySite}</strong>
                    </div>
                    <small>{movement.orderCount} source order{movement.orderCount === 1 ? '' : 's'}</small>

                    <div className="movement-editor">
                      <label>Std<input type="number" min="0" value={draft.standard} onChange={e => setDrafts(x => ({ ...x, [movement.movementKey]: { ...draft, standard: e.target.value } }))} /></label>
                      <label>Euro<input type="number" min="0" value={draft.euro} onChange={e => setDrafts(x => ({ ...x, [movement.movementKey]: { ...draft, euro: e.target.value } }))} /></label>
                      <label>Trolley<input type="number" min="0" value={draft.trolley} onChange={e => setDrafts(x => ({ ...x, [movement.movementKey]: { ...draft, trolley: e.target.value } }))} /></label>
                      <button className="button" disabled={!selectedRunId || busy === movement.movementKey} onClick={() => void saveMovement(movement)}>
                        {busy === movement.movementKey ? 'Saving…' : 'Add / Update'}
                      </button>
                    </div>
                  </article>
                );
              })}
              {!grouped[period].length && <div className="master-empty">No {period} movements waiting.</div>}
            </section>
          ))}
        </aside>

        <main className="run-builder">
          <div className="run-builder-toolbar panel">
            <div>
              <p className="eyebrow">Runs</p>
              <h2>Build the plan</h2>
            </div>
            <div className="review-actions">
              <button className="button secondary" disabled={busy === 'create-AM'} onClick={() => void createRun('AM')}>+ AM Run</button>
              <button className="button secondary" disabled={busy === 'create-PM'} onClick={() => void createRun('PM')}>+ PM Run</button>
            </div>
          </div>

          <div className="run-grid">
            {(snapshot?.runs ?? []).map(run => (
              <article
                className={`run-card ${selectedRunId === run.id ? 'selected' : ''} ${run.capacity.status === 'red' ? 'over-capacity' : ''}`}
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
              >
                <div className="run-card-header">
                  <div>
                    <span className="status-chip live">{periodLabel(run.period)}</span>
                    <h3>{run.runNumber}</h3>
                  </div>
                  <div className={capacityClass(run.capacity.status)}>
                    <strong>{run.capacity.utilisationPercent != null ? `${run.capacity.utilisationPercent}%` : 'Capacity'}</strong>
                    <span>{run.capacity.message}</span>
                  </div>
                </div>

                <div className="run-master-selects">
                  <label>
                    Driver
                    <select value={run.driverId ?? ''} onChange={e => void updateRun(run, { driverId: e.target.value || null })}>
                      <option value="">Select driver</option>
                      {drivers.map(driver => <option key={driver.id} value={driver.id}>{String(driver.displayName ?? driver.employeeNumber ?? '')}</option>)}
                    </select>
                  </label>
                  <label>
                    Vehicle
                    <select value={run.vehicleId ?? ''} onChange={e => void updateRun(run, { vehicleId: e.target.value || null })}>
                      <option value="">Select vehicle</option>
                      {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{String(vehicle.registration ?? '')}</option>)}
                    </select>
                  </label>
                  <label>
                    Trailer
                    <select value={run.trailerId ?? ''} onChange={e => void updateRun(run, { trailerId: e.target.value || null })}>
                      <option value="">Select trailer</option>
                      {trailers.map(trailer => <option key={trailer.id} value={trailer.id}>{String(trailer.trailerNumber ?? '')}</option>)}
                    </select>
                  </label>
                </div>

                <div className="run-quantities">
                  <span><small>Standard</small><strong>{run.capacity.standardPallets}</strong></span>
                  <span><small>Euro</small><strong>{run.capacity.euroPallets}</strong></span>
                  <span><small>Trolleys</small><strong>{run.capacity.trolleys}</strong></span>
                </div>

                <div className="run-movements">
                  {run.movements.map(movement => {
                    const key = `${run.id}|${movement.movementKey}`;
                    const draft = builtMovementDraft(run, movement);
                    return (
                      <div className="run-movement" key={movement.movementKey}>
                        <div className="run-movement-route">
                          <strong>{movement.collectionSite} → {movement.deliverySite}</strong>
                          <span>{movement.standardPallets} Std · {movement.euroPallets} Euro · {movement.trolleys} Trolley</span>
                        </div>
                        <div className="run-movement-editor" onClick={event => event.stopPropagation()}>
                          <label>Std<input type="number" min="0" value={draft.standard} onChange={e => setRunDrafts(x => ({ ...x, [key]: { ...draft, standard: e.target.value } }))} /></label>
                          <label>Euro<input type="number" min="0" value={draft.euro} onChange={e => setRunDrafts(x => ({ ...x, [key]: { ...draft, euro: e.target.value } }))} /></label>
                          <label>Trolley<input type="number" min="0" value={draft.trolley} onChange={e => setRunDrafts(x => ({ ...x, [key]: { ...draft, trolley: e.target.value } }))} /></label>
                          <button className="button secondary" disabled={busy === key} onClick={() => void saveBuiltMovement(run, movement)}>
                            {busy === key ? 'Saving…' : 'Update'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!run.movements.length && <span className="muted">Select this run, then add movements from the left.</span>}
                </div>

                {run.capacity.status === 'red' && (
                  <label className="capacity-override">
                    Override reason
                    <input
                      defaultValue={run.capacityOverrideReason ?? ''}
                      placeholder="Required if this over-capacity plan is intentional"
                      onBlur={e => void updateRun(run, { capacityOverrideReason: e.target.value || null })}
                    />
                  </label>
                )}
              </article>
            ))}
            {!snapshot?.runs.length && <div className="panel master-empty">No runs yet. Create an AM or PM run to start planning.</div>}
          </div>
        </main>
      </div>
    </section>
  );
}
