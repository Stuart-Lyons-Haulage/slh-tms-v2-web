import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  MasterCounts,
  MasterRecord,
  MasterWorkbookImportResult,
  ReviewAllocation,
  SiteCrmProfile,
} from '../lib/api';

type MasterTab =
  | 'sites'
  | 'customers'
  | 'drivers'
  | 'vehicles'
  | 'fuelCards'
  | 'trailers'
  | 'markets'
  | 'marketContacts'
  | 'fuelPrices'
  | 'review'
  | 'import';

type Column = [string, string];
type EditableField = {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'checkbox' | 'date' | 'time';
};

const tabs: Array<{ key: MasterTab; label: string; count?: keyof MasterCounts }> = [
  { key: 'sites', label: 'Sites', count: 'sites' },
  { key: 'customers', label: 'Customers', count: 'customers' },
  { key: 'drivers', label: 'Drivers', count: 'drivers' },
  { key: 'vehicles', label: 'Vehicles', count: 'vehicles' },
  { key: 'fuelCards', label: 'Fuel Cards', count: 'fuelCards' },
  { key: 'trailers', label: 'Trailers', count: 'trailers' },
  { key: 'markets', label: 'Markets', count: 'markets' },
  { key: 'marketContacts', label: 'Market Contacts', count: 'marketContacts' },
  { key: 'fuelPrices', label: 'Fuel Prices', count: 'fuelPrices' },
  { key: 'review', label: 'Review' },
  { key: 'import', label: 'Import' },
];

const columns: Record<Exclude<MasterTab, 'review' | 'import'>, Column[]> = {
  sites: [
    ['code', 'Code'],
    ['name', 'Site'],
    ['driverTextName', 'Driver text'],
    ['postcode', 'Postcode'],
    ['fullAddress', 'Address'],
  ],
  customers: [
    ['code', 'Code'],
    ['name', 'Customer'],
  ],
  drivers: [
    ['displayName', 'Driver'],
    ['employeeNumber', 'Employee'],
    ['mobileNumber', 'Mobile'],
    ['email', 'Email'],
    ['tachoMasterMemberCode', 'Member no.'],
    ['tachoCardNumber', 'Tacho card'],
    ['driverType', 'Type'],
  ],
  vehicles: [
    ['registration', 'Registration'],
    ['fleetNumber', 'Fleet no.'],
    ['abbreviation', 'Short code'],
    ['vehicleType', 'Type'],
    ['transmission', 'Transmission'],
    ['dvs', 'DVS'],
    ['cabMobile', 'Cab phone'],
  ],
  fuelCards: [
    ['vehicleRegistration', 'Vehicle'],
    ['provider', 'Provider'],
    ['cardType', 'Card type'],
    ['cardNumber', 'Card number'],
    ['pin', 'PIN'],
    ['notes', 'Notes'],
  ],
  trailers: [
    ['trailerNumber', 'Trailer'],
    ['trailerType', 'Type'],
    ['currentLocation', 'Current location'],
    ['palletCapacity', 'Std pallets'],
    ['euroPalletCapacity', 'Euro pallets'],
    ['motExpiry', 'MOT / test expiry'],
  ],
  markets: [
    ['code', 'Code'],
    ['name', 'Market'],
    ['defaultInstructions', 'Instructions'],
  ],
  marketContacts: [
    ['marketName', 'Market'],
    ['name', 'Name'],
    ['standOrLocation', 'Stand / location'],
    ['salesman', 'Salesman'],
    ['sender', 'Sender'],
  ],
  fuelPrices: [
    ['weekCommencing', 'Week commencing'],
    ['provider', 'Provider'],
    ['pricePencePerLitre', 'Pence / litre'],
    ['isPricingMaximum', 'Pricing maximum'],
    ['source', 'Source'],
  ],
};

const editableFields: Record<Exclude<MasterTab, 'review' | 'import'>, EditableField[]> = {
  sites: [
    { key: 'code', label: 'Site code' },
    { key: 'name', label: 'Site name' },
    { key: 'driverTextName', label: 'Driver text name' },
    { key: 'fullAddress', label: 'Full address', type: 'textarea' },
    { key: 'postcode', label: 'Postcode' },
    { key: 'mapLink', label: 'Map link' },
    { key: 'collectionInstructions', label: 'Collection instructions', type: 'textarea' },
    { key: 'driverInstructions', label: 'Driver instructions', type: 'textarea' },
    { key: 'earliestCollectionTime', label: 'Earliest collection time', type: 'time' },
    { key: 'latestCollectionTime', label: 'Last collection time', type: 'time' },
    { key: 'earliestDeliveryTime', label: 'Earliest delivery time', type: 'time' },
    { key: 'latestDeliveryTime', label: 'Latest delivery time', type: 'time' },
    { key: 'standardCutoff', label: 'Standard cut-off', type: 'time' },
    { key: 'extendedCutoff', label: 'Extended cut-off', type: 'time' },
    { key: 'deadlineContact', label: 'Deadline contact' },
    { key: 'deadlineNotes', label: 'Deadline notes', type: 'textarea' },
    { key: 'latitude', label: 'Latitude', type: 'number' },
    { key: 'longitude', label: 'Longitude', type: 'number' },
  ],
  customers: [
    { key: 'code', label: 'Customer code' },
    { key: 'name', label: 'Customer name' },
  ],
  drivers: [
    { key: 'displayName', label: 'Driver name' },
    { key: 'employeeNumber', label: 'Employee number' },
    { key: 'mobileNumber', label: 'Mobile number', type: 'tel' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'tachoName', label: 'TachoMaster name' },
    { key: 'tachoMasterMemberCode', label: 'TachoMaster member number' },
    { key: 'tachoCardNumber', label: 'Tacho card number' },
    { key: 'tachoMasterDriverId', label: 'TachoMaster driver ID' },
    { key: 'driverType', label: 'Driver type' },
    { key: 'driverGroup', label: 'Driver group' },
    { key: 'skills', label: 'Skills', type: 'textarea' },
    { key: 'coding', label: 'Coding' },
    { key: 'agencyName', label: 'Agency name' },
    { key: 'northEligible', label: 'North eligible', type: 'checkbox' },
    { key: 'preloadEligible', label: 'Preload eligible', type: 'checkbox' },
    { key: 'drivingLicenceNumber', label: 'Driving licence number' },
    { key: 'licenceExpiry', label: 'Licence expiry', type: 'date' },
    { key: 'licenceStatus', label: 'Licence status' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  vehicles: [
    { key: 'registration', label: 'Registration' },
    { key: 'fleetNumber', label: 'Fleet number' },
    { key: 'abbreviation', label: 'Short code' },
    { key: 'vehicleType', label: 'Vehicle type' },
    { key: 'transmission', label: 'Transmission' },
    { key: 'dvs', label: 'DVS' },
    { key: 'cabMobile', label: 'Cab phone', type: 'tel' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  fuelCards: [
    { key: 'provider', label: 'Provider' },
    { key: 'cardType', label: 'Card type' },
    { key: 'cardNumber', label: 'Card number' },
    { key: 'pin', label: 'PIN' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  trailers: [
    { key: 'trailerNumber', label: 'Trailer number' },
    { key: 'registration', label: 'Registration / identifier' },
    { key: 'trailerType', label: 'Trailer type' },
    { key: 'currentLocation', label: 'Current location' },
    { key: 'palletCapacity', label: 'Standard pallet capacity', type: 'number' },
    { key: 'euroPalletCapacity', label: 'Euro pallet capacity', type: 'number' },
    { key: 'motExpiry', label: 'MOT / test expiry', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  markets: [
    { key: 'code', label: 'Market code' },
    { key: 'name', label: 'Market name' },
    { key: 'defaultInstructions', label: 'Default instructions', type: 'textarea' },
  ],
  marketContacts: [
    { key: 'marketName', label: 'Market' },
    { key: 'name', label: 'Name' },
    { key: 'standOrLocation', label: 'Stand / location' },
    { key: 'salesman', label: 'Salesman' },
    { key: 'sender', label: 'Sender' },
  ],
  fuelPrices: [
    { key: 'code', label: 'Fuel price code' },
    { key: 'weekCommencing', label: 'Week commencing', type: 'date' },
    { key: 'provider', label: 'Provider' },
    { key: 'pricePencePerLitre', label: 'Pence per litre', type: 'number' },
    { key: 'isPricingMaximum', label: 'Pricing maximum', type: 'checkbox' },
    { key: 'source', label: 'Source' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

function entitySlug(tab: MasterTab) {
  switch (tab) {
    case 'fuelCards': return 'fuel-cards';
    case 'marketContacts': return 'market-contacts';
    case 'fuelPrices': return 'fuel-prices';
    default: return tab;
  }
}

function formatValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatTableValue(key: string, value: unknown) {
  if (value == null || value === '') return '—';

  if (key === 'pin') return '••••';
  if (key === 'cardNumber') {
    const text = String(value).replace(/\s/g, '');
    return text.length <= 4 ? text : `•••• ${text.slice(-4)}`;
  }

  return formatValue(value);
}

function matchesSearch(row: Record<string, unknown>, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return Object.values(row).some(value =>
    value != null && String(value).toLowerCase().includes(needle),
  );
}

function readableKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, value => value.toUpperCase());
}

function SimpleDetail({ row }: { row: MasterRecord }) {
  const hidden = new Set(['id', 'vehicleId']);
  const entries = Object.entries(row)
    .filter(([key]) => !hidden.has(key))
    .filter(([, value]) => value != null && value !== '');

  return (
    <div className="crm-detail-grid">
      {entries.map(([key, value]) => (
        <div className="crm-field" key={key}>
          <span>{readableKey(key)}</span>
          <strong>{formatValue(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function SmallTable({
  rows,
  columns: tableColumns,
  empty,
}: {
  rows: MasterRecord[];
  columns: Column[];
  empty: string;
}) {
  if (!rows.length) return <p className="muted">{empty}</p>;

  return (
    <div className="master-table-scroll compact">
      <table className="master-table">
        <thead>
          <tr>
            {tableColumns.map(([, label]) => <th key={label}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
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
  const [reviewRows, setReviewRows] = useState<ReviewAllocation[]>([]);
  const [siteOptions, setSiteOptions] = useState<MasterRecord[]>([]);
  const [allocationSite, setAllocationSite] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MasterRecord | null>(null);
  const [siteCrm, setSiteCrm] = useState<SiteCrmProfile | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [recordBusy, setRecordBusy] = useState(false);
  const [allocatingId, setAllocatingId] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MasterWorkbookImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshCounts = useCallback(async () => {
    setCounts(await api.masterCounts());
  }, []);

  const loadRows = useCallback(async (tab: MasterTab) => {
    if (tab === 'import') {
      setRows([]);
      setReviewRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (tab === 'review') {
        const [review, sites] = await Promise.all([
          api.reviewAllocations(),
          api.sites(),
        ]);
        setReviewRows(review);
        setSiteOptions(sites);
        setRows([]);
        return;
      }

      let loaded: MasterRecord[] = [];
      switch (tab) {
        case 'sites': loaded = await api.sites(); break;
        case 'customers': loaded = await api.customers(); break;
        case 'drivers': loaded = await api.drivers(); break;
        case 'vehicles': loaded = await api.vehicles(); break;
        case 'fuelCards': loaded = await api.fuelCards(); break;
        case 'trailers': loaded = await api.trailers(); break;
        case 'markets': loaded = await api.markets(); break;
        case 'marketContacts': loaded = await api.marketContacts(); break;
        case 'fuelPrices': loaded = await api.fuelPrices(); break;
      }
      setRows(loaded);
      setReviewRows([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Master Data.');
      setRows([]);
      setReviewRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCounts().catch(err =>
      setError(err instanceof Error ? err.message : 'Unable to load Master Data.'),
    );
  }, [refreshCounts]);

  useEffect(() => {
    setQuery('');
    setSelected(null);
    setSiteCrm(null);
    setEditing(false);
    void loadRows(activeTab);
  }, [activeTab, loadRows]);

  const filteredRows = useMemo(
    () => rows.filter(row => matchesSearch(row, query)),
    [rows, query],
  );

  const filteredReviewRows = useMemo(
    () => reviewRows.filter(row => matchesSearch(row as unknown as Record<string, unknown>, query)),
    [reviewRows, query],
  );

  const reviewCount = reviewRows.length || ((counts?.aliasCandidates ?? 0) + (counts?.reviewItems ?? 0));

  const preparedRows = useMemo(
    () => preview
      ? Object.values(preview.rows).reduce((total, count) => total + count, 0)
      : 0,
    [preview],
  );

  async function openRow(row: MasterRecord) {
    setSelected(row);
    setDraft({ ...row });
    setEditing(false);
    setSiteCrm(null);

    if (activeTab !== 'sites') return;

    setCrmLoading(true);
    setError(null);
    try {
      setSiteCrm(await api.siteCrm(row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open the Site CRM.');
    } finally {
      setCrmLoading(false);
    }
  }

  async function saveRecord() {
    if (!selected || activeTab === 'review' || activeTab === 'import') return;

    setRecordBusy(true);
    setError(null);
    try {
      const updated = await api.updateMasterRecord(entitySlug(activeTab), selected.id, draft);
      setSelected(updated);
      setDraft({ ...updated });
      setEditing(false);

      if (activeTab === 'sites') {
        setSiteCrm(await api.siteCrm(selected.id));
      }

      await loadRows(activeTab);
      await refreshCounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Master Data record could not be saved.');
    } finally {
      setRecordBusy(false);
    }
  }

  async function deleteRecord() {
    if (!selected || activeTab === 'review' || activeTab === 'import') return;

    const label = formatValue(
      selected.name ??
      selected.displayName ??
      selected.registration ??
      selected.vehicleRegistration ??
      selected.trailerNumber ??
      selected.code ??
      selected.contactName ??
      selected.provider,
    );

    if (!window.confirm(`Permanently delete ${label}?\n\nLinked records are protected and the delete will be blocked where necessary.`)) {
      return;
    }

    setRecordBusy(true);
    setError(null);
    try {
      await api.deleteMasterRecord(entitySlug(activeTab), selected.id);
      setSelected(null);
      setSiteCrm(null);
      setEditing(false);
      await loadRows(activeTab);
      await refreshCounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Master Data record could not be deleted.');
    } finally {
      setRecordBusy(false);
    }
  }

  async function allocateReview(row: ReviewAllocation) {
    const siteId = allocationSite[row.id];
    if (!siteId) return;

    setAllocatingId(row.id);
    setError(null);
    try {
      await api.allocateReviewToSite(row.kind, row.id, siteId);
      await Promise.all([loadRows('review'), refreshCounts()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The review item could not be allocated.');
    } finally {
      setAllocatingId(null);
    }
  }

  async function runImport(commit: boolean) {
    if (!selectedFile) return;

    setBusy(commit ? 'commit' : 'preview');
    setError(null);
    try {
      const result = await api.uploadMasterWorkbook(selectedFile, commit);
      setPreview(result);
      if (commit) {
        await refreshCounts();
        await loadRows(activeTab);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Master Data workbook import failed.');
    } finally {
      setBusy(null);
    }
  }

  const activeLabel = tabs.find(tab => tab.key === activeTab)?.label ?? 'Master Data';
  const activeEditableFields: EditableField[] =
    activeTab === 'review' || activeTab === 'import'
      ? []
      : editableFields[activeTab];

  const activeColumns: Column[] =
    activeTab === 'review' || activeTab === 'import'
      ? []
      : columns[activeTab];

  return (
    <section>
      <header className="page-header master-header">
        <div>
          <p className="eyebrow">Single operational register</p>
          <h1>Master Data</h1>
          <p>Sites own their deadlines, contacts and planner knowledge. Fleet fuel cards are managed separately from vehicle records.</p>
        </div>
        <div className="status good">Canonical V2</div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <div className="master-hub panel">
        <div className="master-tabs" role="tablist" aria-label="Master Data sections">
          {tabs.map(tab => {
            const tabCount = tab.key === 'review'
              ? reviewCount
              : tab.count && counts
                ? counts[tab.count]
                : null;

            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={activeTab === tab.key ? 'active' : ''}
                onClick={() => setActiveTab(tab.key)}
              >
                <span>{tab.label}</span>
                {tabCount != null && <strong>{tabCount}</strong>}
              </button>
            );
          })}
        </div>

        {activeTab === 'import' ? (
          <div className="master-tab-body">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Controlled workbook import</p>
                <h2>Master Data Workbook</h2>
                <p className="muted">Preview first. Import only after the workbook and review items look right.</p>
              </div>
            </div>

            <div className="import-controls">
              <label className="file-picker">
                <span>Choose .xlsx workbook</span>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={event => {
                    setSelectedFile(event.target.files?.[0] ?? null);
                    setPreview(null);
                    setError(null);
                  }}
                />
              </label>

              <div className="selected-file">
                {selectedFile ? (
                  <>
                    <strong>{selectedFile.name}</strong>
                    <span>{Math.max(1, Math.round(selectedFile.size / 1024))} KB</span>
                  </>
                ) : (
                  <span>No workbook selected</span>
                )}
              </div>

              <div className="review-actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={!selectedFile || busy !== null}
                  onClick={() => void runImport(false)}
                >
                  {busy === 'preview' ? 'Checking…' : 'Preview workbook'}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={!selectedFile || !preview || busy !== null}
                  onClick={() => void runImport(true)}
                >
                  {busy === 'commit' ? 'Importing…' : 'Import to V2'}
                </button>
              </div>
            </div>

            {preview && (
              <div className="import-result">
                <div className="import-summary">
                  <div>
                    <span className="metric-label">Rows prepared</span>
                    <strong className="metric">{preparedRows}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Review issues</span>
                    <strong className="metric">{preview.issues.length}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Status</span>
                    <strong className="metric">{preview.committed ? 'Imported' : 'Preview only'}</strong>
                  </div>
                </div>

                <div className="sheet-breakdown">
                  {Object.entries(preview.rows).map(([sheet, count]) => (
                    <div className="sheet-row" key={sheet}>
                      <span>{sheet}</span>
                      <strong>{count}</strong>
                    </div>
                  ))}
                </div>

                {preview.issues.length > 0 && (
                  <div className="issue-box">
                    <strong>Needs review</strong>
                    <ul>
                      {preview.issues.slice(0, 40).map((issue, index) => (
                        <li key={`${index}-${issue}`}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'review' ? (
          <div className="master-tab-body">
            <div className="master-toolbar">
              <div>
                <p className="eyebrow">Relationship review</p>
                <h2>Allocate to Site</h2>
                <span className="muted">{filteredReviewRows.length} item{filteredReviewRows.length === 1 ? '' : 's'} need a Site relationship</span>
              </div>
              <div className="master-toolbar-actions">
                <label>
                  Search
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Alias, contact, route or reference"
                  />
                </label>
                <button className="button secondary" type="button" disabled={loading} onClick={() => void loadRows('review')}>
                  {loading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="master-empty">Loading review items…</div>
            ) : filteredReviewRows.length ? (
              <div className="allocation-list">
                {filteredReviewRows.map(row => (
                  <article className="allocation-row" key={`${row.kind}-${row.id}`}>
                    <div className="allocation-main">
                      <span className="status-chip review">{row.category}</span>
                      <strong>{row.summary}</strong>
                      <small>{[row.reference, row.source].filter(Boolean).join(' · ')}</small>
                    </div>
                    <div className="allocation-actions">
                      <select
                        value={allocationSite[row.id] ?? ''}
                        onChange={event => setAllocationSite(current => ({ ...current, [row.id]: event.target.value }))}
                      >
                        <option value="">Select Site…</option>
                        {siteOptions.map(site => (
                          <option value={site.id} key={site.id}>
                            {formatValue(site.name)} ({formatValue(site.code)})
                          </option>
                        ))}
                      </select>
                      <button
                        className="button"
                        type="button"
                        disabled={!allocationSite[row.id] || allocatingId === row.id}
                        onClick={() => void allocateReview(row)}
                      >
                        {allocatingId === row.id ? 'Allocating…' : 'Allocate'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="master-empty">Nothing currently needs Site allocation.</div>
            )}
          </div>
        ) : (
          <div className="master-tab-body">
            <div className="master-toolbar">
              <div>
                <p className="eyebrow">{activeLabel}</p>
                <h2>{activeLabel}</h2>
                <span className="muted">{filteredRows.length} record{filteredRows.length === 1 ? '' : 's'} shown</span>
              </div>
              <div className="master-toolbar-actions">
                <label>
                  Search
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={activeTab === 'sites' ? 'Site, code, address or postcode' : `Search ${activeLabel.toLowerCase()}`}
                  />
                </label>
                <button className="button secondary" type="button" disabled={loading} onClick={() => void loadRows(activeTab)}>
                  {loading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="master-empty">Loading {activeLabel.toLowerCase()}…</div>
            ) : (
              <div className="master-table-scroll">
                <table className="master-table">
                  <thead>
                    <tr>
                      {activeColumns.map(([, label]) => <th key={label}>{label}</th>)}
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(row => (
                      <tr
                        key={row.id}
                        className="master-click-row"
                        onClick={() => void openRow(row)}
                      >
                        {activeColumns.map(([key]) => (
                          <td key={key}>{formatTableValue(key, row[key])}</td>
                        ))}
                        <td>
                          <span className={row.active === false ? 'status-chip archived' : 'status-chip live'}>
                            {row.active === false ? 'Archived' : 'Active'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredRows.length && <div className="master-empty">No records match this view.</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {selected && activeTab !== 'review' && activeTab !== 'import' && (
        <div
          className="crm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={activeTab === 'sites' ? 'Site CRM' : `${activeLabel} record`}
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setSelected(null);
              setSiteCrm(null);
              setEditing(false);
            }
          }}
        >
          <div className="crm-modal">
            <div className="crm-modal-header">
              <div>
                <p className="eyebrow">{activeTab === 'sites' ? 'Site CRM' : `${activeLabel} Master Data`}</p>
                <h2>{formatValue(
                  selected.name ??
                  selected.displayName ??
                  selected.registration ??
                  selected.vehicleRegistration ??
                  selected.trailerNumber ??
                  selected.code ??
                  selected.provider,
                )}</h2>
                <p className="muted">
                  {activeTab === 'sites'
                    ? 'Deadlines, contacts and planner knowledge live against this Site.'
                    : 'Canonical V2 record.'}
                </p>
              </div>
              <div className="crm-modal-top-actions">
                {!editing && (
                  <button
                    className="button"
                    type="button"
                    disabled={recordBusy}
                    onClick={() => {
                      const source = activeTab === 'sites' && siteCrm ? siteCrm.site : selected;
                      setDraft({ ...source });
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                )}
                <button className="button danger" type="button" disabled={recordBusy} onClick={() => void deleteRecord()}>
                  Delete
                </button>
                <button
                  className="button secondary"
                  type="button"
                  disabled={recordBusy}
                  onClick={() => {
                    setSelected(null);
                    setSiteCrm(null);
                    setEditing(false);
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="crm-modal-body">
              {editing && (
                <section className="crm-section crm-edit-section">
                  <div className="crm-section-heading">
                    <div>
                      <p className="eyebrow">Edit Master Data</p>
                      <h3>{activeLabel} record</h3>
                    </div>
                  </div>

                  <div className="crm-edit-grid">
                    {activeEditableFields.map(field => {
                      const value = draft[field.key];

                      if (field.type === 'checkbox') {
                        return (
                          <label className="crm-checkbox" key={field.key}>
                            <input
                              type="checkbox"
                              checked={Boolean(value)}
                              onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.checked }))}
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
                              rows={3}
                              value={String(value ?? '')}
                              onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value || null }))}
                            />
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
                              const nextValue = field.type === 'number'
                                ? (raw === '' ? null : Number(raw))
                                : (raw === '' ? null : raw);
                              setDraft(current => ({ ...current, [field.key]: nextValue }));
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>

                  <div className="crm-edit-actions">
                    <button className="button" type="button" disabled={recordBusy} onClick={() => void saveRecord()}>
                      {recordBusy ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={recordBusy}
                      onClick={() => {
                        const source = activeTab === 'sites' && siteCrm ? siteCrm.site : selected;
                        setDraft({ ...source });
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              )}

              {activeTab === 'sites' ? (
                crmLoading || !siteCrm ? (
                  <div className="master-empty">Loading Site CRM…</div>
                ) : (
                  <>
                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div>
                          <p className="eyebrow">Site identity</p>
                          <h3>{formatValue(siteCrm.site.name)}</h3>
                        </div>
                        <span className="status-chip live">{formatValue(siteCrm.site.code)}</span>
                      </div>
                      <div className="crm-detail-grid">
                        <div className="crm-field"><span>Driver text</span><strong>{formatValue(siteCrm.site.driverTextName)}</strong></div>
                        <div className="crm-field"><span>Postcode</span><strong>{formatValue(siteCrm.site.postcode)}</strong></div>
                        <div className="crm-field wide"><span>Address</span><strong>{formatValue(siteCrm.site.fullAddress)}</strong></div>
                        <div className="crm-field wide"><span>Collection instructions</span><strong>{formatValue(siteCrm.site.collectionInstructions)}</strong></div>
                        <div className="crm-field"><span>Customer</span><strong>{formatValue(siteCrm.customer?.name)}</strong></div>
                        <div className="crm-field"><span>Customer code</span><strong>{formatValue(siteCrm.customer?.code)}</strong></div>
                      </div>
                    </section>

                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div>
                          <p className="eyebrow">Deadlines</p>
                          <h3>Collection & delivery limits</h3>
                        </div>
                      </div>
                      <div className="crm-detail-grid">
                        <div className="crm-field"><span>Earliest collection</span><strong>{formatValue(siteCrm.site.earliestCollectionTime)}</strong></div>
                        <div className="crm-field"><span>Last collection</span><strong>{formatValue(siteCrm.site.latestCollectionTime)}</strong></div>
                        <div className="crm-field"><span>Earliest delivery</span><strong>{formatValue(siteCrm.site.earliestDeliveryTime)}</strong></div>
                        <div className="crm-field"><span>Latest delivery</span><strong>{formatValue(siteCrm.site.latestDeliveryTime)}</strong></div>
                        <div className="crm-field"><span>Standard cut-off</span><strong>{formatValue(siteCrm.site.standardCutoff)}</strong></div>
                        <div className="crm-field"><span>Extended cut-off</span><strong>{formatValue(siteCrm.site.extendedCutoff)}</strong></div>
                        <div className="crm-field"><span>Deadline contact</span><strong>{formatValue(siteCrm.site.deadlineContact)}</strong></div>
                        <div className="crm-field wide"><span>Deadline notes</span><strong>{formatValue(siteCrm.site.deadlineNotes)}</strong></div>
                      </div>

                      <SmallTable
                        rows={siteCrm.cutoffs}
                        columns={[
                          ['plan', 'Plan / service'],
                          ['plannedCollectFrom', 'Earliest collection'],
                          ['plannedCollectTo', 'Last collection'],
                          ['depotDeliveryDeadline', 'Latest delivery'],
                          ['standardCutoff', 'Standard cut-off'],
                          ['extendedCutoff', 'Extended cut-off'],
                        ]}
                        empty="No service-specific deadline rules are attached to this Site."
                      />
                    </section>

                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div>
                          <p className="eyebrow">Contacts</p>
                          <h3>Customer contacts for this Site</h3>
                        </div>
                        <span className="crm-count">{siteCrm.customerContacts.length}</span>
                      </div>
                      <SmallTable
                        rows={siteCrm.customerContacts}
                        columns={[
                          ['contactName', 'Contact'],
                          ['role', 'Role'],
                          ['email', 'Email'],
                          ['phone', 'Phone'],
                          ['notes', 'Notes'],
                        ]}
                        empty="No customer contacts are allocated to this Site."
                      />
                    </section>

                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div>
                          <p className="eyebrow">Planner knowledge</p>
                          <h3>Typical route guidance</h3>
                          <p className="muted">Operational guidance only; deadlines above remain the hard constraint.</p>
                        </div>
                        <span className="crm-count">{siteCrm.routeTimes.length}</span>
                      </div>
                      <SmallTable
                        rows={siteCrm.routeTimes}
                        columns={[
                          ['route', 'Route / movement'],
                          ['palletType', 'Pallet'],
                          ['lastDespatchTime', 'Last sensible despatch'],
                          ['plannedCollectFrom', 'Typical collect from'],
                          ['plannedCollectTo', 'Typical collect to'],
                          ['depotDeliveryDeadline', 'Planned arrival by'],
                        ]}
                        empty="No planner knowledge is allocated to this Site."
                      />
                    </section>

                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div><p className="eyebrow">Identity matching</p><h3>Aliases & integrations</h3></div>
                        <span className="crm-count">{siteCrm.aliases.length + siteCrm.externalIdentities.length}</span>
                      </div>
                      <div className="crm-chip-list">
                        {siteCrm.aliases.map(alias => <span key={alias.id}>{formatValue(alias.alias)}</span>)}
                        {siteCrm.externalIdentities.map(identity => (
                          <span key={identity.id}>
                            {formatValue(identity.provider)} · {formatValue(identity.externalKey)}
                          </span>
                        ))}
                        {!siteCrm.aliases.length && !siteCrm.externalIdentities.length && (
                          <span className="muted">No linked aliases or external identities.</span>
                        )}
                      </div>
                    </section>

                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div><p className="eyebrow">Market linkage</p><h3>Markets</h3></div>
                        <span className="crm-count">{siteCrm.markets.length}</span>
                      </div>
                      <SmallTable
                        rows={siteCrm.markets}
                        columns={[
                          ['code', 'Code'],
                          ['name', 'Market'],
                          ['defaultInstructions', 'Instructions'],
                        ]}
                        empty="No market records are linked to this Site."
                      />
                    </section>

                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div><p className="eyebrow">Attention</p><h3>Review items</h3></div>
                        <span className={siteCrm.reviewItems.length ? 'crm-count attention' : 'crm-count'}>{siteCrm.reviewItems.length}</span>
                      </div>
                      {siteCrm.reviewItems.length ? (
                        <div className="crm-review-list">
                          {siteCrm.reviewItems.map(item => (
                            <article key={item.id}>
                              <strong>{item.category}</strong>
                              <span>{item.summary}</span>
                              <small>{item.sourceReference || item.entityType}</small>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">Nothing about this Site currently needs review.</p>
                      )}
                    </section>
                  </>
                )
              ) : (
                !editing && (
                  <section className="crm-section">
                    <p className="eyebrow">Record details</p>
                    <SimpleDetail row={selected} />
                  </section>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
