import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  MasterCounts,
  MasterRecord,
  MasterWorkbookImportResult,
  SiteCrmProfile,
} from '../lib/api';

type MasterTab =
  | 'sites'
  | 'customers'
  | 'drivers'
  | 'vehicles'
  | 'trailers'
  | 'markets'
  | 'siteCutoffs'
  | 'routeTimes'
  | 'customerContacts'
  | 'marketContacts'
  | 'fuelPrices'
  | 'review'
  | 'import';

type Column = [string, string];

const tabs: Array<{ key: MasterTab; label: string; count?: keyof MasterCounts }> = [
  { key: 'sites', label: 'Sites', count: 'sites' },
  { key: 'customers', label: 'Customers', count: 'customers' },
  { key: 'drivers', label: 'Drivers', count: 'drivers' },
  { key: 'vehicles', label: 'Vehicles', count: 'vehicles' },
  { key: 'trailers', label: 'Trailers', count: 'trailers' },
  { key: 'markets', label: 'Markets', count: 'markets' },
  { key: 'siteCutoffs', label: 'Site Cut-offs', count: 'siteCutoffs' },
  { key: 'routeTimes', label: 'Route Times', count: 'routeTimes' },
  { key: 'customerContacts', label: 'Customer Contacts', count: 'customerContacts' },
  { key: 'marketContacts', label: 'Market Contacts', count: 'marketContacts' },
  { key: 'fuelPrices', label: 'Fuel Prices', count: 'fuelPrices' },
  { key: 'review', label: 'Review' },
  { key: 'import', label: 'Import' },
];

const columns: Record<Exclude<MasterTab, 'import'>, Column[]> = {
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
    ['tachoName', 'Tacho name'],
    ['driverType', 'Type'],
    ['driverGroup', 'Group'],
    ['skills', 'Skills'],
  ],
  vehicles: [
    ['registration', 'Registration'],
    ['fleetNumber', 'Fleet no.'],
    ['abbreviation', 'Short code'],
    ['vehicleType', 'Type'],
    ['transmission', 'Transmission'],
  ],
  trailers: [
    ['trailerNumber', 'Trailer'],
    ['trailerType', 'Type'],
    ['palletCapacity', 'Capacity'],
  ],
  markets: [
    ['code', 'Code'],
    ['name', 'Market'],
    ['defaultInstructions', 'Instructions'],
  ],
  siteCutoffs: [
    ['code', 'Code'],
    ['plan', 'Plan'],
    ['standardCutoff', 'Standard cutoff'],
    ['extendedCutoff', 'Extended cutoff'],
    ['temperature', 'Temperature'],
    ['palletType', 'Pallet type'],
  ],
  routeTimes: [
    ['route', 'Route'],
    ['palletType', 'Pallet type'],
    ['lastDespatchTime', 'Last despatch'],
    ['plannedCollectFrom', 'Collect from'],
    ['plannedCollectTo', 'Collect to'],
    ['depotDeliveryDeadline', 'Delivery deadline'],
  ],
  customerContacts: [
    ['contactName', 'Contact'],
    ['role', 'Role'],
    ['email', 'Email'],
    ['phone', 'Phone'],
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
  review: [
    ['reviewKind', 'Type'],
    ['summary', 'Issue'],
    ['sourceReference', 'Reference'],
    ['source', 'Source'],
  ],
};

function formatValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function matchesSearch(row: MasterRecord, query: string) {
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
  const entries = Object.entries(row)
    .filter(([key]) => key !== 'id')
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
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MasterRecord | null>(null);
  const [siteCrm, setSiteCrm] = useState<SiteCrmProfile | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);

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
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let loaded: MasterRecord[];
      switch (tab) {
        case 'sites': loaded = await api.sites(); break;
        case 'customers': loaded = await api.customers(); break;
        case 'drivers': loaded = await api.drivers(); break;
        case 'vehicles': loaded = await api.vehicles(); break;
        case 'trailers': loaded = await api.trailers(); break;
        case 'markets': loaded = await api.markets(); break;
        case 'siteCutoffs': loaded = await api.siteCutoffs(); break;
        case 'routeTimes': loaded = await api.routeTimes(); break;
        case 'customerContacts': loaded = await api.customerContacts(); break;
        case 'marketContacts': loaded = await api.marketContacts(); break;
        case 'fuelPrices': loaded = await api.fuelPrices(); break;
        case 'review': {
          const [reviewItems, aliasCandidates] = await Promise.all([
            api.masterReview(),
            api.aliasCandidates(),
          ]);
          loaded = [
            ...reviewItems.map(item => ({
              ...item,
              reviewKind: 'Master data',
            })),
            ...aliasCandidates.map(item => ({
              ...item,
              reviewKind: 'Site alias',
              summary: `${formatValue(item.aliasType)} alias: ${formatValue(item.alias)}`,
              sourceReference: item.alias,
            })),
          ];
          break;
        }
      }
      setRows(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Master Data.');
      setRows([]);
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
    void loadRows(activeTab);
  }, [activeTab, loadRows]);

  const filteredRows = useMemo(
    () => rows.filter(row => matchesSearch(row, query)),
    [rows, query],
  );

  const reviewCount = (counts?.aliasCandidates ?? 0) + (counts?.reviewItems ?? 0);

  const preparedRows = useMemo(
    () => preview
      ? Object.entries(preview.rows).reduce((total, [, count]) => total + count, 0)
      : 0,
    [preview],
  );

  async function openRow(row: MasterRecord) {
    setSelected(row);
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

  return (
    <section>
      <header className="page-header master-header">
        <div>
          <p className="eyebrow">Single operational register</p>
          <h1>Master Data</h1>
          <p>One place for every canonical record. Open a Site to see its full CRM profile, aliases, cut-offs, route timings and linked records together.</p>
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
                    placeholder={activeTab === 'sites' ? 'Site, code, address, postcode or alias' : `Search ${activeLabel.toLowerCase()}`}
                  />
                </label>
                <button
                  className="button secondary"
                  type="button"
                  disabled={loading}
                  onClick={() => void loadRows(activeTab)}
                >
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
                      {columns[activeTab].map(([, label]) => <th key={label}>{label}</th>)}
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
                        {columns[activeTab].map(([key]) => (
                          <td key={key}>{formatValue(row[key])}</td>
                        ))}
                        <td>
                          {activeTab === 'review'
                            ? <span className="status-chip review">Review</span>
                            : <span className={row.active === false ? 'status-chip archived' : 'status-chip live'}>
                                {row.active === false ? 'Archived' : 'Active'}
                              </span>}
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

      {selected && (
        <div
          className="crm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={activeTab === 'sites' ? 'Site CRM' : `${activeLabel} record`}
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setSelected(null);
              setSiteCrm(null);
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
                  selected.trailerNumber ??
                  selected.code ??
                  selected.route ??
                  selected.contactName ??
                  selected.key
                )}</h2>
                <p className="muted">
                  {activeTab === 'sites'
                    ? 'Everything connected to this physical location is kept together here.'
                    : 'Canonical V2 record.'}
                </p>
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setSelected(null);
                  setSiteCrm(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="crm-modal-body">
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
                        <div className="crm-field"><span>Latitude</span><strong>{formatValue(siteCrm.site.latitude)}</strong></div>
                        <div className="crm-field"><span>Longitude</span><strong>{formatValue(siteCrm.site.longitude)}</strong></div>
                      </div>
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
                        {!siteCrm.aliases.length && !siteCrm.externalIdentities.length && <span className="muted">No linked aliases or external identities.</span>}
                      </div>
                    </section>

                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div><p className="eyebrow">Planning rules</p><h3>Site cut-offs</h3></div>
                        <span className="crm-count">{siteCrm.cutoffs.length}</span>
                      </div>
                      <SmallTable
                        rows={siteCrm.cutoffs}
                        columns={[
                          ['plan', 'Plan'],
                          ['standardCutoff', 'Standard'],
                          ['extendedCutoff', 'Extended'],
                          ['temperature', 'Temp'],
                          ['palletType', 'Pallet'],
                          ['depotDeliveryDeadline', 'Deadline'],
                        ]}
                        empty="No cut-offs are attached to this Site."
                      />
                    </section>

                    <section className="crm-section">
                      <div className="crm-section-heading">
                        <div><p className="eyebrow">Route planning</p><h3>Related route timings</h3></div>
                        <span className="crm-count">{siteCrm.routeTimes.length}</span>
                      </div>
                      <SmallTable
                        rows={siteCrm.routeTimes}
                        columns={[
                          ['route', 'Route'],
                          ['palletType', 'Pallet'],
                          ['lastDespatchTime', 'Last despatch'],
                          ['plannedCollectFrom', 'Collect from'],
                          ['plannedCollectTo', 'Collect to'],
                          ['depotDeliveryDeadline', 'Deadline'],
                        ]}
                        empty="No route timings currently reference this Site."
                      />
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
                <section className="crm-section">
                  <p className="eyebrow">Record details</p>
                  <SimpleDetail row={selected} />
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
