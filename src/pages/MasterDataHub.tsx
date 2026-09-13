import { useEffect, useState } from 'react';
import { FuelMaster } from './Pages';
import { DriversMasterCompact } from './DriversMasterCompact';
import { FleetMasterUnified } from './FleetMasterUnified';
import { FuelCardsOperational } from './FuelCardsOperational';
import { MarketsMasterClean } from './MarketsMasterClean';
import { MasterDataOperational, type MasterDataTab } from './MasterDataOperational';
import { GeofenceOperational } from './GeofenceOperational';
import { useAccessToken } from '../lib/auth';
import { request } from '../lib/api';

type MasterSection = MasterDataTab | 'fuel-cards' | 'markets' | 'fuel-prices';

const sections: Array<{ key: MasterSection; label: string; detail: string }> = [
  { key: 'drivers', label: 'Drivers', detail: 'Read-only operational driver register. Driver identity is enriched by TachoMaster; editable CRM fields are maintained in Microsoft Lists.' },
  { key: 'vehicles', label: 'Vehicles', detail: 'Read-only vehicle projection combining planning identity and Fleetio operational data.' },
  { key: 'trailers', label: 'Trailers', detail: 'Read-only trailer projection combining SLH identity, capacity and Fleetio data.' },
  { key: 'fuel-cards', label: 'Fuel cards & PINs', detail: 'Read-only vehicle fuel-card projection. Maintain governed values in Microsoft Lists.' },
  { key: 'sites', label: 'Sites', detail: 'Read-only operational site register including site wording, address, planning data and linked execution geofences.' },
  { key: 'markets', label: 'Markets', detail: 'Read-only market and contact projection from the governed Lists CRM.' },
  { key: 'fuel-prices', label: 'Fuel prices', detail: 'Read-only fuel pricing reference data.' },
];

function canonicalSection(value: MasterSection): MasterSection {
  return value === 'customers' || value === 'geofences' ? 'sites' : value;
}

export function MasterDataHub({ initialSection = 'drivers' }: { initialSection?: MasterSection }) {
  const [section, setSection] = useState<MasterSection>(() => canonicalSection(initialSection));
  const [syncingDrivers, setSyncingDrivers] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>();
  const token = useAccessToken();

  async function syncDriverIdentities() {
    setSyncingDrivers(true);
    setSyncMessage(undefined);
    try {
      const job = await request<{ message?: string }>('/api/v1/driver-master/tachomaster/sync', await token(), { method: 'POST' }, 15000);
      setSyncMessage(job.message || 'Canonical TachoMaster driver reconciliation queued. Refresh shortly to see the verified result.');
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Canonical driver reconciliation could not be queued.');
    } finally {
      setSyncingDrivers(false);
    }
  }

  useEffect(() => { setSection(canonicalSection(initialSection)); }, [initialSection]);

  const active = sections.find(item => item.key === section) || sections[0];

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Microsoft Lists CRM · read-only TMS projection</p>
        <h1>Master data</h1>
        <p className="intro">Microsoft Lists is the editable master-data authority. TMS keeps a read-only operational copy for planning, dispatch and integrations, refreshed automatically from Lists every 10 minutes.</p>
      </div>
      <div>
        <span className="status approved">Lists is authoritative</span>
        <p className="hint" style={{ maxWidth: 320, marginTop: 10 }}>Add, edit, archive and correct master records in Microsoft Lists. Integration-owned data such as TachoMaster and Fleetio continues to synchronise automatically.</p>
      </div>
    </div>

    <div className="panel master-section-panel" style={{ marginBottom: 18 }}>
      <div className="master-section-tabs horizontal-tabs" role="tablist" aria-label="Master data sections">
        {sections.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} className={section === item.key ? 'primary' : ''} onClick={() => setSection(item.key)}>{item.label}</button>)}
      </div>
      <p className="hint master-section-hint"><strong>{active.label}:</strong> {active.detail}</p>
    </div>

    <div className="notice inline-notice" style={{ marginBottom: 18 }}>
      <strong>Read only in TMS.</strong> Changes made here are intentionally disabled to prevent SQL and Microsoft Lists drifting apart.
    </div>

    {section === 'drivers' && <div className="actions" style={{ marginBottom: 18 }}>
      <button className="primary" onClick={() => void syncDriverIdentities()} disabled={syncingDrivers}>
        {syncingDrivers ? 'Queuing reconciliation…' : 'Reconcile TachoMaster driver identities'}
      </button>
      {syncMessage && <span className="notice inline-notice">{syncMessage}</span>}
    </div>}

    <div aria-readonly="true" style={{ pointerEvents: 'none' }}>
      {section === 'drivers' && <DriversMasterCompact />}
      {section === 'vehicles' && <FleetMasterUnified kind="vehicles" />}
      {section === 'trailers' && <FleetMasterUnified kind="trailers" />}
      {section === 'sites' && <>
        <MasterDataOperational initialTab="sites" showCategoryButtons={false} showHeading={false} />
        <div className="panel" style={{ marginTop: 18, marginBottom: 18 }}>
          <p className="eyebrow">Site execution evidence</p>
          <h2>Geofences attached to Site Master</h2>
          <p className="hint">RoadTech polygons remain execution evidence linked to the canonical Site record. Site and geofence master corrections are maintained through the governed Lists/integration process rather than edited in TMS.</p>
        </div>
        <GeofenceOperational />
      </>}
      {section === 'fuel-cards' && <FuelCardsOperational />}
      {section === 'markets' && <MarketsMasterClean />}
      {section === 'fuel-prices' && <FuelMaster />}
    </div>
  </section>;
}
