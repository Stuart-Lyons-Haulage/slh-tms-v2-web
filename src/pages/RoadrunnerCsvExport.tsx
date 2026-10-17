import { useCallback, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { listRuns } from '../api/runs';
import {
  buildRoadrunnerOrdersExport,
  buildRoadrunnerRunExport,
  roadRunnerOrderRowsToCsv,
  roadRunnerRowsToCsv,
} from './roadrunnerCsv';

type ExportMode = 'orders' | 'runs';

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

function normaliseStatus(value?: string) {
  return String(value || '').trim().toLowerCase();
}

export function RoadrunnerCsvExport() {
  const token = useAccessToken();
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<ExportMode>('orders');
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  const runs = useApi(useCallback(async () => listRuns(date, await token()), [date, token]));
  const orders = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token]));
  const customers = useApi(useCallback(async () => api.customers(await token()), [token]));
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const sites = useApi(useCallback(async () => api.sites(await token()), [token]));

  const eligibleRuns = useMemo(
    () => (runs.data || []).filter(run => normaliseStatus(run.status) !== 'cancelled' && run.stops.length > 0),
    [runs.data],
  );

  const eligibleOrders = useMemo(
    () => (orders.data || []).filter(order => !['cancelled', 'canceled'].includes(normaliseStatus(order.status))),
    [orders.data],
  );

  const activeRunIds = useMemo(
    () => selectedRunIds.size ? selectedRunIds : new Set(eligibleRuns.map(run => run.id)),
    [eligibleRuns, selectedRunIds],
  );

  const activeOrderIds = useMemo(
    () => selectedOrderIds.size ? selectedOrderIds : new Set(eligibleOrders.map(order => order.id)),
    [eligibleOrders, selectedOrderIds],
  );

  const selectedRuns = useMemo(
    () => eligibleRuns.filter(run => activeRunIds.has(run.id)),
    [activeRunIds, eligibleRuns],
  );

  const selectedOrders = useMemo(
    () => eligibleOrders.filter(order => activeOrderIds.has(order.id)),
    [activeOrderIds, eligibleOrders],
  );

  const runExport = useMemo(
    () => buildRoadrunnerRunExport(selectedRuns, orders.data || [], drivers.data || [], vehicles.data || []),
    [selectedRuns, orders.data, drivers.data, vehicles.data],
  );

  const orderExport = useMemo(
    () => buildRoadrunnerOrdersExport(selectedOrders, sites.data || [], customers.data || []),
    [selectedOrders, sites.data, customers.data],
  );

  const loading = runs.loading || orders.loading || customers.loading || drivers.loading || vehicles.loading || sites.loading;
  const error = runs.error || orders.error || customers.error || drivers.error || vehicles.error || sites.error;

  const issues = mode === 'orders' ? orderExport.issues : runExport.issues;
  const blocking = issues.filter(issue => issue.severity === 'error');
  const warnings = issues.filter(issue => issue.severity === 'warning');

  function resetSelection() {
    setSelectedRunIds(new Set());
    setSelectedOrderIds(new Set());
  }

  function toggleRun(id: string) {
    setSelectedRunIds(current => {
      const next = new Set(current.size ? current : eligibleRuns.map(run => run.id));
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleOrder(id: string) {
    setSelectedOrderIds(current => {
      const next = new Set(current.size ? current : eligibleOrders.map(order => order.id));
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (mode === 'orders') setSelectedOrderIds(new Set(eligibleOrders.map(order => order.id)));
    else setSelectedRunIds(new Set(eligibleRuns.map(run => run.id)));
  }

  function clearAll() {
    if (mode === 'orders') setSelectedOrderIds(new Set(['__none__']));
    else setSelectedRunIds(new Set(['__none__']));
  }

  function exportCsv() {
    if (mode === 'orders') {
      const csv = roadRunnerOrderRowsToCsv(orderExport.rows);
      if (csv) downloadCsv(csv, `SLH-Roadrunner-Consignments-${date}.csv`);
      return;
    }

    const csv = roadRunnerRowsToCsv(runExport.rows);
    if (csv) downloadCsv(csv, `SLH-Roadrunner-Runs-${date}.csv`);
  }

  const exportRowCount = mode === 'orders' ? orderExport.rows.length : runExport.rows.length;
  const selectedCount = mode === 'orders' ? selectedOrders.length : selectedRuns.length;
  const availableCount = mode === 'orders' ? eligibleOrders.length : eligibleRuns.length;

  return <section className="panel">
    <div className="title-row">
      <div>
        <p className="eyebrow">Admin · Road Tech test integration</p>
        <h2>Roadrunner CSV exports</h2>
        <p className="hint">
          Consignment export keeps every TMS order separate and enriches it from Customer and Site Master before download.
          PO/POS, customer reference, Roadrunner site identity, addresses, booked windows and quantities are retained for Consignment Import mapping.
          Nothing is sent automatically.
        </p>
      </div>
      <label>Planning date <input type="date" value={date} onChange={event => { setDate(event.target.value); resetSelection(); }} /></label>
    </div>

    <div className="button-row">
      <button type="button" onClick={() => setMode('orders')} disabled={mode === 'orders'}>Consignment export</button>
      <button type="button" onClick={() => setMode('runs')} disabled={mode === 'runs'}>Runs export</button>
    </div>

    {mode === 'orders'
      ? <p className="hint"><strong>Consignment CSV:</strong> one row per TMS order with no merging. PO/POS is preserved exactly, Cust Ref uses the PO/POS where available, Cons Ref keeps the stable TMS order reference, and collection/delivery details are enriched from the linked Site Master/Roadrunner profile before falling back to the order.</p>
      : <p className="hint"><strong>Runs CSV:</strong> detailed SLH test export retaining run, order, driver, TachoMaster, vehicle and tracking identifiers. This remains a diagnostic export rather than the Roadrunner Consignment Import file.</p>}

    {error && <p className="notice error">{error}</p>}
    {loading ? <p className="hint">Loading Roadrunner export data…</p> : <>
      <div className="metrics">
        <article className="metric"><span>{mode === 'orders' ? 'Orders' : 'Built runs'}</span><strong>{availableCount}</strong><small>{selectedCount} selected</small></article>
        <article className="metric"><span>CSV rows</span><strong>{exportRowCount}</strong><small>{mode === 'orders' ? 'One row per selected order · never merged' : 'One row per linked order'}</small></article>
        <article className="metric"><span>Blocking gaps</span><strong>{blocking.length}</strong><small>{mode === 'orders' ? 'Missing reference/date/company' : 'Missing driver/vehicle or empty run'}</small></article>
        <article className="metric"><span>Warnings</span><strong>{warnings.length}</strong><small>{mode === 'orders' ? 'Missing PO/POS, Master link, postcode or booked time' : 'Missing matching identifiers'}</small></article>
      </div>

      <div className="button-row">
        <button type="button" onClick={selectAll}>Select all</button>
        <button type="button" onClick={clearAll}>Clear</button>
        <button type="button" onClick={exportCsv} disabled={!exportRowCount}>
          {mode === 'orders' ? 'Export Consignment CSV' : 'Export Runs CSV'}
        </button>
      </div>

      {issues.length > 0 && <div className="panel">
        <h3>Export checks</h3>
        <div className="stack-list">
          {issues.slice(0, 20).map((issue, index) => {
            const reference = 'orderReference' in issue ? issue.orderReference : issue.runReference;
            const key = 'orderId' in issue ? issue.orderId : issue.runId;
            return <div key={`${key}-${index}`} className={issue.severity === 'error' ? 'notice error' : 'notice'}>
              <strong>{reference}</strong> · {issue.message}
            </div>;
          })}
        </div>
        {issues.length > 20 && <p className="hint">Plus {issues.length - 20} more checks.</p>}
      </div>}

      {mode === 'orders' ? <div className="table-scroll">
        <table>
          <thead><tr><th>Export</th><th>Reference / PO</th><th>Status</th><th>Collection</th><th>Delivery</th><th>Pallets</th><th>Master mapping</th></tr></thead>
          <tbody>{eligibleOrders.map(order => {
            const collectionSite = (sites.data || []).find(item => item.id === order.collectionSiteId);
            const deliverySite = (sites.data || []).find(item => item.id === order.deliverySiteId);
            return <tr key={order.id}>
              <td><input type="checkbox" checked={activeOrderIds.has(order.id)} onChange={() => toggleOrder(order.id)} /></td>
              <td><strong>{order.reference}</strong><br /><small>PO/POS: {order.purchaseOrderNumber || order.poNumber || '—'}</small></td>
              <td>{order.status}</td>
              <td>{order.collectionLocation || collectionSite?.name || '—'}<br /><small>{order.collectionDate}</small></td>
              <td>{order.deliveryLocation || deliverySite?.name || '—'}<br /><small>{order.deliveryDate || 'No date'}</small></td>
              <td>{order.pallets ?? '—'}</td>
              <td>
                <small>Collect: {collectionSite?.roadrunnerCode || collectionSite?.externalCode || (collectionSite ? 'Master linked' : 'Not linked')}</small><br />
                <small>Deliver: {deliverySite?.roadrunnerCode || deliverySite?.externalCode || (deliverySite ? 'Master linked' : 'Not linked')}</small>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <div className="table-scroll">
        <table>
          <thead><tr><th>Export</th><th>Run</th><th>Status</th><th>Driver</th><th>Vehicle</th><th>Stops</th><th>Rows</th></tr></thead>
          <tbody>{eligibleRuns.map(run => {
            const driver = (drivers.data || []).find(item => item.id === run.driverId);
            const vehicle = (vehicles.data || []).find(item => item.id === run.vehicleId);
            const rowCount = runExport.rows.filter(row => row.RunId === run.id).length;
            return <tr key={run.id}>
              <td><input type="checkbox" checked={activeRunIds.has(run.id)} onChange={() => toggleRun(run.id)} /></td>
              <td><strong>{run.reference}</strong><br /><small>{run.routeName || run.wave || run.planningDate}</small></td>
              <td>{run.status}</td>
              <td>{driver ? <>{driver.displayName}<br /><small>{driver.employeeNumber || driver.tachoMasterDriverId || 'No match ID'}</small></> : 'Not allocated'}</td>
              <td>{vehicle ? <>{vehicle.registration}<br /><small>{vehicle.fleetNumber || vehicle.trackingIdentifier || 'No match ID'}</small></> : 'Not allocated'}</td>
              <td>{run.stops.length}</td>
              <td>{rowCount}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}

      {mode === 'orders' && !eligibleOrders.length && <p className="hint">No non-cancelled orders were found for {date}.</p>}
      {mode === 'runs' && !eligibleRuns.length && <p className="hint">No non-cancelled runs with stops were found for {date}.</p>}

      <p className="hint">
        Use the Consignment CSV in Roadrunner Consignment Import and map only the Roadrunner fields you need. Extra columns are deliberately retained so the mapping can be expanded without another TMS change.
      </p>
    </>}
  </section>;
}
