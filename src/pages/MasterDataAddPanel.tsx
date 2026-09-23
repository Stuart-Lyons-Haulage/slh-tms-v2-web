import { useEffect, useMemo, useState } from 'react';
import { api, request, type MasterApplyResponse, type Vehicle } from '../lib/api';
import { useAccessToken } from '../lib/auth';

export type AddableMasterSection =
  | 'drivers'
  | 'vehicles'
  | 'trailers'
  | 'fuel-cards'
  | 'customers'
  | 'sites'
  | 'geofences'
  | 'markets'
  | 'fuel-prices';

type FormState = Record<string, string | number | boolean | undefined>;
type ApplyPayload = Record<string, string | number | boolean | undefined>;

const regions = ['North', 'Midlands', 'East', 'London', 'South East', 'South West', 'West / Wales', 'Other'];

const labels: Record<AddableMasterSection, string> = {
  drivers: 'driver',
  vehicles: 'vehicle',
  trailers: 'trailer',
  'fuel-cards': 'fuel card / PIN record',
  customers: 'customer',
  sites: 'site',
  geofences: 'approved geofences',
  markets: 'market contact',
  'fuel-prices': 'fuel price',
};

function initial(section: AddableMasterSection): FormState {
  switch (section) {
    case 'drivers': return { employeeNumber: '', displayName: '', mobileNumber: '', driverType: '', driverGroup: '', skills: '', coding: '', tachoName: '', northEligible: false, preloadEligible: false, drivingLicenceNumber: '', licenceExpiry: '', licenceStatus: '', notes: '', active: true };
    case 'vehicles': return { registration: '', fleetNumber: '', abbreviation: '', transmission: '', cabMobile: '', notes: '', active: true };
    case 'trailers': return { trailerNumber: '', type: '', standardCapacity: '', euroCapacity: '', notes: '', active: true };
    case 'fuel-cards': return { vehicleId: '', cabMobile: '', fuelProvider: '', fuelPin: '', shellCard: '', bpRedCard: '', bpPlainCard: '', notes: '' };
    case 'customers': return { code: '', name: '', active: true };
    case 'sites': return { externalCode: '', name: '', driverTextName: '', aliases: '', collectionAddress: '', collectionInstructions: '', mapLink: '', defaultTemperatureC: '', region: 'Other', active: true };
    case 'markets': return { market: '', name: '', standOrLocation: '', salesman: '', sender: '', active: true };
    case 'fuel-prices': return { weekCommencing: new Date().toISOString().slice(0, 10), provider: '', pricePencePerLitre: '', isPricingMaximum: false, source: 'Manual TMS entry', notes: '' };
    case 'geofences': return {};
  }
}

function text(value: FormState[string]) { return String(value ?? ''); }
function numberOrUndefined(value: FormState[string]) { return value === '' || value == null ? undefined : Number(value); }
function numberOrNull(value: FormState[string]) { return value === '' || value == null ? null : Number(value); }

export function MasterDataAddPanel({ section, onAdded }: { section: AddableMasterSection; onAdded: () => void }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => initial(section));
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setOpen(false);
    setForm(initial(section));
    setMessage(undefined);
    setError(undefined);
  }, [section]);

  useEffect(() => {
    if (section !== 'fuel-cards' || !open) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.vehicles(await token());
        if (!cancelled) setVehicles(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Vehicle register could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
  }, [open, section, token]);

  const selectedVehicle = useMemo(() => vehicles.find(vehicle => vehicle.id === text(form.vehicleId)), [form.vehicleId, vehicles]);

  function set(key: string, value: FormState[string]) { setForm(current => ({ ...current, [key]: value })); }

  async function apply(entityType: string, payload: ApplyPayload) {
    const result = await api.applyMasterData([{
      entityType,
      idempotencyKey: `manual:${entityType}:${Date.now()}`,
      source: 'Manual TMS Master Data',
      payload,
    }], await token()) as MasterApplyResponse;
    const first = result.results?.[0];
    if (result.failed > 0 && result.applied === 0 && !result.registered) throw new Error(first?.error || `Could not add ${entityType}.`);
    return result;
  }

  async function save() {
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      if (section === 'geofences') {
        const result = await request<{ supplied: number; inserted: number; updated: number; siteMatched: number }>('/api/v1/geofences/import-slh-seed', await token(), { method: 'POST' });
        setMessage(`${result.supplied} approved SLH geofences checked. ${result.updated} refreshed and ${result.siteMatched} linked to Sites.`);
        onAdded();
        return;
      }

      if (section === 'drivers') {
        if (!text(form.employeeNumber).trim() || !text(form.displayName).trim()) throw new Error('Employee number and driver name are required.');
        await apply('driver', { ...form, licenceExpiry: text(form.licenceExpiry).trim() || undefined });
      } else if (section === 'vehicles') {
        if (!text(form.registration).trim()) throw new Error('Registration is required.');
        await apply('vehicle', form);
      } else if (section === 'trailers') {
        if (!text(form.trailerNumber).trim()) throw new Error('Trailer number is required.');
        await apply('trailer', { ...form, standardCapacity: numberOrUndefined(form.standardCapacity), euroCapacity: numberOrUndefined(form.euroCapacity) });
      } else if (section === 'customers') {
        if (!text(form.code).trim() || !text(form.name).trim()) throw new Error('Customer code and customer name are required.');
        await apply('customer', form);
      } else if (section === 'sites') {
        const externalCode = text(form.externalCode).trim();
        const name = text(form.name).trim();
        if (!externalCode || !name) throw new Error('Site code and site name are required.');
        const temperature = numberOrNull(form.defaultTemperatureC);
        if (temperature != null && (!Number.isFinite(temperature) || temperature < -30 || temperature > 30)) throw new Error('Default temperature must be between -30°C and +30°C, or left blank.');
        const { defaultTemperatureC: _temperature, region: _region, ...sitePayload } = form;
        void _temperature; void _region;
        const result = await apply('site', sitePayload);
        if (result.applied > 0) {
          const sites = await request<Array<{ id: string; externalCode: string }>>('/api/v1/sites', await token());
          const created = sites.find(site => site.externalCode.trim().toLowerCase() === externalCode.toLowerCase());
          if (created) {
            await request(`/api/v1/site-planning-profiles/${created.id}`, await token(), {
              method: 'PUT',
              body: JSON.stringify({ defaultTemperatureC: temperature, region: text(form.region) || 'Other' }),
            });
          }
        }
      } else if (section === 'markets') {
        if (!text(form.market).trim() || !text(form.name).trim()) throw new Error('Market and contact/name are required.');
        await apply('marketcontact', form);
      } else if (section === 'fuel-prices') {
        const price = Number(form.pricePencePerLitre);
        if (!text(form.weekCommencing).trim() || !text(form.provider).trim() || !Number.isFinite(price) || price <= 0) throw new Error('Week commencing, provider and a valid pence-per-litre price are required.');
        await apply('fuelprice', { ...form, pricePencePerLitre: price });
      } else if (section === 'fuel-cards') {
        if (!selectedVehicle) throw new Error('Select the vehicle this fuel record belongs to.');
        await apply('vehicle', {
          registration: selectedVehicle.registration,
          fleetNumber: selectedVehicle.fleetNumber,
          abbreviation: selectedVehicle.abbreviation,
          transmission: selectedVehicle.transmission,
          dvsCompliant: selectedVehicle.dvsCompliant,
          cabMobile: text(form.cabMobile) || selectedVehicle.cabMobile,
          fuelProvider: text(form.fuelProvider) || selectedVehicle.fuelProvider,
          fuelPin: text(form.fuelPin) || selectedVehicle.fuelPin,
          shellCard: text(form.shellCard) || selectedVehicle.shellCard,
          bpRedCard: text(form.bpRedCard) || selectedVehicle.bpRedCard,
          bpPlainCard: text(form.bpPlainCard) || selectedVehicle.bpPlainCard,
          notes: text(form.notes) || selectedVehicle.notes,
          fuelPinSecretName: selectedVehicle.fuelPinSecretName,
          fuelCardLastFour: selectedVehicle.fuelCardLastFour,
          fleetioId: selectedVehicle.fleetioId,
          fleetioName: selectedVehicle.fleetioName,
          fleetioStatus: selectedVehicle.fleetioStatus,
          active: selectedVehicle.active,
        });
      }

      setMessage(`${labels[section][0].toUpperCase()}${labels[section].slice(1)} added to the Live TMS Master Database.`);
      setForm(initial(section));
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not add ${labels[section]}.`);
    } finally { setSaving(false); }
  }

  return <div className="panel" style={{ marginBottom: 18, border: '2px solid #d5e0e4' }}>
    <div className="title-row">
      <div>
        <p className="eyebrow">Add to master data</p>
        <h2>{section === 'geofences' ? 'Add / refresh approved geofences' : `Add new ${labels[section]}`}</h2>
        <p className="hint">{section === 'geofences' ? 'Live Runs uses the approved Falcon/SLH geofence set. Refreshing here brings that approved set back into the geofence view and repairs Site matching.' : `Create a new ${labels[section]} directly in this section. It will become available to the rest of the TMS after save.`}</p>
      </div>
      <button className={open ? '' : 'primary'} onClick={() => { setOpen(value => !value); setError(undefined); setMessage(undefined); }}>{open ? 'Close add form' : section === 'geofences' ? 'Open geofence controls' : `Add ${labels[section]}`}</button>
    </div>

    {message && <p className="notice inline-notice">{message}</p>}
    {error && <p className="notice inline-notice" style={{ borderColor: '#b42318' }}>{error}</p>}

    {open && <div>
      {section === 'drivers' && <div className="form-grid">
        <label>Employee number<input value={text(form.employeeNumber)} onChange={e => set('employeeNumber', e.target.value)} /></label>
        <label>Driver name<input value={text(form.displayName)} onChange={e => set('displayName', e.target.value)} /></label>
        <label>Mobile<input value={text(form.mobileNumber)} onChange={e => set('mobileNumber', e.target.value)} /></label>
        <label>Driver type<input value={text(form.driverType)} onChange={e => set('driverType', e.target.value)} /></label>
        <label>Driver group<input value={text(form.driverGroup)} onChange={e => set('driverGroup', e.target.value)} /></label>
        <label>Skills<input value={text(form.skills)} onChange={e => set('skills', e.target.value)} /></label>
        <label>Coding<input value={text(form.coding)} onChange={e => set('coding', e.target.value)} /></label>
        <label>Tacho name<input value={text(form.tachoName)} onChange={e => set('tachoName', e.target.value)} /></label>
        <label>Driving licence no.<input value={text(form.drivingLicenceNumber)} onChange={e => set('drivingLicenceNumber', e.target.value)} /></label>
        <label>Licence expiry<input type="date" value={text(form.licenceExpiry)} onChange={e => set('licenceExpiry', e.target.value)} /></label>
        <label>Licence status<input value={text(form.licenceStatus)} onChange={e => set('licenceStatus', e.target.value)} /></label>
        <label className="check-label"><input type="checkbox" checked={Boolean(form.northEligible)} onChange={e => set('northEligible', e.target.checked)} /> North eligible</label>
        <label className="check-label"><input type="checkbox" checked={Boolean(form.preloadEligible)} onChange={e => set('preloadEligible', e.target.checked)} /> Preload eligible</label>
        <label className="wide">Notes<textarea rows={2} value={text(form.notes)} onChange={e => set('notes', e.target.value)} /></label>
      </div>}

      {section === 'vehicles' && <div className="form-grid">
        <label>Registration<input value={text(form.registration)} onChange={e => set('registration', e.target.value.toUpperCase())} /></label>
        <label>Fleet number<input value={text(form.fleetNumber)} onChange={e => set('fleetNumber', e.target.value)} /></label>
        <label>Abbreviation / last 3<input value={text(form.abbreviation)} onChange={e => set('abbreviation', e.target.value.toUpperCase())} /></label>
        <label>Transmission<input value={text(form.transmission)} onChange={e => set('transmission', e.target.value)} /></label>
        <label>Cab mobile<input value={text(form.cabMobile)} onChange={e => set('cabMobile', e.target.value)} /></label>
        <label className="wide">Notes<textarea rows={2} value={text(form.notes)} onChange={e => set('notes', e.target.value)} /></label>
      </div>}

      {section === 'trailers' && <div className="form-grid">
        <label>Trailer number<input value={text(form.trailerNumber)} onChange={e => set('trailerNumber', e.target.value)} /></label>
        <label>Type<input value={text(form.type)} onChange={e => set('type', e.target.value)} /></label>
        <label>Standard capacity<input type="number" value={text(form.standardCapacity)} onChange={e => set('standardCapacity', e.target.value)} /></label>
        <label>Euro capacity<input type="number" value={text(form.euroCapacity)} onChange={e => set('euroCapacity', e.target.value)} /></label>
        <label className="wide">Notes<textarea rows={2} value={text(form.notes)} onChange={e => set('notes', e.target.value)} /></label>
      </div>}

      {section === 'fuel-cards' && <div className="form-grid">
        <label>Vehicle<select value={text(form.vehicleId)} onChange={e => set('vehicleId', e.target.value)}><option value="">Select vehicle…</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration}{vehicle.fleetNumber ? ` · ${vehicle.fleetNumber}` : ''}</option>)}</select></label>
        <label>Cab mobile<input value={text(form.cabMobile)} onChange={e => set('cabMobile', e.target.value)} /></label>
        <label>Fuel provider<input value={text(form.fuelProvider)} onChange={e => set('fuelProvider', e.target.value)} /></label>
        <label>Fuel PIN<input value={text(form.fuelPin)} onChange={e => set('fuelPin', e.target.value)} /></label>
        <label>Shell card<input value={text(form.shellCard)} onChange={e => set('shellCard', e.target.value)} /></label>
        <label>BP red card<input value={text(form.bpRedCard)} onChange={e => set('bpRedCard', e.target.value)} /></label>
        <label>BP plain card<input value={text(form.bpPlainCard)} onChange={e => set('bpPlainCard', e.target.value)} /></label>
        <label className="wide">Notes<textarea rows={2} value={text(form.notes)} onChange={e => set('notes', e.target.value)} /></label>
      </div>}

      {section === 'customers' && <div className="form-grid">
        <label>Customer code<input value={text(form.code)} onChange={e => set('code', e.target.value.toUpperCase())} /></label>
        <label>Customer name<input value={text(form.name)} onChange={e => set('name', e.target.value)} /></label>
      </div>}

      {section === 'sites' && <div className="form-grid">
        <label>Site code<input value={text(form.externalCode)} onChange={e => set('externalCode', e.target.value)} /></label>
        <label>Site name<input value={text(form.name)} onChange={e => set('name', e.target.value)} /></label>
        <label>Driver text name<input value={text(form.driverTextName)} onChange={e => set('driverTextName', e.target.value)} /></label>
        <label>Aliases<input value={text(form.aliases)} onChange={e => set('aliases', e.target.value)} /></label>
        <label>Default temperature °C<input type="number" step="0.5" min="-30" max="30" value={text(form.defaultTemperatureC)} onChange={e => set('defaultTemperatureC', e.target.value)} /></label>
        <label>Planning region<select value={text(form.region)} onChange={e => set('region', e.target.value)}>{regions.map(region => <option key={region}>{region}</option>)}</select></label>
        <label className="wide">Address / postcode<textarea rows={3} value={text(form.collectionAddress)} onChange={e => set('collectionAddress', e.target.value)} /></label>
        <label className="wide">Collection / driver instructions<textarea rows={3} value={text(form.collectionInstructions)} onChange={e => set('collectionInstructions', e.target.value)} /></label>
        <label className="wide">Map link<input value={text(form.mapLink)} onChange={e => set('mapLink', e.target.value)} /></label>
      </div>}

      {section === 'markets' && <div className="form-grid">
        <label>Market<input value={text(form.market)} onChange={e => set('market', e.target.value)} placeholder="Western, Spit, Covent, Sender…" /></label>
        <label>Name / business<input value={text(form.name)} onChange={e => set('name', e.target.value)} /></label>
        <label>Stand / location<input value={text(form.standOrLocation)} onChange={e => set('standOrLocation', e.target.value)} /></label>
        <label>Salesman<input value={text(form.salesman)} onChange={e => set('salesman', e.target.value)} /></label>
        <label>Sender<input value={text(form.sender)} onChange={e => set('sender', e.target.value)} /></label>
      </div>}

      {section === 'fuel-prices' && <div className="form-grid">
        <label>Week commencing<input type="date" value={text(form.weekCommencing)} onChange={e => set('weekCommencing', e.target.value)} /></label>
        <label>Provider<input value={text(form.provider)} onChange={e => set('provider', e.target.value)} /></label>
        <label>Price pence / litre<input type="number" step="0.01" value={text(form.pricePencePerLitre)} onChange={e => set('pricePencePerLitre', e.target.value)} /></label>
        <label>Source<input value={text(form.source)} onChange={e => set('source', e.target.value)} /></label>
        <label className="check-label"><input type="checkbox" checked={Boolean(form.isPricingMaximum)} onChange={e => set('isPricingMaximum', e.target.checked)} /> Pricing maximum</label>
        <label className="wide">Notes<textarea rows={2} value={text(form.notes)} onChange={e => set('notes', e.target.value)} /></label>
      </div>}

      {section === 'geofences' && <p className="notice">New operational geofences must remain part of the approved Falcon/SLH geofence set because Live Runs calculates entries and exits from that approved geometry. Use the button below to refresh that approved set and its Site links.</p>}

      <div className="actions" style={{ marginTop: 14 }}>
        <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : section === 'geofences' ? 'Refresh approved geofences' : `Save new ${labels[section]}`}</button>
        {section !== 'geofences' && <button disabled={saving} onClick={() => setForm(initial(section))}>Clear form</button>}
      </div>
    </div>}
  </div>;
}
