import { useEffect, useMemo, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';

type Tracking = {
  latitude: number;
  longitude: number;
  speedKph?: number;
  isMoving?: boolean;
  ignitionOn?: boolean;
  lastKnownStatus?: string;
  lastEventTimeUtc: string;
};

type Run = {
  id: string;
  reference: string;
  planningDate: string;
  status: string;
  driverId?: string;
  driverName?: string;
  driverEmployeeNumber?: string;
  vehicleId?: string;
  vehicleRegistration?: string;
  vehicleFleetNumber?: string;
  trailerId?: string;
  trailerNumber?: string;
  pallets?: number;
  capacity?: number;
  firstStop?: string;
  finalStop?: string;
  nextPlannedUtc?: string;
  tracking?: Tracking;
};

type Driver = {
  id: string;
  employeeNumber: string;
  displayName: string;
  driverType?: string;
  driverGroup?: string;
  mobileNumber?: string;
  assigned: boolean;
  currentRuns: Array<{ id: string; reference: string; status: string; vehicleRegistration?: string; firstStop?: string; finalStop?: string }>;
};

type Vehicle = {
  id: string;
  registration: string;
  fleetNumber?: string;
  abbreviation?: string;
  vehicleSite?: string;
  fuelProvider?: string;
  fuelCardLastFour?: string;
  cabMobile?: string;
  assigned: boolean;
  currentRuns: Array<{ id: string; reference: string; status: string; driverName?: string; firstStop?: string; finalStop?: string }>;
  tracking?: Tracking;
};

type Trailer = { id: string; trailerNumber: string; type?: string };

type Snapshot = {
  planningDate: string;
  generatedAtUtc: string;
  summary: { runs: number; active: number; unallocated: number; exceptions: number };
  drivers: Driver[];
  vehicles: Vehicle[];
  trailers: Trailer[];
  runs: Run[];
};

type FuelReveal = {
  id: string;
  registration: string;
  fuelProvider?: string;
  fuelPin?: string;
  fuelCardLastFour?: string;
  shellCard?: string;
  bpRedCard?: string;
  bpPlainCard?: string;
};

const todayLocal = () => {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
};

const shortTime = (value?: string) => value ? new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';

const mapsUrl = (tracking?: Tracking) =>
  tracking ? `https://maps.apple.com/?ll=${tracking.latitude},${tracking.longitude}&q=Vehicle%20location` : undefined;

export function MobileOperations() {
  const accessToken = useAccessToken();
  const [date, setDate] = useState(todayLocal);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [editDriverId, setEditDriverId] = useState('');
  const [editVehicleId, setEditVehicleId] = useState('');
  const [editTrailerId, setEditTrailerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [fuelVehicleId, setFuelVehicleId] = useState('');
  const [fuelReveal, setFuelReveal] = useState<FuelReveal>();
  const [revealingFuel, setRevealingFuel] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const token = await accessToken();
      setSnapshot(await request<Snapshot>(`/api/v1/mobile/snapshot?date=${encodeURIComponent(date)}`, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mobile operations could not load.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [date]);

  const selectedRun = snapshot?.runs.find(run => run.id === selectedRunId);

  useEffect(() => {
    if (!selectedRun) return;
    setEditDriverId(selectedRun.driverId ?? '');
    setEditVehicleId(selectedRun.vehicleId ?? '');
    setEditTrailerId(selectedRun.trailerId ?? '');
  }, [selectedRunId, selectedRun]);

  const matchingDrivers = useMemo(() => {
    if (!snapshot) return [];
    const q = query.trim().toLowerCase();
    if (!q) return snapshot.drivers.slice(0, 8);
    return snapshot.drivers.filter(driver =>
      [driver.displayName, driver.employeeNumber, driver.driverType, driver.driverGroup]
        .some(value => value?.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [query, snapshot]);

  const matchingVehicles = useMemo(() => {
    if (!snapshot) return [];
    const q = query.trim().toLowerCase().replace(/\s/g, '');
    if (!q) return snapshot.vehicles.slice(0, 8);
    return snapshot.vehicles.filter(vehicle =>
      [vehicle.registration, vehicle.fleetNumber, vehicle.abbreviation]
        .some(value => value?.toLowerCase().replace(/\s/g, '').includes(q))
    ).slice(0, 20);
  }, [query, snapshot]);

  const saveAllocation = async () => {
    if (!selectedRun) return;
    setSaving(true);
    setError(undefined);
    try {
      const token = await accessToken();
      await request(`/api/v1/loads/${selectedRun.id}/allocation`, token, {
        method: 'PUT',
        body: JSON.stringify({
          driverId: editDriverId || null,
          vehicleId: editVehicleId || null,
          trailerId: editTrailerId || null
        })
      });
      setSelectedRunId(undefined);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Allocation could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const revealFuelPin = async () => {
    if (!fuelVehicleId) return;
    setRevealingFuel(true);
    setFuelReveal(undefined);
    setError(undefined);
    try {
      const token = await accessToken();
      setFuelReveal(await request<FuelReveal>(`/api/v1/mobile/fuel-pin/${fuelVehicleId}`, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fuel details could not be revealed.');
    } finally {
      setRevealingFuel(false);
    }
  };

  return <section className="slh-mobile">
    <header className="slh-mobile-hero">
      <div>
        <p className="eyebrow">SLH Mobile</p>
        <h1>Quick operations</h1>
        <p>Driver, vehicle, run, tracking and fuel information without opening the full planner.</p>
      </div>
      <label className="slh-mobile-date">Working date
        <input type="date" value={date} onChange={event => setDate(event.target.value)} />
      </label>
    </header>

    {error && <div className="slh-mobile-alert" role="alert">{error}</div>}

    <div className="slh-mobile-kpis">
      <div><strong>{snapshot?.summary.active ?? '—'}</strong><span>Active runs</span></div>
      <div><strong>{snapshot?.summary.unallocated ?? '—'}</strong><span>Unallocated</span></div>
      <div><strong>{snapshot?.summary.exceptions ?? '—'}</strong><span>Need attention</span></div>
    </div>

    <section className="slh-mobile-card">
      <div className="slh-mobile-card-head">
        <div><p className="eyebrow">Lookup</p><h2>Who’s on what?</h2></div>
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <input
        className="slh-mobile-search"
        type="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Search driver, employee no. or vehicle reg"
      />
      <div className="slh-mobile-lookup-grid">
        <div>
          <h3>Drivers</h3>
          {matchingDrivers.map(driver => <article key={driver.id} className="slh-mobile-result">
            <div><strong>{driver.displayName}</strong><small>{driver.employeeNumber}{driver.driverType ? ` · ${driver.driverType}` : ''}</small></div>
            {driver.currentRuns.length ? driver.currentRuns.map(run => <button key={run.id} onClick={() => setSelectedRunId(run.id)}>
              {run.reference} · {run.vehicleRegistration || 'No vehicle'} · {run.firstStop || '—'} → {run.finalStop || '—'}
            </button>) : <span className="slh-mobile-muted">No run allocated for this date</span>}
          </article>)}
        </div>
        <div>
          <h3>Vehicles</h3>
          {matchingVehicles.map(vehicle => <article key={vehicle.id} className="slh-mobile-result">
            <div><strong>{vehicle.registration}</strong><small>{vehicle.fleetNumber || vehicle.abbreviation || 'Fleet vehicle'}</small></div>
            {vehicle.currentRuns.length ? vehicle.currentRuns.map(run => <button key={run.id} onClick={() => setSelectedRunId(run.id)}>
              {run.reference} · {run.driverName || 'No driver'} · {run.firstStop || '—'} → {run.finalStop || '—'}
            </button>) : <span className="slh-mobile-muted">No run allocated for this date</span>}
            {vehicle.tracking && <a href={mapsUrl(vehicle.tracking)} target="_blank" rel="noreferrer">View live location · {shortTime(vehicle.tracking.lastEventTimeUtc)}</a>}
          </article>)}
        </div>
      </div>
    </section>

    <section className="slh-mobile-card">
      <div className="slh-mobile-card-head"><div><p className="eyebrow">Today</p><h2>Runs</h2></div><span>{snapshot?.runs.length ?? 0}</span></div>
      <div className="slh-mobile-runs">
        {snapshot?.runs.map(run => <article key={run.id} className={`slh-mobile-run ${!run.driverId || !run.vehicleId ? 'needs-attention' : ''}`}>
          <div className="slh-mobile-run-top">
            <div><strong>{run.reference}</strong><span>{run.status}</span></div>
            <button onClick={() => setSelectedRunId(run.id)}>Change</button>
          </div>
          <dl>
            <div><dt>Driver</dt><dd>{run.driverName || 'Unallocated'}</dd></div>
            <div><dt>Vehicle</dt><dd>{run.vehicleRegistration || 'Unallocated'}</dd></div>
            <div><dt>Trailer</dt><dd>{run.trailerNumber || '—'}</dd></div>
            <div><dt>Pallets</dt><dd>{run.pallets ?? '—'}{run.capacity ? ` / ${run.capacity}` : ''}</dd></div>
          </dl>
          <p className="slh-mobile-route">{run.firstStop || '—'} <span>→</span> {run.finalStop || '—'}</p>
          <div className="slh-mobile-run-actions">
            {run.tracking && <a href={mapsUrl(run.tracking)} target="_blank" rel="noreferrer">Live tracking</a>}
            <span>Next: {shortTime(run.nextPlannedUtc)}</span>
          </div>
        </article>)}
      </div>
    </section>

    <section className="slh-mobile-card">
      <div className="slh-mobile-card-head"><div><p className="eyebrow">Restricted</p><h2>Fuel PIN lookup</h2></div></div>
      <p className="slh-mobile-muted">Fuel details are revealed on request and the access is audited against your Microsoft sign-in.</p>
      <div className="slh-mobile-inline">
        <select value={fuelVehicleId} onChange={event => { setFuelVehicleId(event.target.value); setFuelReveal(undefined); }}>
          <option value="">Select vehicle</option>
          {snapshot?.vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration}{vehicle.fleetNumber ? ` · ${vehicle.fleetNumber}` : ''}</option>)}
        </select>
        <button className="primary" onClick={() => void revealFuelPin()} disabled={!fuelVehicleId || revealingFuel}>{revealingFuel ? 'Checking…' : 'Reveal PIN'}</button>
      </div>
      {fuelReveal && <div className="slh-mobile-fuel-reveal">
        <strong>{fuelReveal.registration}</strong>
        <span>{fuelReveal.fuelProvider || 'Fuel provider not recorded'}</span>
        <b>{fuelReveal.fuelPin || 'No PIN recorded'}</b>
        {fuelReveal.fuelCardLastFour && <small>Card ending {fuelReveal.fuelCardLastFour}</small>}
      </div>}
    </section>

    {selectedRun && <div className="slh-mobile-sheet-backdrop" role="presentation" onClick={() => setSelectedRunId(undefined)}>
      <section className="slh-mobile-sheet" role="dialog" aria-modal="true" aria-label="Change allocation" onClick={event => event.stopPropagation()}>
        <div className="slh-mobile-card-head"><div><p className="eyebrow">Quick allocation</p><h2>{selectedRun.reference}</h2></div><button onClick={() => setSelectedRunId(undefined)}>Close</button></div>
        <label>Driver
          <select value={editDriverId} onChange={event => setEditDriverId(event.target.value)}>
            <option value="">Unallocated</option>
            {snapshot?.drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.displayName} · {driver.employeeNumber}</option>)}
          </select>
        </label>
        <label>Vehicle
          <select value={editVehicleId} onChange={event => setEditVehicleId(event.target.value)}>
            <option value="">Unallocated</option>
            {snapshot?.vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration}{vehicle.fleetNumber ? ` · ${vehicle.fleetNumber}` : ''}</option>)}
          </select>
        </label>
        <label>Trailer
          <select value={editTrailerId} onChange={event => setEditTrailerId(event.target.value)}>
            <option value="">No trailer</option>
            {snapshot?.trailers.map(trailer => <option key={trailer.id} value={trailer.id}>{trailer.trailerNumber}{trailer.type ? ` · ${trailer.type}` : ''}</option>)}
          </select>
        </label>
        <button className="primary slh-mobile-save" onClick={() => void saveAllocation()} disabled={saving}>{saving ? 'Saving…' : 'Save allocation'}</button>
      </section>
    </div>}
  </section>;
}

export default MobileOperations;
