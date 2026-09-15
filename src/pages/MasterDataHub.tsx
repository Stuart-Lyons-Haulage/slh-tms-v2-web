import { useEffect, useState } from 'react';
import { FuelMaster } from './Pages';
import { DriversMasterCompact } from './DriversMasterCompact';
import { FleetMasterUnified } from './FleetMasterUnified';
import { FuelCardsOperational } from './FuelCardsOperational';
import { MarketsMasterClean } from './MarketsMasterClean';
import { MasterDataOperational, type MasterDataTab } from './MasterDataOperational';
import { GeofenceOperational } from './GeofenceOperational';
import { EmailIntakeMappings } from './EmailIntakeMappings';
import { useAccessToken } from '../lib/auth';
import { request } from '../lib/api';

type MasterSection = MasterDataTab | 'fuel-cards' | 'markets' | 'fuel-prices' | 'email-intake';

const sections: Array<{ key: MasterSection; label: string; detail: string }> = [
  { key: 'drivers', label: 'Drivers', detail: 'SQL driver register. TachoMaster updates tachograph identity; approved staff maintain operational details here.' },
  { key: 'vehicles', label: 'Vehicles', detail: 'SQL vehicle register linked to Fleetio operational data.' },
  { key: 'trailers', label: 'Trailers', detail: 'SQL trailer register for identity, capacity and Fleetio links.' },
  { key: 'fuel-cards', label: 'Fuel cards & PINs', detail: 'Restricted SQL fuel register for vehicle fuel-card details and PINs.' },
  { key: 'sites', label: 'Sites', detail: 'SQL site register for aliases, addresses, planning data and linked execution geofences.' },
  { key: 'markets', label: 'Markets', detail: 'SQL market and contact register used by order intake and planning.' },
  { key: 'fuel-prices', label: 'Fuel prices', detail: 'SQL fuel pricing reference data.' },
  { key: 'email-intake', label: 'Email intake', detail: 'SQL sender/customer mappings and planner-controlled route rules for staged email orders.' },
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
        <p className="eyebrow">TMS master data · SQL authority</p>
        <h1>Master data</h1>
        <p className="intro">SQL is the single operational master for the TMS. Planning, dispatch and integrations read and update the same records directly.</p>
      </div>
      <div>
        <span className="status approved">SQL is authoritative</span>
        <p className="hint" style={{ maxWidth: 320, marginTop: 10 }}>Edit and reconcile records in the TMS. TachoMaster and Fleetio continue to provide their integration-owned fields.</p>
      </div>
    </div>

    <div className="panel master-section-panel" style={{ marginBottom: 18 }}>
      <div className="master-section-tabs horizontal-tabs" role="tablist" aria-label="Master data sections">
        {sections.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} className={section === item.key ? 'primary' : ''} onClick={() => setSection(item.key)}>{item.label}</button>)}
      </div>
        <p className="hint master-section-hint"><strong>{active.label}:</strong> {active.detail}</p>
    </div>

    <div className="notice inline-notice" style={{ marginBottom: 18 }}>
      <strong>One source of truth.</strong> Changes made here are saved directly to the SQL master used by the TMS. Microsoft Lists is not used as a competing write source.
    </div>

    {section === 'drivers' && <div className="actions" style={{ marginBottom: 18 }}>
      <button className="primary" onClick={() => void syncDriverIdentities()} disabled={syncingDrivers}>
        {syncingDrivers ? 'Queuing reconciliation…' : 'Reconcile TachoMaster driver identities'}
      </button>
      {syncMessage && <span className="notice inline-notice">{syncMessage}</span>}
    </div>}

    <div>
      {section === 'drivers' && <DriversMasterCompact />}
      {section === 'vehicles' && <FleetMasterUnified kind="vehicles" />}
      {section === 'trailers' && <FleetMasterUnified kind="trailers" />}
      {section === 'sites' && <>
        <MasterDataOperational initialTab="sites" showCategoryButtons={false} showHeading={false} />
        <div className="panel" style={{ marginTop: 18, marginBottom: 18 }}>
          <p className="eyebrow">Site execution evidence</p>
          <h2>Geofences attached to Site Master</h2>
          <p className="hint">RoadTech polygons remain execution evidence linked to the canonical Site record. Site and geofence master corrections are maintained through the governed SQL TMS controls.</p>
        </div>
        <GeofenceOperational />
      </>}
      {section === 'fuel-cards' && <FuelCardsOperational />}
      {section === 'markets' && <MarketsMasterClean />}
      {section === 'fuel-prices' && <FuelMaster />}
      {section === 'email-intake' && <EmailIntakeMappings />}
    </div>
  </section>;
}
