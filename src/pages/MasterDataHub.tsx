import { useEffect, useState } from 'react';
import { FuelMaster } from './Pages';
import { DriversMasterOperational } from './DriversMasterOperational';
import { FleetMasterUnified } from './FleetMasterUnified';
import { FuelCardsOperational } from './FuelCardsOperational';
import { MarketsMasterClean } from './MarketsMasterClean';
import { MasterDataOperational, type MasterDataTab } from './MasterDataOperational';
import { GeofenceOperational } from './GeofenceOperational';
import { MasterDataDuplicateReviewPanel } from '../components/MasterDataDuplicateReviewPanel';

type MasterSection = MasterDataTab | 'fuel-cards' | 'markets' | 'fuel-prices';
type DuplicateEntity = 'sites' | 'customers' | 'drivers' | 'vehicles' | 'trailers' | 'markets';

const sections: Array<{ key: MasterSection; label: string }> = [
  { key: 'drivers', label: 'Drivers' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'trailers', label: 'Trailers' },
  { key: 'fuel-cards', label: 'Fuel cards & PINs' },
  { key: 'sites', label: 'Sites' },
  { key: 'customers', label: 'Customers' },
  { key: 'markets', label: 'Markets' },
  { key: 'fuel-prices', label: 'Fuel prices' },
];

function canonicalSection(value: MasterSection): MasterSection {
  return value === 'geofences' ? 'sites' : value;
}

function duplicateEntity(section: MasterSection): DuplicateEntity | undefined {
  if (section === 'sites' || section === 'customers' || section === 'drivers' || section === 'vehicles' || section === 'trailers' || section === 'markets') return section;
  return undefined;
}

export function MasterDataHub({ initialSection = 'drivers' }: { initialSection?: MasterSection }) {
  const [section, setSection] = useState<MasterSection>(() => canonicalSection(initialSection));
  useEffect(() => { setSection(canonicalSection(initialSection)); }, [initialSection]);

  const duplicateReviewEntity = duplicateEntity(section);

  return <section>
    <div className="panel master-section-panel" style={{ marginBottom: 18 }}>
      <p className="hint">SQL is the single operational master. Maintain governed records here; file imports and staging approvals are handled under Admin → Imports.</p>
      <div className="master-section-tabs horizontal-tabs" role="tablist" aria-label="Master data sections">
        {sections.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} className={section === item.key ? 'primary' : ''} onClick={() => setSection(item.key)}>{item.label}</button>)}
      </div>
    </div>

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
