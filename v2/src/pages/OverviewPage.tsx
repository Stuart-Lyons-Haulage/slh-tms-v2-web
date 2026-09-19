import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, MasterCounts, PlanningSnapshot, ReviewAllocation } from '../lib/api';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function OverviewPage() {
  const [date, setDate] = useState(today());
  const [planning, setPlanning] = useState<PlanningSnapshot | null>(null);
  const [master, setMaster] = useState<MasterCounts | null>(null);
  const [review, setReview] = useState<ReviewAllocation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [planningData, masterData, reviewData] = await Promise.all([
        api.planningSnapshot(date),
        api.masterCounts(),
        api.reviewAllocations(),
      ]);
      setPlanning(planningData);
      setMaster(masterData);
      setReview(reviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dashboard could not refresh.');
    }
  }, [date]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const movements = planning?.movements ?? [];
    const runs = planning?.runs ?? [];
    const outstanding = movements.reduce(
      (sum, movement) =>
        sum
        + movement.remainingStandardPallets
        + movement.remainingEuroPallets
        + movement.remainingTrolleys,
      0,
    );
    const overCapacity = runs.filter(run => run.capacity.status === 'red').length;
    const capacityWarnings = runs.filter(run =>
      run.capacity.status === 'red'
      || run.capacity.status === 'amber'
      || run.capacity.status === 'rules-missing'
      || run.capacity.status === 'unknown',
    ).length;
    const unallocatedRuns = runs.filter(run => !run.driverId || !run.vehicleId || !run.trailerId).length;

    return {
      movements: movements.length,
      runs: runs.length,
      outstanding,
      overCapacity,
      capacityWarnings,
      unallocatedRuns,
    };
  }, [planning]);

  return (
    <section className="dashboard-v2">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Transport Control</h1>
          <p>One view of what is waiting, what is built and what needs attention.</p>
        </div>
        <div className="planning-header-actions">
          <label>Operating date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <button className="button secondary" onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="dashboard-metrics">
        <article className="dashboard-metric">
          <span>Orders to plan</span>
          <strong>{stats.movements}</strong>
          <small>{stats.outstanding} pallet/trolley units outstanding</small>
        </article>
        <article className="dashboard-metric">
          <span>Runs built</span>
          <strong>{stats.runs}</strong>
          <small>{stats.unallocatedRuns} still need driver/vehicle/trailer</small>
        </article>
        <article className={`dashboard-metric ${stats.capacityWarnings ? 'attention' : ''}`}>
          <span>Capacity warnings</span>
          <strong>{stats.capacityWarnings}</strong>
          <small>{stats.overCapacity} over capacity</small>
        </article>
        <article className={`dashboard-metric ${review.length ? 'attention' : ''}`}>
          <span>Master review</span>
          <strong>{review.length}</strong>
          <small>Relationships waiting for allocation</small>
        </article>
      </div>

      <div className="dashboard-two-column">
        <section className="panel dashboard-focus">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Planner focus</p>
              <h2>What needs action</h2>
            </div>
            <a className="button secondary" href="/planning">Open Planning</a>
          </div>

          <div className="dashboard-action-list">
            {stats.overCapacity > 0 && (
              <article className="dashboard-action urgent">
                <strong>{stats.overCapacity} run{stats.overCapacity === 1 ? '' : 's'} over capacity</strong>
                <span>Amend quantities/trailer or record a deliberate override.</span>
              </article>
            )}
            {stats.unallocatedRuns > 0 && (
              <article className="dashboard-action">
                <strong>{stats.unallocatedRuns} run{stats.unallocatedRuns === 1 ? '' : 's'} not fully allocated</strong>
                <span>Driver, vehicle or trailer still missing.</span>
              </article>
            )}
            {stats.movements > 0 && (
              <article className="dashboard-action">
                <strong>{stats.movements} movement{stats.movements === 1 ? '' : 's'} waiting</strong>
                <span>{stats.outstanding} outstanding units remain in Orders to Plan.</span>
              </article>
            )}
            {review.length > 0 && (
              <article className="dashboard-action">
                <strong>{review.length} Master Data review item{review.length === 1 ? '' : 's'}</strong>
                <span>Allocate unresolved records to the correct Site.</span>
              </article>
            )}
            {!stats.overCapacity && !stats.unallocatedRuns && !stats.movements && !review.length && (
              <div className="master-empty">No immediate planning decisions are outstanding for this date.</div>
            )}
          </div>
        </section>

        <section className="panel dashboard-focus">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Master Data</p>
              <h2>Operational register</h2>
            </div>
            <a className="button secondary" href="/master">Open Master Data</a>
          </div>
          <div className="dashboard-master-grid">
            <span><strong>{master?.sites ?? 0}</strong><small>Sites</small></span>
            <span><strong>{master?.drivers ?? 0}</strong><small>Drivers</small></span>
            <span><strong>{master?.vehicles ?? 0}</strong><small>Vehicles</small></span>
            <span><strong>{master?.trailers ?? 0}</strong><small>Trailers</small></span>
          </div>
          <p className="muted">Sage HR, TachoMaster, DOT tracking and Fleetio status will populate the live workforce/fleet panels once their API credentials are connected locally.</p>
        </section>
      </div>
    </section>
  );
}
