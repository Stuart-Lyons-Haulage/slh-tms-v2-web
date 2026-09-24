import { useEffect, useState } from 'react';
import { DriversMasterOperational } from './DriversMasterOperational';
import { FleetMasterUnified } from './FleetMasterUnified';
import { FuelCardsOperational } from './FuelCardsOperational';
import { MarketsMasterClean } from './MarketsMasterClean';
import { MasterDataOperational, type MasterDataTab } from './MasterDataOperational';
import { GeofenceOperational } from './GeofenceOperational';
import { MasterDataCsvImport } from './MasterDataCsvImport';
import { MasterDataDuplicateReviewPanel } from '../components/MasterDataDuplicateReviewPanel';

type MasterSection = MasterDataTab | 'fuel-cards' | 'markets';

const sections: Array<{ key: MasterSection; label: string }> = [
  { key: 'drivers', label: 'Drivers' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'trailers', label: 'Trailers' },
  { key: 'fuel-cards', label: 'Fuel cards & PINs' },
  { key: 'sites', label: 'Sites' },
  { key: 'geofences', label: 'Geofences' },
  { key: 'customers', label: 'Customers' },
  { key: 'markets', label: 'Markets' },
];

function canonicalSection(value: MasterSection): MasterSection {
  return value;
}

export function MasterDataHub({ initialSection = 'drivers' }: { initialSection?: MasterSection }) {
  const [section, setSection] = useState<MasterSection>(() => canonicalSection(initialSection));
  const [masterImportOpen, setMasterImportOpen] = useState(false);
  useEffect(() => { setSection(canonicalSection(initialSection)); }, [initialSection]);

  return <section className="master-data-hub">
    <div className="master-data-tabbar">
      <div className="master-section-tabs horizontal-tabs" role="tablist" aria-label="Master data sections">
        {sections.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} className={section === item.key ? 'primary' : ''} onClick={() => setSection(item.key)}>{item.label}</button>)}
      </div>
      <button type="button" className="primary" onClick={() => setMasterImportOpen(true)}>Master Import</button>
    </div>

    {masterImportOpen && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Master Import" onMouseDown={event => { if (event.target === event.currentTarget) setMasterImportOpen(false); }}>
      <div className="crm-modal master-import-modal">
        <div className="crm-modal-header"><h2>Master Import</h2><button type="button" onClick={() => setMasterImportOpen(false)}>Close</button></div>
        <div className="crm-modal-body"><MasterDataCsvImport /></div>
      </div>
    </div>}

    <div>
      {section === 'drivers' && <DriversMasterOperational />}
      {section === 'vehicles' && <FleetMasterUnified kind="vehicles" />}
      {section === 'trailers' && <FleetMasterUnified kind="trailers" />}
      {section === 'sites' && <MasterDataOperational initialTab="sites" showCategoryButtons={false} showHeading={false} siteDuplicateControls={<MasterDataDuplicateReviewPanel entityType="sites" inline />} />}
      {section === 'geofences' && <GeofenceOperational />}
      {section === 'customers' && <MasterDataOperational initialTab="customers" showCategoryButtons={false} showHeading={false} />}
      {section === 'fuel-cards' && <FuelCardsOperational />}
      {section === 'markets' && <MarketsMasterClean />}
    </div>
  </section>;
}
