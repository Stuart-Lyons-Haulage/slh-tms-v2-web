import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  FieldGovernance,
  MasterAuditEntry,
  MasterCounts,
  MasterRecord,
  MasterReviewItem,
  MasterWorkbookImportResult,
  ReviewAllocation,
  SiteCrmProfile,
} from '../lib/api';

type MasterTab =
  | 'sites'
  | 'drivers'
  | 'vehicles'
  | 'trailers'
  | 'fuelCards'
  | 'customers'
  | 'markets'
  | 'review'
  | 'governance'
  | 'import';

type FieldType = 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'checkbox' | 'date' | 'time' | 'select';

type EditableField = {
  key: string;
  label: string;
  type?: FieldType;
  options?: Array<{ value: string; label: string }>;
};

type Column = [string, string];

type ChildEditor = {
  entity: string;
  title: string;
  fields: EditableField[];
  row: MasterRecord;
  isNew: boolean;
} | null;

const tabs: Array<{ key: MasterTab; label: string; count?: keyof MasterCounts }> = [
  { key: 'sites', label: 'Sites', count: 'sites' },
  { key: 'drivers', label: 'People', count: 'drivers' },
  { key: 'vehicles', label: 'Vehicles', count: 'vehicles' },
  { key: 'trailers', label: 'Trailers', count: 'trailers' },
  { key: 'fuelCards', label: 'Fuel Cards', count: 'fuelCards' },
  { key: 'customers', label: 'Customers', count: 'customers' },
  { key: 'markets', label: 'Markets', count: 'markets' },
  { key: 'review', label: 'Review Centre', count: 'reviewItems' },
  { key: 'governance', label: 'Governance' },
  { key: 'import', label: 'Import' },
];

const columns: Record<Exclude<MasterTab, 'review' | 'governance' | 'import'>, Column[]> = {
  sites: [
    ['name', 'Site'],
    ['code', 'Code'],
    ['siteType', 'Type'],
    ['postcode', 'Postcode'],
    ['latestDeliveryTime', 'Latest delivery'],
  ],
  drivers: [
    ['displayName', 'Driver'],
    ['employmentType', 'Type'],
    ['employmentStatus', 'Status'],
    ['mobileNumber', 'Mobile'],
    ['tachoMasterMemberCode', 'Tacho member'],
    ['tachoCardNumber', 'Tacho card'],
  ],
  vehicles: [
    ['registration', 'Registration'],
    ['fleetNumber', 'Fleet no.'],
    ['vehicleType', 'Type'],
    ['cabMobile', 'Cab phone'],
    ['fleetioId', 'Fleetio'],
    ['dotId', 'DOT'],
  ],
  trailers: [
    ['trailerNumber', 'Trailer'],
    ['trailerType', 'Type'],
    ['palletCapacity', 'Std'],
    ['euroPalletCapacity', 'Euro'],
    ['trolleyCapacity', 'Trolleys'],
    ['currentLocation', 'Location'],
  ],
  fuelCards: [
    ['vehicleRegistration', 'Vehicle'],
    ['shellCardNumber', 'Shell'],
    ['shellPin', 'PIN'],
    ['bpRedCardNumber', 'BP Red'],
    ['bpRedPin', 'PIN'],
    ['bpPlainCardNumber', 'BP Plain'],
    ['bpPlainPin', 'PIN'],
  ],
  customers: [
    ['name', 'Customer'],
    ['code', 'Code'],
  ],
  markets: [
    ['name', 'Market'],
    ['code', 'Code'],
    ['defaultInstructions', 'Instructions'],
  ],
};

const editableFields: Record<Exclude<MasterTab, 'review' | 'governance' | 'import'>, EditableField[]> = {
  sites: [
    { key: 'code', label: 'Site code' },
    { key: 'name', label: 'Site name' },
    { key: 'siteType', label: 'Site type' },
    { key: 'driverTextName', label: 'Driver text name' },
    { key: 'fullAddress', label: 'Full address', type: 'textarea' },
    { key: 'addressLine1', label: 'Address line 1' },
    { key: 'addressLine2', label: 'Address line 2' },
    { key: 'town', label: 'Town' },
    { key: 'county', label: 'County' },
    { key: 'postcode', label: 'Postcode' },
    { key: 'mapLink', label: 'Map link' },
    { key: 'what3Words', label: 'What3Words' },
    { key: 'geofenceRadiusMeters', label: 'Geofence radius (m)', type: 'number' },
    { key: 'earliestCollectionTime', label: 'Collection opens', type: 'time' },
    { key: 'latestCollectionTime', label: 'Last collection', type: 'time' },
    { key: 'earliestDeliveryTime', label: 'Delivery opens', type: 'time' },
    { key: 'latestDeliveryTime', label: 'Latest delivery', type: 'time' },
    { key: 'averageWaitMinutes', label: 'Average collection wait (min)', type: 'number' },
    { key: 'averageQueueMinutes', label: 'Average delivery queue (min)', type: 'number' },
    { key: 'standardCutoff', label: 'Standard cut-off', type: 'time' },
    { key: 'extendedCutoff', label: 'Extended cut-off', type: 'time' },
    { key: 'deadlineContact', label: 'Deadline contact' },
    { key: 'deadlineNotes', label: 'Deadline notes', type: 'textarea' },
    { key: 'bookingMethod', label: 'Booking method' },
    { key: 'bookingUrl', label: 'Booking URL' },
    { key: 'collectionInstructions', label: 'Collection instructions', type: 'textarea' },
    { key: 'driverInstructions', label: 'Driver instructions', type: 'textarea' },
    { key: 'plannerKnowledge', label: 'Planner knowledge', type: 'textarea' },
    { key: 'routingNotes', label: 'Routing intelligence', type: 'textarea' },
    { key: 'equipmentNotes', label: 'Equipment / pallet notes', type: 'textarea' },
    { key: 'latitude', label: 'Latitude', type: 'number' },
    { key: 'longitude', label: 'Longitude', type: 'number' },
  ],
  drivers: [
    { key: 'displayName', label: 'Name' },
    { key: 'employmentType', label: 'Employment type', type: 'select', options: [
      { value: 'Permanent', label: 'Permanent' },
      { value: 'Casual', label: 'Casual' },
      { value: 'Agency', label: 'Agency' },
      { value: 'Subcontractor', label: 'Subcontractor' },
    ] },
    { key: 'employmentStatus', label: 'Status', type: 'select', options: [
      { value: 'Available', label: 'Available' },
      { value: 'Holiday', label: 'On holiday' },
      { value: 'Sick', label: 'Sick' },
      { value: 'Training', label: 'Training' },
      { value: 'Suspended', label: 'Suspended' },
      { value: 'Left', label: 'Left' },
    ] },
    { key: 'employeeNumber', label: 'Employee number' },
    { key: 'agencyName', label: 'Agency' },
    { key: 'subcontractorCompany', label: 'Subcontractor company' },
    { key: 'homeDepot', label: 'Home depot' },
    { key: 'mobileNumber', label: 'Mobile', type: 'tel' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'tachoName', label: 'TachoMaster name' },
    { key: 'tachoMasterMemberCode', label: 'TachoMaster member code' },
    { key: 'tachoMasterDriverId', label: 'TachoMaster driver ID' },
    { key: 'tachoCardNumber', label: 'Tacho card number' },
    { key: 'drivingLicenceNumber', label: 'Driving licence number' },
    { key: 'licenceExpiry', label: 'Licence expiry', type: 'date' },
    { key: 'licenceStatus', label: 'Licence status' },
    { key: 'cpcExpiry', label: 'CPC expiry', type: 'date' },
    { key: 'adrQualified', label: 'ADR qualified', type: 'checkbox' },
    { key: 'eligibleForPlanning', label: 'Eligible for planning', type: 'checkbox' },
    { key: 'skills', label: 'Skills', type: 'textarea' },
    { key: 'driverGroup', label: 'Driver group' },
    { key: 'coding', label: 'Coding' },
    { key: 'northEligible', label: 'North eligible', type: 'checkbox' },
    { key: 'preloadEligible', label: 'Preload eligible', type: 'checkbox' },
    { key: 'emergencyContactName', label: 'Emergency contact' },
    { key: 'emergencyContactPhone', label: 'Emergency phone', type: 'tel' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  vehicles: [
    { key: 'registration', label: 'Registration' },
    { key: 'fleetNumber', label: 'Fleet number' },
    { key: 'abbreviation', label: 'Short code' },
    { key: 'vehicleType', label: 'Vehicle type' },
    { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' },
    { key: 'vin', label: 'VIN' },
    { key: 'fuelType', label: 'Fuel type' },
    { key: 'transmission', label: 'Transmission' },
    { key: 'dvs', label: 'DVS' },
    { key: 'cabMobile', label: 'Cab phone', type: 'tel' },
    { key: 'fleetioId', label: 'Fleetio ID' },
    { key: 'dotId', label: 'DOT ID' },
    { key: 'roadrunnerId', label: 'Roadrunner ID' },
    { key: 'samsaraId', label: 'Samsara ID' },
    { key: 'motExpiry', label: 'MOT expiry', type: 'date' },
    { key: 'taxExpiry', label: 'Tax expiry', type: 'date' },
    { key: 'inspectionDue', label: 'Inspection due', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  trailers: [
    { key: 'trailerNumber', label: 'Trailer number' },
    { key: 'fleetNumber', label: 'Fleet number' },
    { key: 'registration', label: 'Registration / identifier' },
    { key: 'trailerType', label: 'Trailer type' },
    { key: 'palletCapacity', label: 'Standard pallet capacity', type: 'number' },
    { key: 'euroPalletCapacity', label: 'Euro pallet capacity', type: 'number' },
    { key: 'trolleyCapacity', label: 'Trolley capacity', type: 'number' },
    { key: 'euroToStandardEquivalent', label: 'Euro space factor', type: 'number' },
    { key: 'trolleyToStandardEquivalent', label: 'Trolley space factor', type: 'number' },
    { key: 'refrigerated', label: 'Refrigerated', type: 'checkbox' },
    { key: 'doubleDeck', label: 'Double deck', type: 'checkbox' },
    { key: 'tailLift', label: 'Tail lift', type: 'checkbox' },
    { key: 'currentLocation', label: 'Current location' },
    { key: 'fleetioId', label: 'Fleetio ID' },
    { key: 'dotId', label: 'DOT ID' },
    { key: 'motExpiry', label: 'MOT / test expiry', type: 'date' },
    { key: 'inspectionDue', label: 'Inspection due', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  fuelCards: [
    { key: 'shellCardNumber', label: 'Shell card number' },
    { key: 'shellPin', label: 'Shell PIN' },
    { key: 'shellNotes', label: 'Shell notes', type: 'textarea' },
    { key: 'bpRedCardNumber', label: 'BP Red card number' },
    { key: 'bpRedPin', label: 'BP Red PIN' },
    { key: 'bpRedNotes', label: 'BP Red notes', type: 'textarea' },
    { key: 'bpPlainCardNumber', label: 'BP Plain card number' },
    { key: 'bpPlainPin', label: 'BP Plain PIN' },
    { key: 'bpPlainNotes', label: 'BP Plain notes', type: 'textarea' },
  ],
  customers: [
    { key: 'code', label: 'Customer code' },
    { key: 'name', label: 'Customer name' },
  ],
  markets: [
    { key: 'code', label: 'Market code' },
    { key: 'name', label: 'Market name' },
    { key: 'defaultInstructions', label: 'Default instructions', type: 'textarea' },
  ],
};

const childFields = {
  cutoff: [
    { key: 'plan', label: 'Plan / service' },
    { key: 'standardCutoff', label: 'Standard cut-off', type: 'time' },
    { key: 'extendedCutoff', label: 'Extended cut-off', type: 'time' },
    { key: 'lastDespatchTime', label: 'Last despatch', type: 'time' },
    { key: 'plannedCollectFrom', label: 'Collect from', type: 'time' },
    { key: 'plannedCollectTo', label: 'Collect to', type: 'time' },
    { key: 'depotDeliveryDeadline', label: 'Delivery deadline', type: 'time' },
    { key: 'temperature', label: 'Temperature' },
    { key: 'palletType', label: 'Pallet type' },
    { key: 'contact', label: 'Contact' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ] satisfies EditableField[],
  contact: [
    { key: 'contactName', label: 'Contact name' },
    { key: 'role', label: 'Role' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ] satisfies EditableField[],
  route: [
    { key: 'route', label: 'Route / movement' },
    { key: 'palletType', label: 'Pallet type' },
    { key: 'lastDespatchTime', label: 'Last sensible despatch', type: 'time' },
    { key: 'plannedCollectFrom', label: 'Typical collect from', type: 'time' },
    { key: 'plannedCollectTo', label: 'Typical collect to', type: 'time' },
    { key: 'depotDeliveryDeadline', label: 'Planned arrival by', type: 'time' },
  ] satisfies EditableField[],
  alias: [
    { key: 'alias', label: 'Alias' },
    { key: 'source', label: 'Source' },
    { key: 'approved', label: 'Approved', type: 'checkbox' },
  ] satisfies EditableField[],
  identity: [
    { key: 'provider', label: 'Provider' },
    { key: 'externalKey', label: 'External key' },
    { key: 'externalDisplayName', label: 'Display name' },
    { key: 'active', label: 'Active', type: 'checkbox' },
  ] satisfies EditableField[],
  knowledge: [
    { key: 'category', label: 'Category', type: 'select', options: [
      { value: 'Planner', label: 'Planner knowledge' },
      { value: 'Routing', label: 'Routing intelligence' },
      { value: 'Access', label: 'Access / gate / bay' },
      { value: 'Seasonal', label: 'Seasonal' },
      { value: 'Safety', label: 'Safety' },
    ] },
    { key: 'title', label: 'Title' },
    { key: 'content', label: 'Knowledge', type: 'textarea' },
    { key: 'priority', label: 'Priority', type: 'number' },
    { key: 'source', label: 'Source' },
  ] satisfies EditableField[],
  equipment: [
    { key: 'equipmentType', label: 'Equipment / pallet type' },
    { key: 'required', label: 'Required', type: 'checkbox' },
    { key: 'requirement', label: 'Requirement' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ] satisfies EditableField[],
  booking: [
    { key: 'ruleType', label: 'Rule type' },
    { key: 'bookingMethod', label: 'Booking method' },
    { key: 'bookingUrl', label: 'Booking URL' },
    { key: 'contact', label: 'Contact' },
    { key: 'leadTimeMinutes', label: 'Lead time (min)', type: 'number' },
    { key: 'referenceFormat', label: 'Reference format' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ] satisfies EditableField[],
  document: [
    { key: 'documentType', label: 'Type' },
    { key: 'title', label: 'Title' },
    { key: 'location', label: 'Location / link' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ] satisfies EditableField[],
  market: [
    { key: 'code', label: 'Market code' },
    { key: 'name', label: 'Market name' },
    { key: 'defaultInstructions', label: 'Default instructions', type: 'textarea' },
  ] satisfies EditableField[],
};

function entitySlug(tab: MasterTab) {
  if (tab === 'fuelCards') return 'fuel-cards';
  return tab;
}

function formatValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatTableValue(key: string, value: unknown) {
  if (value == null || value === '') return '—';
  const lower = key.toLowerCase();
  if (lower.includes('pin')) return '••••';
  if (lower.includes('cardnumber')) {
    const text = String(value).replace(/\s/g, '');
    return text.length <= 4 ? text : `•••• ${text.slice(-4)}`;
  }
  return formatValue(value);
}

function searchable(row: Record<string, unknown>, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return Object.values(row).some(value => value != null && String(value).toLowerCase().includes(needle));
}

function titleFor(row: MasterRecord) {
  return formatValue(
    row.name ??
    row.displayName ??
    row.vehicleRegistration ??
    row.registration ??
    row.trailerNumber ??
    row.code ??
    'Master Data record',
  );
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function FieldEditor({
  fields,
  draft,
  setDraft,
}: {
  fields: EditableField[];
  draft: Record<string, unknown>;
  setDraft: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="crm-edit-grid">
      {fields.map(field => {
        const value = draft[field.key];

        if (field.type === 'checkbox') {
          return (
            <label className="crm-checkbox" key={field.key}>
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={event => setDraft({ ...draft, [field.key]: event.target.checked })}
              />
              <span>{field.label}</span>
            </label>
          );
        }

        if (field.type === 'textarea') {
          return (
            <label className="crm-edit-field wide" key={field.key}>
              <span>{field.label}</span>
              <textarea
                rows={4}
                value={String(value ?? '')}
                onChange={event => setDraft({ ...draft, [field.key]: event.target.value || null })}
              />
            </label>
          );
        }

        if (field.type === 'select') {
          return (
            <label className="crm-edit-field" key={field.key}>
              <span>{field.label}</span>
              <select
                value={String(value ?? '')}
                onChange={event => setDraft({ ...draft, [field.key]: event.target.value || null })}
              >
                <option value="">Select…</option>
                {(field.options ?? []).map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          );
        }

        return (
          <label className="crm-edit-field" key={field.key}>
            <span>{field.label}</span>
            <input
              type={field.type || 'text'}
              step={field.type === 'number' ? 'any' : undefined}
              value={String(value ?? '')}
              onChange={event => {
                const raw = event.target.value;
                const next = field.type === 'number' ? (raw === '' ? null : Number(raw)) : (raw === '' ? null : raw);
                setDraft({ ...draft, [field.key]: next });
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

function DataTable({
  rows,
  tableColumns,
  onOpen,
}: {
  rows: MasterRecord[];
  tableColumns: Column[];
  onOpen: (row: MasterRecord) => void;
}) {
  return (
    <div className="master-table-scroll">
      <table className="master-table">
        <thead>
          <tr>
            {tableColumns.map(([, label]) => <th key={label}>{label}</th>)}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="master-click-row" onClick={() => onOpen(row)}>
              {tableColumns.map(([key]) => <td key={key}>{formatTableValue(key, row[key])}</td>)}
              <td>
                <span className={row.active === false ? 'status-chip archived' : 'status-chip live'}>
                  {row.active === false ? 'Archived' : 'Active'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="master-empty">No records match this view.</div>}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  count,
  onAdd,
}: {
  eyebrow: string;
  title: string;
  count?: number;
  onAdd?: () => void;
}) {
  return (
    <div className="crm-section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      <div className="crm-section-actions">
        {typeof count === 'number' && <span className="crm-count">{count}</span>}
        {onAdd && <button className="button secondary small" type="button" onClick={onAdd}>+ Add</button>}
      </div>
    </div>
  );
}

function ChildTable({
  rows,
  tableColumns,
  empty,
  onOpen,
}: {
  rows: MasterRecord[];
  tableColumns: Column[];
  empty: string;
  onOpen: (row: MasterRecord) => void;
}) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="master-table-scroll compact">
      <table className="master-table">
        <thead><tr>{tableColumns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="master-click-row" onClick={() => onOpen(row)}>
              {tableColumns.map(([key]) => <td key={key}>{formatValue(row[key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MasterDataPage() {
  const [activeTab, setActiveTab] = useState<MasterTab>('sites');
  const [counts, setCounts] = useState<MasterCounts | null>(null);
  const [rows, setRows] = useState<MasterRecord[]>([]);
  const [reviewItems, setReviewItems] = useState<MasterReviewItem[]>([]);
  const [relationshipReview, setRelationshipReview] = useState<ReviewAllocation[]>([]);
  const [governance, setGovernance] = useState<FieldGovernance[]>([]);
  const [allSites, setAllSites] = useState<MasterRecord[]>([]);
  const [allDrivers, setAllDrivers] = useState<MasterRecord[]>([]);
  const [allVehicles, setAllVehicles] = useState<MasterRecord[]>([]);
  const [allTrailers, setAllTrailers] = useState<MasterRecord[]>([]);
  const [allCustomers, setAllCustomers] = useState<MasterRecord[]>([]);
  const [query, setQuery] = useState('');
  const [peopleFilter, setPeopleFilter] = useState('All');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<MasterRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [history, setHistory] = useState<MasterAuditEntry[]>([]);
  const [siteCrm, setSiteCrm] = useState<SiteCrmProfile | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);
  const [childEditor, setChildEditor] = useState<ChildEditor>(null);
  const [childDraft, setChildDraft] = useState<Record<string, unknown>>({});
  const [childBusy, setChildBusy] = useState(false);
  const [allocationSite, setAllocationSite] = useState<Record<string, string>>({});
  const [reviewLink, setReviewLink] = useState<Record<string, string>>({});
  const [reviewCreateType, setReviewCreateType] = useState<Record<string, string>>({});

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MasterWorkbookImportResult | null>(null);
  const [importBusy, setImportBusy] = useState<'preview' | 'commit' | null>(null);

  const refreshCounts = useCallback(async () => {
    setCounts(await api.masterCounts());
  }, []);

  const loadReferenceData = useCallback(async () => {
    const [sites, drivers, vehicles, trailers, customers] = await Promise.all([
      api.sites(),
      api.drivers(),
      api.vehicles(),
      api.trailers(),
      api.customers(),
    ]);
    setAllSites(sites);
    setAllDrivers(drivers);
    setAllVehicles(vehicles);
    setAllTrailers(trailers);
    setAllCustomers(customers);
  }, []);

  const loadRows = useCallback(async (tab: MasterTab) => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'review') {
        const [pending, allocations] = await Promise.all([
          api.masterReview(),
          api.reviewAllocations(),
        ]);
        setReviewItems(pending.filter(item => String(item.key).startsWith('integration:')));
        setRelationshipReview(allocations);
        setRows([]);
        await loadReferenceData();
        return;
      }

      if (tab === 'governance') {
        setGovernance(await api.governance());
        setRows([]);
        return;
      }

      if (tab === 'import') {
        setRows([]);
        return;
      }

      let loaded: MasterRecord[] = [];
      switch (tab) {
        case 'sites': loaded = await api.sites(); break;
        case 'drivers': loaded = await api.drivers(); break;
        case 'vehicles': loaded = await api.vehicles(); break;
        case 'trailers': loaded = await api.trailers(); break;
        case 'fuelCards': loaded = await api.fuelCards(); break;
        case 'customers': loaded = await api.customers(); break;
        case 'markets': loaded = await api.markets(); break;
      }
      setRows(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Master Data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [loadReferenceData]);

  useEffect(() => {
    void refreshCounts().catch(() => undefined);
  }, [refreshCounts]);

  useEffect(() => {
    setQuery('');
    setSelected(null);
    setEditing(false);
    setCreating(false);
    void loadRows(activeTab);
  }, [activeTab, loadRows]);

  useEffect(() => {
    if (activeTab === 'sites' && allCustomers.length === 0) {
      void api.customers().then(setAllCustomers).catch(() => undefined);
    }
  }, [activeTab, allCustomers.length]);

  const filteredRows = useMemo(() => {
    let current = rows.filter(row => searchable(row, query));
    if (activeTab === 'drivers' && peopleFilter !== 'All') {
      current = current.filter(row => String(row.employmentType ?? '') === peopleFilter);
    }
    return current;
  }, [rows, query, activeTab, peopleFilter]);

  const activeColumns = activeTab === 'review' || activeTab === 'governance' || activeTab === 'import'
    ? []
    : columns[activeTab];

  const activeFields = useMemo<EditableField[]>(() => {
    if (activeTab === 'review' || activeTab === 'governance' || activeTab === 'import') return [];
    const base = editableFields[activeTab];
    if (activeTab !== 'sites') return base;

    return [
      {
        key: 'customerId',
        label: 'Customer',
        type: 'select',
        options: allCustomers.map(customer => ({
          value: customer.id,
          label: optionLabel(customer),
        })),
      },
      ...base,
    ];
  }, [activeTab, allCustomers]);

  function reviewOptions(item: MasterReviewItem) {
    const type = String(item.entityType || '').toLowerCase();
    if (type === 'driver') return allDrivers;
    if (type === 'vehicle') return allVehicles;
    if (type === 'trailer') return allTrailers;
    if (type === 'site') return allSites;
    if (type === 'customer') return allCustomers;
    return [];
  }

  function optionLabel(row: MasterRecord) {
    return titleFor(row);
  }

  async function openRecord(row: MasterRecord) {
    setSelected(row);
    setDraft({ ...row });
    setEditing(false);
    setCreating(false);
    setHistory([]);
    setSiteCrm(null);

    const entity = entitySlug(activeTab);
    const historyId = activeTab === 'fuelCards' ? String(row.vehicleId) : row.id;
    void api.masterHistory(entity, historyId).then(setHistory).catch(() => setHistory([]));

    if (activeTab === 'sites') {
      setCrmLoading(true);
      try {
        setSiteCrm(await api.siteCrm(row.id));
      } finally {
        setCrmLoading(false);
      }
    }
  }

  function startCreate() {
    if (activeTab === 'review' || activeTab === 'governance' || activeTab === 'import' || activeTab === 'fuelCards') return;
    const defaults: Record<string, unknown> = { active: true };
    if (activeTab === 'drivers') {
      Object.assign(defaults, { displayName: '', employmentType: 'Permanent', employmentStatus: 'Available', eligibleForPlanning: true });
    } else if (activeTab === 'vehicles') {
      Object.assign(defaults, { registration: '' });
    } else if (activeTab === 'trailers') {
      Object.assign(defaults, { trailerNumber: '' });
    } else if (activeTab === 'sites') {
      Object.assign(defaults, { code: '', name: '', geofenceRadiusMeters: 100 });
    } else if (activeTab === 'customers') {
      Object.assign(defaults, { code: '', name: '' });
    } else if (activeTab === 'markets') {
      Object.assign(defaults, { code: '', name: '', siteId: allSites[0]?.id ?? '' });
    }
    setSelected({ id: '', ...defaults });
    setDraft(defaults);
    setCreating(true);
    setEditing(true);
    setSiteCrm(null);
  }

  async function saveRecord() {
    if (!selected || activeTab === 'review' || activeTab === 'governance' || activeTab === 'import') return;
    setRecordBusy(true);
    setError(null);
    try {
      let updated: MasterRecord;
      if (activeTab === 'fuelCards') {
        updated = await api.updateVehicleFuelCards(String(selected.vehicleId), {
          shell: { cardNumber: draft.shellCardNumber || null, pin: draft.shellPin || null, notes: draft.shellNotes || null },
          bpRed: { cardNumber: draft.bpRedCardNumber || null, pin: draft.bpRedPin || null, notes: draft.bpRedNotes || null },
          bpPlain: { cardNumber: draft.bpPlainCardNumber || null, pin: draft.bpPlainPin || null, notes: draft.bpPlainNotes || null },
        });
      } else if (creating) {
        updated = await api.createMasterRecord(entitySlug(activeTab), draft);
      } else {
        updated = await api.updateMasterRecord(entitySlug(activeTab), selected.id, draft);
      }

      setSelected(updated);
      setDraft({ ...updated });
      setCreating(false);
      setEditing(false);
      await Promise.all([loadRows(activeTab), refreshCounts()]);

      if (activeTab === 'sites') {
        setSiteCrm(await api.siteCrm(updated.id));
      }
      const historyId = activeTab === 'fuelCards' ? String(updated.vehicleId) : updated.id;
      setHistory(await api.masterHistory(entitySlug(activeTab), historyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The record could not be saved.');
    } finally {
      setRecordBusy(false);
    }
  }

  async function archiveRecord() {
    if (!selected || creating || activeTab === 'review' || activeTab === 'governance' || activeTab === 'import') return;
    if (!window.confirm(activeTab === 'fuelCards' ? 'Clear all fuel cards for this vehicle?' : 'Archive this Master Data record?')) return;
    setRecordBusy(true);
    try {
      if (activeTab === 'fuelCards') {
        await api.clearVehicleFuelCards(String(selected.vehicleId));
      } else {
        await api.deleteMasterRecord(entitySlug(activeTab), selected.id);
      }
      setSelected(null);
      setSiteCrm(null);
      await Promise.all([loadRows(activeTab), refreshCounts()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The record could not be archived.');
    } finally {
      setRecordBusy(false);
    }
  }

  function openChild(entity: string, title: string, fields: EditableField[], row: MasterRecord) {
    setChildEditor({ entity, title, fields, row, isNew: false });
    setChildDraft({ ...row });
  }

  function addChild(entity: string, title: string, fields: EditableField[], defaults: Record<string, unknown>) {
    setChildEditor({
      entity,
      title,
      fields,
      row: { id: '', active: true, ...defaults },
      isNew: true,
    });
    setChildDraft({ active: true, ...defaults });
  }

  async function saveChild() {
    if (!childEditor || !selected) return;
    setChildBusy(true);
    setError(null);
    try {
      if (childEditor.isNew) {
        await api.createMasterRecord(childEditor.entity, childDraft);
      } else {
        await api.updateMasterRecord(childEditor.entity, childEditor.row.id, childDraft);
      }
      setChildEditor(null);
      setChildDraft({});
      if (activeTab === 'sites') {
        setSiteCrm(await api.siteCrm(selected.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Linked Site data could not be saved.');
    } finally {
      setChildBusy(false);
    }
  }

  async function archiveChild() {
    if (!childEditor || childEditor.isNew || !selected) return;
    if (!window.confirm('Archive this linked record?')) return;
    setChildBusy(true);
    try {
      await api.deleteMasterRecord(childEditor.entity, childEditor.row.id);
      setChildEditor(null);
      setChildDraft({});
      setSiteCrm(await api.siteCrm(selected.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Linked Site data could not be archived.');
    } finally {
      setChildBusy(false);
    }
  }

  async function decideReview(item: MasterReviewItem, decision: string) {
    setError(null);
    try {
      const selectedId = reviewLink[item.id] || item.suggestedEntityId || null;
      await api.decideReview(
        item.id,
        decision,
        selectedId,
        null,
        item.entityType.toLowerCase() === 'driver' ? reviewCreateType[item.id] || null : null,
      );
      await Promise.all([loadRows('review'), refreshCounts()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review decision could not be saved.');
    }
  }

  async function allocateRelationship(row: ReviewAllocation) {
    const siteId = allocationSite[row.id];
    if (!siteId) return;
    try {
      await api.allocateReviewToSite(row.kind, row.id, siteId);
      await Promise.all([loadRows('review'), refreshCounts()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Site allocation could not be saved.');
    }
  }

  async function importWorkbook(commit: boolean) {
    if (!selectedFile) return;
    setImportBusy(commit ? 'commit' : 'preview');
    setError(null);
    try {
      const result = await api.uploadMasterWorkbook(selectedFile, commit);
      setPreview(result);
      if (commit) await refreshCounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workbook import failed.');
    } finally {
      setImportBusy(null);
    }
  }

  return (
    <section className="master-page">
      <header className="page-header master-header">
        <div>
          <p className="eyebrow">Package 1 · canonical data</p>
          <h1>Master Data</h1>
          <p>One source of truth for people, fleet and every piece of operational knowledge we hold about a Site.</p>
        </div>
        <div className="master-health">
          <span className="health-dot" />
          <div><strong>Foundation</strong><small>Local-first · governed</small></div>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="master-summary-strip">
        <button type="button" onClick={() => setActiveTab('drivers')}><strong>{counts?.drivers ?? 0}</strong><span>People</span></button>
        <button type="button" onClick={() => setActiveTab('vehicles')}><strong>{counts?.vehicles ?? 0}</strong><span>Vehicles</span></button>
        <button type="button" onClick={() => setActiveTab('trailers')}><strong>{counts?.trailers ?? 0}</strong><span>Trailers</span></button>
        <button type="button" onClick={() => setActiveTab('sites')}><strong>{counts?.sites ?? 0}</strong><span>Sites</span></button>
        <button type="button" className={(counts?.reviewItems ?? 0) > 0 ? 'attention' : ''} onClick={() => setActiveTab('review')}>
          <strong>{counts?.reviewItems ?? 0}</strong><span>Review</span>
        </button>
      </div>

      <div className="panel master-hub">
        <div className="master-tabs">
          {tabs.map(tab => (
            <button key={tab.key} className={activeTab === tab.key ? 'active' : ''} onClick={() => setActiveTab(tab.key)}>
              {tab.label}
              {tab.count && <strong>{counts?.[tab.count] ?? 0}</strong>}
            </button>
          ))}
        </div>

        {activeTab === 'review' ? (
          <div className="master-tab-body">
            <div className="master-toolbar">
              <div>
                <p className="eyebrow">Universal Review Centre</p>
                <h2>Unknown & unmatched data</h2>
                <span className="muted">TachoMaster, DOT, Sage HR and Fleetio will all stage uncertain records here rather than creating duplicates.</span>
              </div>
              <button className="button secondary" onClick={() => void loadRows('review')}>Refresh</button>
            </div>

            <div className="review-centre-grid">
              {reviewItems.map(item => {
                const options = reviewOptions(item);
                const suggested = options.find(option => option.id === item.suggestedEntityId);
                return (
                  <article className="review-centre-card" key={item.id}>
                    <div className="review-centre-top">
                      <span className="status-chip review">{item.entityType}</span>
                      <span className="review-source">{item.category}</span>
                    </div>
                    <h3>{item.summary}</h3>
                    <p>{item.sourceReference || 'No external key'}</p>

                    {item.suggestedEntityId && (
                      <div className="review-suggestion">
                        <span>Possible match</span>
                        <strong>{suggested ? optionLabel(suggested) : item.suggestedEntityId}</strong>
                        {item.suggestedConfidence != null && <em>{Math.round(item.suggestedConfidence * 100)}%</em>}
                      </div>
                    )}

                    {options.length > 0 && (
                      <label className="review-link-select">
                        Link to existing
                        <select
                          value={reviewLink[item.id] ?? item.suggestedEntityId ?? ''}
                          onChange={event => setReviewLink(current => ({ ...current, [item.id]: event.target.value }))}
                        >
                          <option value="">Select existing record…</option>
                          {options.map(option => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
                        </select>
                      </label>
                    )}

                    {item.entityType.toLowerCase() === 'driver' && (
                      <label className="review-link-select">
                        If creating, driver type
                        <select
                          value={reviewCreateType[item.id] ?? ''}
                          onChange={event => setReviewCreateType(current => ({ ...current, [item.id]: event.target.value }))}
                        >
                          <option value="">Choose type…</option>
                          <option value="Permanent">Permanent</option>
                          <option value="Casual">Casual</option>
                          <option value="Agency">Agency</option>
                          <option value="Subcontractor">Subcontractor</option>
                        </select>
                      </label>
                    )}

                    <div className="review-actions">
                      <button className="button" disabled={!((reviewLink[item.id] || item.suggestedEntityId))} onClick={() => void decideReview(item, 'link')}>Link existing</button>
                      <button
                        className="button secondary"
                        disabled={item.entityType.toLowerCase() === 'driver' && !reviewCreateType[item.id]}
                        onClick={() => void decideReview(item, 'create')}
                      >
                        Create new
                      </button>
                      <button className="button ghost" onClick={() => void decideReview(item, 'ignore')}>Ignore</button>
                    </div>
                  </article>
                );
              })}
              {!reviewItems.length && <div className="master-empty review-empty">Nothing currently needs Master Data review.</div>}
            </div>

            {relationshipReview.length > 0 && (
              <section className="relationship-review">
                <SectionHeader eyebrow="Existing workbook relationships" title="Allocate to a Site" count={relationshipReview.length} />
                <div className="allocation-list">
                  {relationshipReview.map(row => (
                    <article className="allocation-row" key={`${row.kind}-${row.id}`}>
                      <div className="allocation-main">
                        <span className="status-chip review">{row.category}</span>
                        <strong>{row.summary}</strong>
                        <small>{[row.reference, row.source].filter(Boolean).join(' · ')}</small>
                      </div>
                      <div className="allocation-actions">
                        <select value={allocationSite[row.id] ?? ''} onChange={event => setAllocationSite(current => ({ ...current, [row.id]: event.target.value }))}>
                          <option value="">Select Site…</option>
                          {allSites.map(site => <option key={site.id} value={site.id}>{optionLabel(site)}</option>)}
                        </select>
                        <button className="button" disabled={!allocationSite[row.id]} onClick={() => void allocateRelationship(row)}>Allocate</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : activeTab === 'governance' ? (
          <div className="master-tab-body">
            <div className="master-toolbar">
              <div>
                <p className="eyebrow">Data Governance</p>
                <h2>Who owns each field</h2>
                <span className="muted">External systems enrich Master Data; uncertain changes are reviewed before they become canonical.</span>
              </div>
              <button className="button secondary" onClick={() => void loadRows('governance')}>Refresh</button>
            </div>
            <div className="governance-grid">
              {governance.map(row => (
                <article key={row.id} className="governance-card">
                  <div><span>{row.entityType}</span><strong>{row.fieldName}</strong></div>
                  <dl>
                    <div><dt>Owner</dt><dd>{row.owner}</dd></div>
                    <div><dt>Source</dt><dd>{row.sourceSystem || 'Manual'}</dd></div>
                    <div><dt>Review</dt><dd>{row.requiresReview ? 'Required' : 'No'}</dd></div>
                  </dl>
                  {row.notes && <p>{row.notes}</p>}
                </article>
              ))}
            </div>
          </div>
        ) : activeTab === 'import' ? (
          <div className="master-tab-body">
            <div className="master-toolbar">
              <div>
                <p className="eyebrow">Controlled import</p>
                <h2>Master workbook</h2>
                <span className="muted">Preview first. Commit only after the workbook passes validation.</span>
              </div>
            </div>
            <div className="import-controls">
              <label className="file-picker">
                Choose .xlsx
                <input type="file" accept=".xlsx" onChange={event => {
                  setSelectedFile(event.target.files?.[0] ?? null);
                  setPreview(null);
                }} />
              </label>
              <div className="selected-file">
                <strong>{selectedFile?.name || 'No workbook selected'}</strong>
                <span>{selectedFile ? 'Ready to validate' : 'Select the current Master Data workbook'}</span>
              </div>
              <div className="review-actions">
                <button className="button secondary" disabled={!selectedFile || importBusy != null} onClick={() => void importWorkbook(false)}>
                  {importBusy === 'preview' ? 'Validating…' : 'Preview'}
                </button>
                <button className="button" disabled={!selectedFile || importBusy != null} onClick={() => void importWorkbook(true)}>
                  {importBusy === 'commit' ? 'Importing…' : 'Import'}
                </button>
              </div>
            </div>
            {preview && (
              <div className="import-result">
                <div className="import-summary">
                  <div><span className="metric-label">Rows</span><strong className="metric">{Object.values(preview.rows).reduce((a, b) => a + b, 0)}</strong></div>
                  <div><span className="metric-label">Issues</span><strong className="metric">{preview.issues.length}</strong></div>
                  <div><span className="metric-label">Status</span><strong className="metric">{preview.committed ? 'Imported' : 'Preview'}</strong></div>
                </div>
                <div className="sheet-breakdown">
                  {Object.entries(preview.rows).map(([name, count]) => <div className="sheet-row" key={name}><span>{name}</span><strong>{count}</strong></div>)}
                </div>
                {preview.issues.length > 0 && <div className="issue-box"><strong>Needs review</strong><ul>{preview.issues.slice(0, 50).map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></div>}
              </div>
            )}
          </div>
        ) : (
          <div className="master-tab-body">
            <div className="master-toolbar">
              <div>
                <p className="eyebrow">{tabs.find(tab => tab.key === activeTab)?.label}</p>
                <h2>{tabs.find(tab => tab.key === activeTab)?.label}</h2>
                <span className="muted">{filteredRows.length} record{filteredRows.length === 1 ? '' : 's'} shown</span>
              </div>
              <div className="master-toolbar-actions">
                {activeTab === 'drivers' && (
                  <label>
                    People type
                    <select value={peopleFilter} onChange={event => setPeopleFilter(event.target.value)}>
                      {['All', 'Permanent', 'Casual', 'Agency', 'Subcontractor'].map(value => <option key={value}>{value}</option>)}
                    </select>
                  </label>
                )}
                <label>
                  Search
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search…" />
                </label>
                {activeTab !== 'fuelCards' && activeTab !== 'markets' && <button className="button" onClick={startCreate}>+ Add</button>}
                <button className="button secondary" disabled={loading} onClick={() => void loadRows(activeTab)}>{loading ? 'Loading…' : 'Refresh'}</button>
              </div>
            </div>
            {loading ? <div className="master-empty">Loading…</div> : <DataTable rows={filteredRows} tableColumns={activeColumns} onOpen={row => void openRecord(row)} />}
          </div>
        )}
      </div>

      {selected && activeTab !== 'review' && activeTab !== 'governance' && activeTab !== 'import' && (
        <div className="crm-modal-backdrop" role="dialog" aria-modal="true" onMouseDown={event => {
          if (event.target === event.currentTarget && !recordBusy) {
            setSelected(null);
            setSiteCrm(null);
            setEditing(false);
          }
        }}>
          <div className="crm-modal">
            <div className="crm-modal-header">
              <div>
                <p className="eyebrow">{activeTab === 'sites' ? 'Site CRM' : 'Master Data CRM'}</p>
                <h2>{creating ? 'New record' : titleFor(selected)}</h2>
                <p className="muted">{activeTab === 'sites' ? 'All operational knowledge for this location lives here.' : 'Canonical record with edit and audit history.'}</p>
              </div>
              <div className="crm-modal-top-actions">
                {!editing && <button className="button" onClick={() => { setDraft({ ...(activeTab === 'sites' && siteCrm ? siteCrm.site : selected) }); setEditing(true); }}>Edit</button>}
                {!creating && <button className="button danger" disabled={recordBusy} onClick={() => void archiveRecord()}>{activeTab === 'fuelCards' ? 'Clear cards' : 'Archive'}</button>}
                <button className="button secondary" disabled={recordBusy} onClick={() => { setSelected(null); setSiteCrm(null); setEditing(false); }}>Close</button>
              </div>
            </div>

            <div className="crm-modal-body">
              {editing && (
                <section className="crm-section crm-edit-section">
                  <SectionHeader eyebrow={creating ? 'Create' : 'Edit'} title={creating ? 'New Master Data record' : 'Edit record'} />
                  <FieldEditor fields={activeFields} draft={draft} setDraft={setDraft} />
                  <div className="crm-edit-actions">
                    <button className="button" disabled={recordBusy} onClick={() => void saveRecord()}>{recordBusy ? 'Saving…' : 'Save changes'}</button>
                    <button className="button secondary" disabled={recordBusy} onClick={() => {
                      if (creating) { setSelected(null); setCreating(false); }
                      else { setDraft({ ...(activeTab === 'sites' && siteCrm ? siteCrm.site : selected) }); setEditing(false); }
                    }}>Cancel</button>
                  </div>
                </section>
              )}

              {!creating && activeTab === 'sites' && (
                crmLoading || !siteCrm ? <div className="master-empty">Loading Site CRM…</div> : (
                  <>
                    <div className="site-crm-hero">
                      <div>
                        <span className="status-chip live">{formatValue(siteCrm.site.siteType || 'Site')}</span>
                        <h3>{formatValue(siteCrm.site.name)}</h3>
                        <p>{formatValue(siteCrm.site.fullAddress || siteCrm.site.postcode)}</p>
                      </div>
                      <div className="site-crm-quick">
                        <span><small>Collection</small><strong>{formatValue(siteCrm.site.earliestCollectionTime)} – {formatValue(siteCrm.site.latestCollectionTime)}</strong></span>
                        <span><small>Delivery</small><strong>{formatValue(siteCrm.site.earliestDeliveryTime)} – {formatValue(siteCrm.site.latestDeliveryTime)}</strong></span>
                        <span><small>Avg wait</small><strong>{formatValue(siteCrm.site.averageWaitMinutes)} min</strong></span>
                      </div>
                    </div>

                    <section className="crm-section">
                      <SectionHeader eyebrow="Identity & access" title="Site details" />
                      <div className="crm-detail-grid">
                        <div className="crm-field"><span>Customer</span><strong>{formatValue(siteCrm.customer?.name)}</strong></div>
                        <div className="crm-field"><span>Postcode</span><strong>{formatValue(siteCrm.site.postcode)}</strong></div>
                        <div className="crm-field"><span>What3Words</span><strong>{formatValue(siteCrm.site.what3Words)}</strong></div>
                        <div className="crm-field"><span>Geofence</span><strong>{formatValue(siteCrm.site.geofenceRadiusMeters)} m</strong></div>
                        <div className="crm-field wide"><span>Collection instructions</span><strong>{formatValue(siteCrm.site.collectionInstructions)}</strong></div>
                        <div className="crm-field wide"><span>Driver instructions</span><strong>{formatValue(siteCrm.site.driverInstructions)}</strong></div>
                      </div>
                    </section>

                    <section className="crm-section">
                      <SectionHeader
                        eyebrow="Contacts"
                        title="Site contacts"
                        count={siteCrm.customerContacts.length}
                        onAdd={siteCrm.site.customerId ? () => addChild('customer-contacts', 'New contact', childFields.contact, {
                          code: newId('CONTACT'),
                          customerId: siteCrm.site.customerId,
                          siteId: siteCrm.site.id,
                          contactName: '',
                        }) : undefined}
                      />
                      <ChildTable
                        rows={siteCrm.customerContacts}
                        tableColumns={[[ 'contactName', 'Contact' ], [ 'role', 'Role' ], [ 'email', 'Email' ], [ 'phone', 'Phone' ]]}
                        empty={siteCrm.site.customerId ? 'No contacts yet.' : 'Link the Site to a Customer before adding contacts.'}
                        onOpen={row => openChild('customer-contacts', 'Contact', childFields.contact, row)}
                      />
                    </section>

                    <section className="crm-section">
                      <SectionHeader
                        eyebrow="Timings & deadlines"
                        title="Operational time rules"
                        count={siteCrm.cutoffs.length}
                        onAdd={() => addChild('site-cutoffs', 'New deadline', childFields.cutoff, {
                          code: newId('CUT'),
                          siteId: siteCrm.site.id,
                        })}
                      />
                      <div className="crm-detail-grid deadline-grid">
                        <div className="crm-field"><span>Collection opens</span><strong>{formatValue(siteCrm.site.earliestCollectionTime)}</strong></div>
                        <div className="crm-field"><span>Last collection</span><strong>{formatValue(siteCrm.site.latestCollectionTime)}</strong></div>
                        <div className="crm-field"><span>Delivery opens</span><strong>{formatValue(siteCrm.site.earliestDeliveryTime)}</strong></div>
                        <div className="crm-field"><span>Latest delivery</span><strong>{formatValue(siteCrm.site.latestDeliveryTime)}</strong></div>
                        <div className="crm-field"><span>Standard cut-off</span><strong>{formatValue(siteCrm.site.standardCutoff)}</strong></div>
                        <div className="crm-field"><span>Extended cut-off</span><strong>{formatValue(siteCrm.site.extendedCutoff)}</strong></div>
                      </div>
                      <ChildTable
                        rows={siteCrm.cutoffs}
                        tableColumns={[[ 'plan', 'Plan' ], [ 'lastDespatchTime', 'Last despatch' ], [ 'plannedCollectFrom', 'Collect from' ], [ 'depotDeliveryDeadline', 'Deliver by' ]]}
                        empty="No service-specific deadlines yet."
                        onOpen={row => openChild('site-cutoffs', 'Deadline', childFields.cutoff, row)}
                      />
                    </section>

                    <section className="crm-section">
                      <SectionHeader
                        eyebrow="Planner knowledge"
                        title="Operational memory"
                        count={siteCrm.knowledge.length}
                        onAdd={() => addChild('site-knowledge', 'New knowledge', childFields.knowledge, {
                          siteId: siteCrm.site.id,
                          category: 'Planner',
                          title: '',
                          content: '',
                          priority: 0,
                        })}
                      />
                      <div className="knowledge-cards">
                        {siteCrm.knowledge.map(row => (
                          <button type="button" className="knowledge-card" key={row.id} onClick={() => openChild('site-knowledge', 'Knowledge', childFields.knowledge, row)}>
                            <span>{formatValue(row.category)}</span>
                            <strong>{formatValue(row.title)}</strong>
                            <p>{formatValue(row.content)}</p>
                          </button>
                        ))}
                        {!siteCrm.knowledge.length && <p className="muted">No structured planner knowledge yet.</p>}
                      </div>
                      {Boolean(siteCrm.site.plannerKnowledge || siteCrm.site.routingNotes) && (
                        <div className="crm-detail-grid legacy-knowledge">
                          <div className="crm-field wide"><span>Planner notes</span><strong>{formatValue(siteCrm.site.plannerKnowledge)}</strong></div>
                          <div className="crm-field wide"><span>Routing intelligence</span><strong>{formatValue(siteCrm.site.routingNotes)}</strong></div>
                        </div>
                      )}
                    </section>

                    <section className="crm-section">
                      <SectionHeader
                        eyebrow="Route timings"
                        title="Known movement timings"
                        count={siteCrm.routeTimes.length}
                        onAdd={() => addChild('route-times', 'New route timing', childFields.route, {
                          key: newId('ROUTE'),
                          siteId: siteCrm.site.id,
                          route: '',
                        })}
                      />
                      <ChildTable
                        rows={siteCrm.routeTimes}
                        tableColumns={[[ 'route', 'Movement' ], [ 'palletType', 'Pallet' ], [ 'lastDespatchTime', 'Last despatch' ], [ 'depotDeliveryDeadline', 'Arrive by' ]]}
                        empty="No route timing knowledge yet."
                        onOpen={row => openChild('route-times', 'Route timing', childFields.route, row)}
                      />
                    </section>

                    <section className="crm-section">
                      <SectionHeader
                        eyebrow="Equipment"
                        title="Pallet, trolley & trailer requirements"
                        count={siteCrm.equipment.length}
                        onAdd={() => addChild('site-equipment', 'New equipment rule', childFields.equipment, {
                          siteId: siteCrm.site.id,
                          equipmentType: '',
                          required: true,
                        })}
                      />
                      <ChildTable
                        rows={siteCrm.equipment}
                        tableColumns={[[ 'equipmentType', 'Equipment' ], [ 'required', 'Required' ], [ 'requirement', 'Requirement' ], [ 'notes', 'Notes' ]]}
                        empty="No structured equipment rules yet."
                        onOpen={row => openChild('site-equipment', 'Equipment rule', childFields.equipment, row)}
                      />
                    </section>

                    <section className="crm-section">
                      <SectionHeader
                        eyebrow="Booking"
                        title="Booking rules"
                        count={siteCrm.bookingRules.length}
                        onAdd={() => addChild('site-booking-rules', 'New booking rule', childFields.booking, {
                          siteId: siteCrm.site.id,
                          ruleType: 'Delivery',
                        })}
                      />
                      <ChildTable
                        rows={siteCrm.bookingRules}
                        tableColumns={[[ 'ruleType', 'Rule' ], [ 'bookingMethod', 'Method' ], [ 'leadTimeMinutes', 'Lead min' ], [ 'referenceFormat', 'Reference' ]]}
                        empty="No booking rules yet."
                        onOpen={row => openChild('site-booking-rules', 'Booking rule', childFields.booking, row)}
                      />
                    </section>

                    <section className="crm-section">
                      <SectionHeader eyebrow="Identity matching" title="Aliases & external IDs" count={siteCrm.aliases.length + siteCrm.externalIdentities.length} />
                      <div className="identity-columns">
                        <div>
                          <div className="identity-heading"><strong>Aliases</strong><button className="text-button" onClick={() => addChild('site-aliases', 'New alias', childFields.alias, { siteId: siteCrm.site.id, alias: '', source: 'Manual', approved: true })}>+ Add</button></div>
                          <div className="crm-chip-list">
                            {siteCrm.aliases.map(alias => <button className="crm-chip-button" key={alias.id} onClick={() => openChild('site-aliases', 'Alias', childFields.alias, alias)}>{formatValue(alias.alias)}</button>)}
                            {!siteCrm.aliases.length && <span className="muted">No aliases.</span>}
                          </div>
                        </div>
                        <div>
                          <div className="identity-heading"><strong>External IDs</strong><button className="text-button" onClick={() => addChild('external-identities', 'New external ID', childFields.identity, { provider: '', entityType: 'Site', entityId: siteCrm.site.id, externalKey: '', active: true })}>+ Add</button></div>
                          <div className="crm-chip-list">
                            {siteCrm.externalIdentities.map(identity => <button className="crm-chip-button" key={identity.id} onClick={() => openChild('external-identities', 'External ID', childFields.identity, identity)}>{formatValue(identity.provider)} · {formatValue(identity.externalKey)}</button>)}
                            {!siteCrm.externalIdentities.length && <span className="muted">No external IDs.</span>}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="crm-section">
                      <SectionHeader eyebrow="Market linkage" title="Markets at this Site" count={siteCrm.markets.length} />
                      <ChildTable
                        rows={siteCrm.markets}
                        tableColumns={[[ 'code', 'Code' ], [ 'name', 'Market' ], [ 'defaultInstructions', 'Instructions' ]]}
                        empty="No Markets are linked to this Site."
                        onOpen={row => openChild('markets', 'Market', childFields.market, row)}
                      />
                    </section>

                    <section className="crm-section">
                      <SectionHeader
                        eyebrow="Documents"
                        title="Maps, plans, photos & instructions"
                        count={siteCrm.documents.length}
                        onAdd={() => addChild('site-documents', 'New document', childFields.document, {
                          siteId: siteCrm.site.id,
                          documentType: 'Link',
                          title: '',
                        })}
                      />
                      <ChildTable
                        rows={siteCrm.documents}
                        tableColumns={[[ 'documentType', 'Type' ], [ 'title', 'Title' ], [ 'location', 'Location' ], [ 'notes', 'Notes' ]]}
                        empty="No Site documents or links yet."
                        onOpen={row => openChild('site-documents', 'Document', childFields.document, row)}
                      />
                    </section>

                    <section className="crm-section">
                      <SectionHeader eyebrow="History" title="Audit trail" count={siteCrm.history.length} />
                      <div className="audit-timeline">
                        {siteCrm.history.map(entry => (
                          <article key={entry.id}>
                            <span>{entry.action}</span>
                            <div><strong>{entry.updatedBy || 'System'}</strong><small>{new Date(entry.createdAtUtc).toLocaleString()}</small></div>
                            <em>{entry.sourceSystem || 'Manual'}</em>
                          </article>
                        ))}
                        {!siteCrm.history.length && <p className="muted">No changes have been audited yet.</p>}
                      </div>
                    </section>
                  </>
                )
              )}

              {!creating && activeTab !== 'sites' && !editing && (
                <>
                  <section className="crm-section">
                    <SectionHeader eyebrow="Record" title="Details" />
                    <div className="crm-detail-grid">
                      {Object.entries(selected).filter(([key]) => key !== 'id' && key !== 'vehicleId' && key !== 'active').filter(([, value]) => value != null && value !== '').map(([key, value]) => (
                        <div className={String(value).length > 80 ? 'crm-field wide' : 'crm-field'} key={key}>
                          <span>{key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')}</span>
                          <strong>{formatTableValue(key, value)}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="crm-section">
                    <SectionHeader eyebrow="History" title="Audit trail" count={history.length} />
                    <div className="audit-timeline">
                      {history.map(entry => (
                        <article key={entry.id}><span>{entry.action}</span><div><strong>{entry.updatedBy || 'System'}</strong><small>{new Date(entry.createdAtUtc).toLocaleString()}</small></div><em>{entry.sourceSystem || 'Manual'}</em></article>
                      ))}
                      {!history.length && <p className="muted">No audited changes yet.</p>}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {childEditor && (
        <div className="crm-modal-backdrop child-modal-backdrop" role="dialog" aria-modal="true" onMouseDown={event => {
          if (event.target === event.currentTarget && !childBusy) setChildEditor(null);
        }}>
          <div className="crm-modal child-modal">
            <div className="crm-modal-header">
              <div><p className="eyebrow">{childEditor.isNew ? 'Add Site knowledge' : 'Edit linked data'}</p><h2>{childEditor.title}</h2></div>
              <button className="button secondary" disabled={childBusy} onClick={() => setChildEditor(null)}>Close</button>
            </div>
            <div className="crm-modal-body">
              <section className="crm-section crm-edit-section">
                <FieldEditor fields={childEditor.fields} draft={childDraft} setDraft={setChildDraft} />
                <div className="crm-edit-actions">
                  <button className="button" disabled={childBusy} onClick={() => void saveChild()}>{childBusy ? 'Saving…' : 'Save changes'}</button>
                  {!childEditor.isNew && <button className="button danger" disabled={childBusy} onClick={() => void archiveChild()}>Archive</button>}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
