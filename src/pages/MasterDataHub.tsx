import { useEffect, useState } from 'react';
import { FuelMaster } from './Pages';
import { DriversMasterOperational } from './DriversMasterOperational';
import { FleetMasterUnified } from './FleetMasterUnified';
import { FuelCardsOperational } from './FuelCardsOperational';
import { MarketsMasterClean } from './MarketsMasterClean';
import { MasterDataOperational, type MasterDataTab } from './MasterDataOperational';
import { GeofenceOperational } from './GeofenceOperational';
import { MasterDataCsvImport } from './MasterDataCsvImport';
import { MasterDataDuplicateReviewPanel } from '../components/MasterDataDuplicateReviewPanel';

type MasterSection = MasterDataTab | 'fuel-cards' | 'markets' | 'fuel-prices';
type DuplicateEntity = 'sites' | 'drivers' | 'vehicles' | 'trailers' | 'markets';

const sections: Array<{ key: MasterSection; label: string; detail: string }> = [
  { key: 'drivers', label: 'Drivers', detail: 'SQL Driver Master is operational authority. Sage HR maintains employed staff; TachoMaster enriches member, card, duty and hours evidence.' },
  { key: 'vehicles', label: 'Vehicles', detail: 'SQL vehicle register linked to Fleetio operational data.' },
  { key: 'trailers', label: 'Trailers', detail: 'SQL trailer register for identity, capacity and Fleetio links.' },
  { key: 'fuel-cards', label: 'Fuel cards & PINs', detail: 'Restricted SQL fuel register for vehicle fuel-card details and PINs.' },
  { key: 'sites', label: 'Sites', detail: 'SQL site register for aliases, addresses, planning data and linked execution geofences.' },
  { key: 'customers', label: 'Customers', detail: 'SQL customer register for identity, trading name, account ownership, service notes and default site.' },
  { key: 'markets', label: 'Markets', detail: 'SQL market and contact register used by order intake and planning.' },
  { key: 'fuel-prices', label: 'Fuel prices', detail: 'SQL fuel pricing reference data.' },
];

function canonicalSection(value: MasterSection): MasterSection {
  return value === 'geofences' ? 'sites' : value;
}

function duplicateEntity(section: MasterSection): DuplicateEntity | undefined {
  if (section === 'sites' || section === 'drivers' || section === 'vehicles' || section === 'trailers' || section === 'markets') return section;
  return undefined;
}

export function MasterDataHub({ initialSection = 'drivers' }: { initialSection?: MasterSection }) {
  const [section, setSection] = useState<MasterSection>(() => canonicalSection(initialSection));
  useEffect(() => { setSection(canonicalSection(initialSection)); }, [initialSection]);

  const active = sections.find(item => item.key === section) || sections[0];
  const duplicateReviewEntity = duplicateEntity(section);

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">TMS master data · SQL authority</p>
        <h1>Master data</h1>
        <p className="intro">SQL is the single operational master for the TMS. Planning, compliance and integrations read the same controlled records.</p>
      </div>
      <div>
        <span className="status approved">SQL is authoritative</span>
        <p className="hint" style={{ maxWidth: 320, marginTop: 10 }}>Edit and reconcile records in the TMS. Sage HR, TachoMaster, Fleetio and RoadTech each provide only the employment, identity, vehicle and execution evidence they own.</p>
      </div>
    </div>

    <div className="panel master-section-panel" style={{ marginBottom: 18 }}>
      <div className="master-section-tabs horizontal-tabs" role="tablist" aria-label="Master data sections">
        {sections.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} className={section === item.key ? 'primary' : ''} onClick={() => setSection(item.key)}>{item.label}</button>)}
      </div>
      <p className="hint master-section-hint"><strong>{active.label}:</strong> {active.detail}</p>
    </div>


    {section !== 'drivers' && <MasterDataCsvImport />}


    {duplicateReviewEntity && <MasterDataDuplicateReviewPanel entityType={duplicateReviewEntity} />}

    <div>
      {section === 'drivers' && <DriversMasterOperational />}
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
      {section === 'customers' && <MasterDataOperational initialTab="customers" showCategoryButtons={false} showHeading={false} />}
      {section === 'fuel-cards' && <FuelCardsOperational />}
      {section === 'markets' && <MarketsMasterClean />}
      {section === 'fuel-prices' && <FuelMaster />}
    </div>
  </section>;
}
