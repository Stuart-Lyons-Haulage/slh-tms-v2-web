import { useCallback, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { listRuns } from '../api/runs';
import { buildRoadrunnerExport, roadRunnerRowsToCsv } from './roadrunnerCsv';

function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function RoadrunnerCsvExport() {
  const token = useAccessToken();
  const [date, setDate] = useState(today());
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());

  const runs = useApi(useCallback(async () => listRuns(date, await token()), [date, token]));
  const orders = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token]));
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));

  const eligibleRuns = useMemo(
    () => (runs.data || []).filter(run => run.status.toLowerCase() !== 'cancelled' && run.stops.length > 0),
    [runs.data],
  );

  const activeIds = useMemo(() => {
    const source = selectedRunIds.size ? selectedRunIds : new Set(eligibleRuns.map(run => run.id));
    return source;
  }, [eligibleRuns, selectedRunIds]);

  const selectedRuns = useMemo(
    () => eligibleRuns.filter(run => activeIds.has(run.id)),
    [activeIds, eligibleRuns],
  );

  const exportData = useMemo(
    () => buildRoadrunnerExport(selectedRuns, orders.data || [], drivers.data || [], vehicles.data || []),
    [selectedRuns, orders.data, drivers.data, vehicles.data],
  );

  const loading = runs.loading || orders.loading || drivers.loading || vehicles.loading;
  const error = runs.error || orders.error || drivers.error || vehicles.error;
  const errors = exportData.issues.filter(issue => issue.severity === 'error');
  const warnings = exportData.issues.filter(issue => issue.severity === 'warning');

  function toggleRun(id: string) {
    setSelectedRunIds(current => {
      const next = new Set(current.size ? current : eligibleRuns.map(run => run.id));
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedRunIds(new Set(eligibleRuns.map(run => run.id)));
  }

  function clearAll() {
    setSelectedRunIds(new Set(['__none__']));
  }

  function exportCsv() {
    const csv = roadRunnerRowsToCsv(exportData.rows);
    if (!csv) return;
    downloadCsv(csv, `SLH-Roadrunner-${date}.csv`);
  }

  return <section className="panel">
    <div className="title-row">
      <div>
        <p className="eyebrow">Admin · Road Tech test integration</p>
        <h2>Roadrunner CSV export</h2>
        <p className="hint">Exports built runs with linked order, customer, driver, TachoMaster and vehicle/tracking identifiers. This is a test export only; it does not send anything to Roadrunner.</p>
      </div>
      <label>Planning date <input type="date" value={date} onChange={event => { setDate(event.target.value); setSelectedRunIds(new Set()); }} /></label>
    </div>

    {error && <p className="notice error">{error}</p>}
    {loading ? <p className="hint">Loading built runs and master data…</p> : <>
      <div className="metrics">
        <article className="metric"><span>Built runs</span><strong>{eligibleRuns.length}</strong><small>{selectedRuns.length} selected</small></article>
        <article className="metric"><span>CSV rows</span><strong>{exportData.rows.length}</strong><small>One row per linked order</small></article>
        <article className="metric"><span>Blocking gaps</span><strong>{errors.length}</strong><small>Missing driver/vehicle or empty run</small></article>
        <article className="metric"><span>Warnings</span><strong>{warnings.length}</strong><small>Missing matching identifiers</small></article>
      </div>

      <div className="button-row">
        <button type="button" onClick={selectAll}>Select all</button>
        <button type="button" onClick={clearAll}>Clear</button>
        <button type="button" onClick={exportCsv} disabled={!exportData.rows.length}>Export Roadrunner CSV</button>
      </div>

      {exportData.issues.length > 0 && <div className="panel">
        <h3>Export checks</h3>
        <div className="stack-list">
          {exportData.issues.slice(0, 20).map((issue, index) => <div key={`${issue.runId}-${index}`} className={issue.severity === 'error' ? 'notice error' : 'notice'}>
            <strong>{issue.runReference}</strong> · {issue.message}
          </div>)}
        </div>
        {exportData.issues.length > 20 && <p className="hint">Plus {exportData.issues.length - 20} more checks.</p>}
      </div>}

      <div className="table-scroll">
        <table>
          <thead><tr><th>Export</th><th>Run</th><th>Status</th><th>Driver</th><th>Vehicle</th><th>Stops</th><th>Rows</th></tr></thead>
          <tbody>{eligibleRuns.map(run => {
            const driver = (drivers.data || []).find(item => item.id === run.driverId);
            const vehicle = (vehicles.data || []).find(item => item.id === run.vehicleId);
            const rowCount = exportData.rows.filter(row => row.RunId === run.id).length;
            return <tr key={run.id}>
              <td><input type="checkbox" checked={activeIds.has(run.id)} onChange={() => toggleRun(run.id)} /></td>
              <td><strong>{run.reference}</strong><br /><small>{run.routeName || run.wave || run.planningDate}</small></td>
              <td>{run.status}</td>
              <td>{driver ? <>{driver.displayName}<br /><small>{driver.employeeNumber || driver.tachoMasterDriverId || 'No match ID'}</small></> : 'Not allocated'}</td>
              <td>{vehicle ? <>{vehicle.registration}<br /><small>{vehicle.fleetNumber || vehicle.trackingIdentifier || 'No match ID'}</small></> : 'Not allocated'}</td>
              <td>{run.stops.length}</td>
              <td>{rowCount}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      {!eligibleRuns.length && <p className="hint">No non-cancelled runs with stops were found for {date}.</p>}
      <p className="hint">Road Tech confirms RoadrunnerLive supports bulk CSV/XML and automated bulk CSV/XML, but its exact import column schema is not public. Keep this exporter in Admin until Road Tech supplies the official template, then we can map these stable source fields to their required headers.</p>
    </>}
  </section>;
}
