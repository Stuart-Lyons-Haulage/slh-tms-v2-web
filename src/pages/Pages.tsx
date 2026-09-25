import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { MasterDataExportButton } from '../components/MasterDataExportButton';
import { SourceEmailEvidenceDrawer } from '../components/SourceEmailEvidenceDrawer';
import { MasterDataCsvImport } from './MasterDataCsvImport';
import * as XLSX from 'xlsx';
import { api, request, type Customer, type CustomerContact, type DiagnosticsTables, type Driver, type DriverAssignment, type FleetStatus, type Load, type LoadDispatch, type MarketContact, type ReturnLoadSuggestions, type Site, type StageBatchRequest, type StagedImport, type Telemetry, type Trailer, type TransportOrder, type Vehicle } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';
import { allocateRun, createRun, getRunDispatch, getRunRoute, listRuns, updateRunStatus, updateRunStops } from '../api/runs';

function State({ loading, error, empty, children }: { loading: boolean; error?: string; empty?: boolean; children: ReactNode }) { if (loading) return <div className="state">Loading operational data…</div>; if (error) return <div className="state error">{error}</div>; if (empty) return <div className="state">No records are available for this view.</div>; return <>{children}</>; }
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const stagingStatuses = ['PendingReview', 'Approved', 'Rejected', 'Promoted', 'Failed'];
const marketOrder = ['Western', 'Spit', 'Covent'];
const stagingStatus = (value: string | number | undefined) => typeof value === 'number' ? stagingStatuses[value] || String(value) : value || 'PendingReview';
const statusClass = (value: string | number | undefined) => stagingStatus(value).toLowerCase();
const localDateInput = () => { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; };
const addDays = (date: string, days: number) => { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const masterStagingTypes: readonly string[] = ['vehicle', 'driver', 'trailer', 'site', 'customer', 'customercontact', 'marketcontact', 'fuelprice', 'fuelcard', 'geofence'];

export function Dashboard() {
  const token = useAccessToken(); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const staging = useApi(useCallback(async () => api.staging(await token(), ''), [token])); const loads = useApi(useCallback(async () => listRuns(date, await token()), [date, token])); const orders = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token])); const fleet = useApi(useCallback(async () => api.fleetStatus(await token()), [token])); const etaApi = useApi(useCallback(async () => api.deliveryEtas(date, await token()), [date, token])); const assignments = useApi(useCallback(async () => api.driverAssignments(date, date, await token()), [date, token]));
  const pending = staging.data?.filter(item => stagingStatus(item.status) === 'PendingReview').length ?? 0;
  const deliveryRisks = [...(etaApi.data?.records || [])].sort((left, right) => ({ Late: 3, AtRisk: 2, Pending: 1, OnTrack: 0 })[right.risk] - ({ Late: 3, AtRisk: 2, Pending: 1, OnTrack: 0 })[left.risk]);
  const urgent = deliveryRisks.filter(item => item.risk === 'Late' || item.risk === 'AtRisk').length;
  return <section><div className="title-row"><div><p className="eyebrow">Operations</p><h1>Transport control dashboard</h1></div><label className="dashboard-date">Operating date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label></div><State loading={staging.loading || loads.loading || orders.loading} error={staging.error || loads.error || orders.error}>{[fleet.error, etaApi.error, assignments.error].filter(Boolean).length > 0 && <p className="notice inline-notice">Some live insight panels could not refresh yet; core orders and loads remain available.</p>}<div className="metrics"><Metric label="Staging reviews" value={String(pending)} detail="Awaiting decision" /><Metric label="Operational loads" value={String(loads.data?.length || 0)} detail={`Saved for ${date}`} /><Metric label="Fleet started" value={`${fleet.data?.readyCount || 0}/${fleet.data?.vehicleCount || 0}`} detail="Moving or engine started" /><Metric label="Delivery risks" value={String(urgent)} detail="Late or close to window" /></div><FleetRollout fleet={fleet.data} /><AssignmentSnapshot rows={assignments.data || []} date={date} /><div className="delivery-panel"><div><p className="eyebrow">Delivery-window control</p><h2>ETA against planned delivery windows</h2></div>{deliveryRisks.length ? <div className="delivery-list">{deliveryRisks.slice(0, 12).map(item => <article className={`delivery-risk ${item.risk === 'AtRisk' ? 'risk' : item.risk.toLowerCase()}`} key={`${item.loadId}-${item.stopId}`}><strong>{item.loadReference}</strong><span>{item.orderReference || item.customerCode || 'Unlinked stop'} · {item.stopName}</span><small>ETA {formatDate(item.etaUtc)} · Window ends {formatDate(item.deliveryWindowEndUtc)} · {item.vehicleRegistration || 'Vehicle not assigned'}</small><em>{item.risk === 'AtRisk' ? 'At risk' : item.risk === 'OnTrack' ? `On target to ${item.stopName}` : item.risk}</em><i className={`eta-source ${item.source.toLowerCase()}`}>{item.source} ETA</i></article>)}</div> : <p className="hint">No mapped delivery stops are available for this date. Save stops and delivery windows in the Planner.</p>}</div><div className="panel"><h2>Planner focus</h2><p>Plan today’s work, allocate the fleet, set route points and calculate ETAs from the Planner.</p><a href="/">Open planner →</a></div></State></section>;
}
function FleetRollout({ fleet }: { fleet?: FleetStatus }) {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>();
  const conditionOrder = { Moving: 0, Started: 0, Parked: 2, Stationary: 2, SignedOn: 1, Stale: 4, NotSignedOn: 5 };
  const dueTime = (value?: string) => value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
  const vehicles = [...(fleet?.vehicles || [])].sort((left, right) => dueTime(left.plannedDutyUtc) - dueTime(right.plannedDutyUtc) || conditionOrder[left.condition] - conditionOrder[right.condition] || left.registration.localeCompare(right.registration));
  const selected = vehicles.find(vehicle => vehicle.vehicleId === selectedVehicleId) || vehicles.find(vehicle => vehicle.latitude != null && vehicle.longitude != null);
  const selectedMapUrl = selected?.latitude != null && selected.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${selected.latitude},${selected.longitude}` : undefined;
  return <div className="rollout-panel"><div className="rollout-heading"><div><p className="eyebrow">Live vehicle status</p><h2>Click a vehicle to view location</h2></div><span>{fleet?.attentionCount || 0} to watch</span></div>{selected && <div className="vehicle-detail-panel"><div><strong>{selected.registration}</strong><span>{selected.driverName ? 'Driver: ' + selected.driverName + ' · ' : ''}{fleetConditionLabel(selected.condition)} · {selected.trackingIdentifier || selected.fleetNumber || 'RoadTech match pending'}</span><small>{selected.lastEventTimeUtc ? 'Last update ' + formatDate(selected.lastEventTimeUtc) + ' · ' + (selected.speedKph ?? 0) + ' km/h' : 'No live DOT point matched yet'}</small>{selected.fleetioStatus && <small className={'fleetio-chip ' + fleetioStatusClass(selected.fleetioStatus)}>Fleetio: {selected.fleetioStatus}{selected.fleetioName ? ' · ' + selected.fleetioName : ''}</small>}</div>{selectedMapUrl ? <a className="vehicle-map-link" href={selectedMapUrl} target="_blank" rel="noreferrer">Open map location →</a> : <span className="hint">No latitude/longitude returned for this vehicle yet.</span>}</div>}{vehicles.length ? <div className="rollout-grid">{vehicles.map(vehicle => {
    const hasMap = vehicle.latitude != null && vehicle.longitude != null;
    return <button type="button" className={`rollout-card clickable ${vehicleStatusClass(vehicle)} ${selectedVehicleId === vehicle.vehicleId ? 'selected' : ''}`} key={vehicle.vehicleId} onClick={() => setSelectedVehicleId(vehicle.vehicleId)}><div className="condition-dot" /><div><strong>{vehicle.registration}</strong><small>{vehicle.fleetNumber || vehicle.trackingIdentifier || 'Fleet vehicle'}</small></div><div><b>{fleetConditionLabel(vehicle.condition)}</b>{vehicle.driverName && <small className="rollout-driver">Driver: {vehicle.driverName}</small>}<small>{vehicle.plannedDutyUtc ? `Due ${formatDate(vehicle.plannedDutyUtc)}` : hasMap ? 'Live DOT point available' : 'No planned sign-on time yet'}</small><small>{vehicle.lastEventTimeUtc ? `${vehicle.speedKph ?? 0} km/h · last update ${formatDate(vehicle.lastEventTimeUtc)}` : 'Awaiting RoadTech match today'}</small>{vehicle.loadReference && <small className="rollout-assignment">{vehicle.loadReference} · {vehicle.driverName || 'Driver not allocated'} · {vehicle.loadStatus}</small>}{vehicle.fleetioStatus && <small className={`fleetio-chip ${fleetioStatusClass(vehicle.fleetioStatus)}`}>Fleetio: {vehicle.fleetioStatus}</small>}</div></button>;
  })}</div> : <p className="hint">No active vehicles are held in Master Data yet.</p>}</div>;
}
function AssignmentSnapshot({ rows, date }: { rows: DriverAssignment[]; date: string }) { const allocated = rows.filter(item => item.driver && item.vehicle); return <div className="assignment-snapshot"><div className="rollout-heading"><div><p className="eyebrow">Driver history</p><h2>Who was on what</h2></div><a href={`/driver-assignments?from=${date}&to=${date}`}>Open full history →</a></div>{rows.length ? <div className="assignment-snapshot-grid">{rows.slice(0, 10).map(item => <article key={item.loadId}><strong>{item.loadReference}</strong><span>{item.driver?.displayName || 'No driver assigned'} · {item.vehicle?.registration || 'No vehicle'}</span><small>{item.finalStop || 'Final stop not mapped'} · {item.stopCount} stop{item.stopCount === 1 ? '' : 's'}</small></article>)}</div> : <p className="hint">No driver assignments are saved for {date}. Once loads are planned and allocated, they remain available here historically.</p>}<p className="hint">{allocated.length}/{rows.length || 0} loads have both driver and vehicle recorded for this date.</p></div>; }
function fleetConditionLabel(condition: FleetStatus['vehicles'][number]['condition']) { return ({ Moving: 'Moving', Started: 'Engine started', Parked: 'Parked · engine off', Stationary: 'Parked · engine off', SignedOn: 'Signed on', Stale: 'Tracking stale', NotSignedOn: 'Not signed on' })[condition]; }
function vehicleStatusClass(vehicle: FleetStatus['vehicles'][number]) { if (vehicle.condition === 'Moving' || vehicle.condition === 'Started' || vehicle.condition === 'SignedOn') return 'signedon'; if (vehicle.condition === 'Parked' || vehicle.condition === 'Stationary') return 'parked'; if (vehicle.plannedDutyUtc && new Date(vehicle.plannedDutyUtc).getTime() - Date.now() <= 30 * 60 * 1000) return 'due-soon'; return vehicle.condition.toLowerCase(); }
function fleetioStatusClass(status?: string) { const value = (status || '').toLowerCase(); if (value.includes('out') || value.includes('vor') || value.includes('down') || value.includes('repair')) return 'fleetio-bad'; if (value.includes('service') || value.includes('maintenance') || value.includes('issue')) return 'fleetio-watch'; return 'fleetio-good'; }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }

type ImportRow = Record<string, string>;
const expectedColumns = ['poNumber', 'customerCode', 'collectionDate', 'pallets'];
const marketColumns = ['deliveryWindowStartUtc', 'deliveryWindowEndUtc', 'sellerName', 'marketName', 'stallNumber', 'averagePalletWeightKg', 'estimatedWeightKg', 'driverInstructions', 'mapLink'];
type SheetRow = Record<string, string | number | boolean | Date | undefined>;
function parseCsv(text: string): ImportRow[] { const [header, ...lines] = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/); if (!header) return []; const fields = header.split(',').map(value => value.trim()); return lines.filter(Boolean).map(line => Object.fromEntries(fields.map((field, index) => [field, line.split(',')[index]?.trim() || '']))); }
function validateImportRows(rows: ImportRow[]) { const seen = new Set<string>(); return rows.flatMap((row, index) => { const missing = expectedColumns.filter(column => !row[column]?.trim()); const dates = [row.collectionDate, row.deliveryDate].filter(Boolean).some(value => !/^\d{4}-\d{2}-\d{2}$/.test(value)); const pallets = Number(row.pallets || 1); const key = `${row.poNumber}|${row.customerCode}|${row.collectionDate}`.toLowerCase(); const duplicate = seen.has(key); seen.add(key); const invalidMap = Boolean(row.mapLink && !/^https?:\/\//i.test(row.mapLink)); const issues = [missing.length ? `missing ${missing.join(', ')}` : '', dates ? 'dates must use YYYY-MM-DD' : '', !Number.isFinite(pallets) || pallets <= 0 ? 'pallets must be greater than zero' : '', duplicate ? 'duplicate order row' : '', invalidMap ? 'map link must start with http:// or https://' : ''].filter(Boolean); return issues.length ? [`Row ${index + 2}: ${issues.join('; ')}.`] : []; }); }
const normaliseHeader = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
type OrderField = 'poNumber' | 'customerCode' | 'collectionDate' | 'deliveryDate' | 'pallets' | 'deliveryWindowStartUtc' | 'deliveryWindowEndUtc' | 'sellerName' | 'marketName' | 'stallNumber' | 'averagePalletWeightKg' | 'estimatedWeightKg' | 'driverInstructions' | 'mapLink';
const orderAliases: Record<OrderField, string[]> = {
  poNumber: ['ponumber', 'po', 'poref', 'purchaseorder', 'ordernumber', 'orderno', 'orderref', 'reference', 'ref', 'load', 'loadreference', 'bookingref', 'bookingreference', 'du', 'label', 'depotref', 'runref'],
  customerCode: ['customercode', 'customer', 'customername', 'account', 'accountcode', 'deliverylocation', 'site', 'sitename', 'destination', 'depot', 'deliverystop', 'deliveryaddress', 'location', 'consignee', 'receiver', 'deliveries'],
  collectionDate: ['collectiondate', 'collectdate', 'collection', 'pickupdate', 'pickupdate', 'loadingdate', 'despatchdate', 'dispatchdate', 'planneddate', 'date', 'runoutdate', 'exfarm', 'fromdate'],
  deliveryDate: ['deliverydate', 'deliverdate', 'delivery', 'deliverby', 'planneddate', 'date', 'duedate', 'marketdate'],
  pallets: ['pallets', 'pallet', 'palletsdelivered', 'palletqty', 'quantity', 'qty', 'spaces', 'trays', 'dollies', 'stacks', 'plt', 'plts'],
  deliveryWindowStartUtc: ['deliverywindowstartutc', 'windowstart', 'from', 'deliveryfrom', 'slotstart'],
  deliveryWindowEndUtc: ['deliverywindowendutc', 'windowend', 'to', 'deliveryto', 'slotend'],
  sellerName: ['sellername', 'seller', 'salesman', 'salesperson', 'supplier', 'grower', 'vendor', 'sender', 'haulier', 'farm', 'source'],
  marketName: ['marketname', 'market', 'wholesalemarket', 'marketdestination'],
  stallNumber: ['stallnumber', 'stall', 'stand', 'standnumber', 'standlocation', 'location', 'unit', 'arch'],
  averagePalletWeightKg: ['averagepalletweightkg', 'avgpalletweight', 'averageweight', 'avgweight', 'palletweight', 'weightperpallet'],
  estimatedWeightKg: ['estimatedweightkg', 'totalweight', 'weightkg', 'grossweight', 'estimatedweight', 'weight', 'kgs', 'kg'],
  driverInstructions: ['driverinstructions', 'instructions', 'notes', 'deliverynotes', 'collectionnotes', 'specialinstructions', 'temperature', 'temp', 'product', 'goods'],
  mapLink: ['maplink', 'map', 'maps', 'googlemaps', 'what3words', 'what3word']
};
function orderDate(value: unknown) { if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10); if (typeof value === 'number' && value > 25000 && value < 90000) return new Date(Math.round((value - 25569) * 86400 * 1000)).toISOString().slice(0, 10); const text = String(value || '').trim(); if (!text) return ''; if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10); const uk = text.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/); if (uk) return `${uk[3] ? (uk[3].length === 2 ? `20${uk[3]}` : uk[3]) : new Date().getFullYear()}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`; const parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10); }
function orderCell(value: unknown) { return value instanceof Date ? orderDate(value) : String(value ?? '').trim(); }
function firstMapped(row: unknown[], headers: string[], field: OrderField) { const index = headers.findIndex(header => orderAliases[field].some(alias => header === alias || header.includes(alias) || alias.includes(header))); return index >= 0 ? orderCell(row[index]) : ''; }
function inferMarket(value: string) { const normalised = normaliseHeader(value); if (normalised.includes('covent')) return 'Covent'; if (normalised.includes('spit') || normalised.includes('spital')) return 'Spit'; if (normalised.includes('western')) return 'Western'; return ''; }
function cleanOrderRow(row: ImportRow, index: number, source: string): ImportRow | undefined {
  const marketName = row.marketName || inferMarket(`${source} ${row.customerCode} ${row.driverInstructions}`);
  const collectionDate = orderDate(row.collectionDate) || orderDate(row.deliveryDate) || new Date().toISOString().slice(0, 10);
  const deliveryDate = orderDate(row.deliveryDate) || collectionDate;
  const customerCode = row.customerCode || marketName || row.sellerName || row.senderName || 'MARKET';
  const pallets = row.pallets || '1';
  const poNumber = row.poNumber || `${normaliseHeader(customerCode || source).toUpperCase().slice(0, 18) || 'ORDER'}-${collectionDate.replaceAll('-', '')}-${index + 1}`;
  if (!customerCode || !collectionDate) return undefined;
  const weight = row.estimatedWeightKg || (Number(pallets) > 0 && Number(row.averagePalletWeightKg) > 0 ? String(Math.round(Number(pallets) * Number(row.averagePalletWeightKg))) : '');
  const driverInstructions = [row.senderName ? `Sender: ${row.senderName}` : '', weight ? `Weight: ${weight} kg` : '', row.driverInstructions].filter(Boolean).join(' · ');
  return { ...row, poNumber, customerCode, collectionDate, deliveryDate, pallets, marketName, estimatedWeightKg: weight, driverInstructions, importSource: row.importSource || source };
}
function parsePositionOrderRows(rows: unknown[][], sheetName: string): ImportRow[] {
  const marketName = inferMarket(sheetName);
  if (!marketName) return [];
  return rows.flatMap((row, index): ImportRow[] => {
    const cells = row.map(orderCell).filter(Boolean);
    if (cells.length < 3 || cells.some(cell => ['total', 'totals', 'salesman', 'salesmen', 'seller', 'sender'].includes(normaliseHeader(cell)))) return [];
    const date = cells.map(orderDate).find(value => /^\d{4}-\d{2}-\d{2}$/.test(value)) || '';
    const pallets = cells.find(value => /^\d+(\.\d+)?$/.test(value)) || '1';
    const sellerName = cells.find(value => /[a-z]/i.test(value) && !/^https?:/i.test(value) && !orderDate(value)) || '';
    const stallNumber = cells.find(value => /\b(stall|stand|arch|unit)\b/i.test(value)) || '';
    const mapLink = cells.find(value => /^https?:\/\//i.test(value)) || '';
    const notes = cells.filter(value => value !== sellerName && value !== pallets && value !== date && value !== stallNumber && value !== mapLink).join(' · ');
    const cleaned = cleanOrderRow({ poNumber: '', customerCode: marketName, collectionDate: date, deliveryDate: date, pallets, sellerName, marketName, stallNumber, mapLink, driverInstructions: notes, importSource: sheetName }, index, sheetName);
    return cleaned ? [cleaned] : [];
  });
}
function parseOrderWorkbook(workbook: XLSX.WorkBook): ImportRow[] {
  return workbook.SheetNames.flatMap(sheetName => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false, blankrows: false });
    const headerIndex = rows.findIndex(row => row.map(normaliseHeader).filter(header => Object.values(orderAliases).some(aliases => aliases.some(alias => header === alias || header.includes(alias) || alias.includes(header)))).length >= 2);
    if (headerIndex < 0) return parsePositionOrderRows(rows, sheetName);
    const headers = rows[headerIndex].map(normaliseHeader);
    const lowerSheet = sheetName.toLowerCase();
    const direction = lowerSheet.includes('inbound') || lowerSheet.includes('natures') ? 'Inbound' : lowerSheet.includes('outbound') ? 'Outbound' : 'Order';
    return rows.slice(headerIndex + 1).map((row, index): ImportRow => {
      const customer = firstMapped(row, headers, 'customerCode');
      const collectionDate = orderDate(firstMapped(row, headers, 'collectionDate'));
      const deliveryDate = orderDate(firstMapped(row, headers, 'deliveryDate')) || collectionDate;
      const deliveryLocation = customer || firstMapped(row, headers, 'marketName');
      const senderName = firstMapped(row, headers, 'sellerName') && headers.some(header => header === 'sender') ? firstMapped(row, headers, 'sellerName') : '';
      return cleanOrderRow({
        poNumber: firstMapped(row, headers, 'poNumber') || `${direction.toUpperCase()}-${sheetName.replace(/[^a-z0-9]/gi, '').slice(0, 14)}-${index + 1}`,
        customerCode: customer || (direction === 'Inbound' ? 'NATURES-WAY' : deliveryLocation),
        collectionDate,
        deliveryDate,
        pallets: firstMapped(row, headers, 'pallets'),
        deliveryWindowStartUtc: firstMapped(row, headers, 'deliveryWindowStartUtc'),
        deliveryWindowEndUtc: firstMapped(row, headers, 'deliveryWindowEndUtc'),
        sellerName: senderName ? '' : firstMapped(row, headers, 'sellerName'),
        senderName,
        marketName: firstMapped(row, headers, 'marketName') || inferMarket(sheetName) || deliveryLocation,
        stallNumber: firstMapped(row, headers, 'stallNumber'),
        averagePalletWeightKg: firstMapped(row, headers, 'averagePalletWeightKg'),
        estimatedWeightKg: firstMapped(row, headers, 'estimatedWeightKg') || (Number(firstMapped(row, headers, 'pallets')) > 0 && Number(firstMapped(row, headers, 'averagePalletWeightKg')) > 0 ? String(Math.round(Number(firstMapped(row, headers, 'pallets')) * Number(firstMapped(row, headers, 'averagePalletWeightKg')))) : ''),
        driverInstructions: [direction !== 'Order' ? `${direction} planning sheet` : '', firstMapped(row, headers, 'estimatedWeightKg') || firstMapped(row, headers, 'averagePalletWeightKg') ? `Weight: ${firstMapped(row, headers, 'estimatedWeightKg') || 'calculated'} kg` : '', firstMapped(row, headers, 'driverInstructions')].filter(Boolean).join(' · '),
        mapLink: firstMapped(row, headers, 'mapLink'),
        importSource: sheetName,
        orderDirection: direction
      }, index, sheetName) || {};
    }).filter(row => Object.values(row).some(Boolean));
  });
}

function parseEmailOrders(input: string): ImportRow[] {
  const textValue = input.replace(/\r/g, '').replace(/\u00a0/g, ' ');
  const subjectRef = textValue.match(/(?:booking ref|order|po ref|po)[:\s#-]+([a-z0-9-]+)/i)?.[1] || `EMAIL-${Date.now().toString().slice(-6)}`;
  const collectionDate = parseEmailDate(textValue.match(/Collection:[^\n]*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/i)?.[1]) || new Date().toISOString().slice(0, 10);
  const deliveryDate = parseEmailDate(textValue.match(/Delivery[^\n]*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/i)?.[1]) || collectionDate;
  const marketName = /covent/i.test(textValue) ? 'Covent Garden' : /spital/i.test(textValue) ? 'Spitalfields' : /western/i.test(textValue) ? 'Western International' : '';
  const collectionLines = collectFollowingLines(textValue, /Collection:/i, 5);
  const rows: ImportRow[] = [];
  const rowPattern = /\*\*?([^*\n-][^\n]*?)\s*-\s*(\d+)\s+pallets?,\s*([\d,.]+)\s*kg\*\*?/gi;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(textValue))) {
    const after = textValue.slice(match.index + match[0].length);
    const address = after.split(/\n\s*\n/)[0].split('\n').map(line => line.trim()).filter(Boolean).slice(0, 5).join(', ');
    rows.push({ poNumber: `${subjectRef}-${rows.length + 1}`, customerCode: marketName || match[1].trim(), collectionDate, deliveryDate, pallets: match[2], estimatedWeightKg: match[3].replace(/,/g, ''), sellerName: match[1].trim(), marketName, stallNumber: '', driverInstructions: [collectionLines ? `Collect: ${collectionLines}` : '', address ? `Deliver: ${address}` : '', 'Imported from email body'].filter(Boolean).join(' · '), mapLink: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '', importSource: 'Email body' });
  }
  if (rows.length) return rows;
  const simple = textValue.match(/(?:Collection from|collection)\s+(.+?)\s+to\s+(.+?)(?:\n|$)/i);
  return simple ? [{ poNumber: subjectRef, customerCode: simple[2].trim(), collectionDate, deliveryDate, pallets: textValue.match(/(\d+)\s+pallet/i)?.[1] || '1', sellerName: simple[1].trim(), marketName, driverInstructions: `Collect: ${simple[1].trim()} · Deliver: ${simple[2].trim()} · Imported from email body`, mapLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(simple[2].trim())}`, importSource: 'Email body' }] : [];
}
function collectFollowingLines(value: string, marker: RegExp, maxLines: number) {
  const lines = value.split('\n');
  const index = lines.findIndex(line => marker.test(line));
  if (index < 0) return '';
  return lines.slice(index + 1, index + 1 + maxLines).map(line => line.trim()).filter(line => line && !/^delivery/i.test(line)).join(', ');
}
function parseEmailDate(value?: string) {
  const textValue = value?.replace(/(st|nd|rd|th)/gi, '').trim();
  if (!textValue) return '';
  const withYear = /\d{4}/.test(textValue) ? textValue : `${textValue} ${new Date().getFullYear()}`;
  const parsed = new Date(withYear.replace(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/, (_, day, month, year) => `${year ? (String(year).length === 2 ? `20${year}` : year) : new Date().getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}
export function Orders() {
  const token = useAccessToken();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [emailText, setEmailText] = useState('');
  function downloadTemplate() { const workbook = XLSX.utils.book_new(); const worksheet = XLSX.utils.json_to_sheet([{ poNumber: 'SLH-10001', customerCode: 'CUSTOMER-001', collectionDate: '2026-08-12', deliveryDate: '2026-08-13', deliveryWindowStartUtc: '2026-08-13T08:00:00+01:00', deliveryWindowEndUtc: '2026-08-13T10:00:00+01:00', pallets: '8', averagePalletWeightKg: '750', estimatedWeightKg: '6000', sellerName: 'Example seller', marketName: 'Example market', stallNumber: 'A12', driverInstructions: 'Gate access from 05:30', mapLink: 'https://maps.google.com/?q=53.4808,-2.2426' }]); worksheet['!cols'] = [...expectedColumns, ...marketColumns].map(column => ({ wch: Math.max(column.length + 3, 18) })); XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders'); XLSX.writeFile(workbook, 'slh-order-import-template.xlsx'); }
  function acceptRows(parsed: ImportRow[]) { const cleaned = parsed.map((row, index) => cleanOrderRow(row, index, row.importSource || 'Uploaded order file')).filter((row): row is ImportRow => Boolean(row)); if (!cleaned.length) { setRows([]); setMessage('No usable orders were found. Check the sheet has a date plus customer, market, seller or delivery information.'); return; } const validationIssues = validateImportRows(cleaned); setRows(validationIssues.length ? [] : cleaned); setIssues(validationIssues); setMessage(validationIssues.length ? undefined : `${cleaned.length} order${cleaned.length === 1 ? '' : 's'} ready to submit.`); }
  async function selectFile(file?: File) { if (!file) return; setMessage(undefined); setIssues([]); try { const extension = file.name.split('.').pop()?.toLowerCase(); let parsed: ImportRow[] = []; if (extension === 'csv') parsed = parseCsv(await file.text()); else if (['xlsx', 'xls', 'xlsm'].includes(extension || '')) { const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); parsed = parseOrderWorkbook(workbook); if (!parsed.length) { const sheet = workbook.Sheets[workbook.SheetNames[0]]; parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), orderCell(value)]))); } } acceptRows(parsed); } catch { setRows([]); setMessage('The workbook could not be read. Use the first worksheet with a header row.'); } }
  function parseEmail() { setMessage(undefined); setIssues([]); const parsed = parseEmailOrders(emailText); acceptRows(parsed); }
  async function submit() { setSubmitting(true); setMessage(undefined); try { const accessToken = await token(); const results = await Promise.all(rows.map((row, index) => api.stageOrder(row, `web-import:${row.poNumber || 'row'}:${row.customerCode || 'unknown'}:${row.collectionDate || index}`, accessToken))); setMessage(`${results.length} order${results.length === 1 ? '' : 's'} submitted to staging for review.`); setRows([]); setEmailText(''); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Order import failed.'); } finally { setSubmitting(false); } }
  return <section><p className="eyebrow">Order intake</p><h1>New order</h1><QuickOrderForm /><div className="panel import-panel"><h2>Import Excel or CSV</h2><p>Upload customer workbooks, market tabs or CSV batches. The portal now recognises common PO, customer, depot, market, seller, sender, stall, pallet and date headings before staging orders.</p><button type="button" onClick={downloadTemplate}>Download Excel template</button><input type="file" accept=".xlsx,.xls,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={event => void selectFile(event.target.files?.[0])} /><p className="hint">Best columns are <code>{expectedColumns.join(', ')}</code>, but Barfoots/APS/market-style sheets are accepted if they include enough date, market/customer and quantity detail.</p>{issues.length > 0 && <div className="import-issues"><strong>Correct the following before import</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}{rows.length > 0 && <><p><strong>{rows.length}</strong> checked rows ready to submit.</p><button className="primary" onClick={() => void submit()} disabled={submitting}>{submitting ? 'Submitting…' : `Submit ${rows.length} order${rows.length === 1 ? '' : 's'} for review`}</button></>}{message && <p className="notice inline-notice">{message}</p>}</div><div className="panel import-panel"><h2>Email body intake</h2><p>Paste the body of a market/order email here. It recognises APS Covent-style lines, pallet counts, weights and delivery addresses, then stages each stop for review.</p><textarea className="email-import-box" value={emailText} onChange={event => setEmailText(event.target.value)} placeholder="Paste the customer email body here…" /><button type="button" onClick={parseEmail} disabled={!emailText.trim()}>Parse email body</button><p className="hint">PDF delivery notes stay attached in Outlook; the portal stages the order data from the email text. Power Automate can post the same normalised rows later.</p></div></section>;
}
function QuickOrderForm() {
  const token = useAccessToken();
  const customers = useApi(useCallback(async () => api.customers(await token()), [token]));
  const sites = useApi(useCallback(async () => api.sites(await token()), [token]));
  const marketContacts = useApi(useCallback(async () => api.marketContacts(await token()), [token]));
  const customerContacts = useApi(useCallback(async () => api.customerContacts(await token()), [token]));
  const [orderKind, setOrderKind] = useState<'market' | 'customer'>('market');
  const [form, setForm] = useState({ poNumber: '', customerCode: '', collectionDate: new Date().toISOString().slice(0, 10), deliveryDate: '', deliveryWindowStartUtc: '', deliveryWindowEndUtc: '', pallets: '', averagePalletWeightKg: '', estimatedWeightKg: '', sellerName: '', marketName: '', stallNumber: '', senderName: '', driverInstructions: '', mapLink: '' });
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const markets = useMemo(() => {
    const imported = [...new Set((marketContacts.data || []).filter(contact => contact.active && contact.market !== 'Sender').map(contact => contact.market).filter(Boolean))];
    return [...marketOrder.filter(market => imported.includes(market)), ...imported.filter(market => !marketOrder.includes(market)).sort()];
  }, [marketContacts.data]);
  const sellers = useMemo(() => (marketContacts.data || []).filter(contact => contact.active && (!form.marketName || contact.market === form.marketName)).sort((left, right) => left.name.localeCompare(right.name)), [marketContacts.data, form.marketName]);
  const senders = useMemo(() => {
    const options = [
      ...(marketContacts.data || []).filter(contact => contact.active && contact.market === 'Sender').map(contact => ({ id: contact.id, name: contact.name, standOrLocation: contact.standOrLocation })),
      ...(marketContacts.data || []).filter(contact => contact.active && contact.sender).map(contact => ({ id: `sender:${contact.sender}`, name: contact.sender || '', standOrLocation: contact.market }))
    ].filter(option => option.name);
    return options.filter((option, index, all) => all.findIndex(other => other.name.toLowerCase() === option.name.toLowerCase()) === index).sort((left, right) => left.name.localeCompare(right.name));
  }, [marketContacts.data]);
  const customerOptions = useMemo(() => [...(customers.data || []).filter(customer => customer.active).map(customer => ({ code: customer.code, label: `${customer.code} · ${customer.name}` })), ...(customerContacts.data || []).filter(contact => contact.active).map(contact => ({ code: contact.customerCode, label: `${contact.customerCode} · ${contact.name}` }))].filter((item, index, all) => all.findIndex(other => other.code === item.code) === index).sort((left, right) => left.label.localeCompare(right.label)), [customers.data, customerContacts.data]);
  const update = (name: keyof typeof form, value: string) => setForm(current => ({ ...current, [name]: value }));
  function chooseCustomer(customerCode: string) {
    const site = (sites.data || []).find(item => item.externalCode === customerCode || item.name === customerCode);
    setForm(current => ({ ...current, customerCode, marketName: '', sellerName: '', stallNumber: '', senderName: '', mapLink: site?.mapLink || current.mapLink, driverInstructions: site?.collectionInstructions || current.driverInstructions }));
  }
  function chooseMarket(marketName: string) {
    setForm(current => ({ ...current, marketName, customerCode: marketName || current.customerCode, sellerName: '', stallNumber: '' }));
  }
  function chooseSeller(name: string) {
    const seller = sellers.find(contact => contact.name === name);
    setForm(current => ({ ...current, sellerName: name, stallNumber: seller?.standOrLocation || current.stallNumber, senderName: seller?.sender || current.senderName, customerCode: current.marketName || current.customerCode || 'MARKET' }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const calculatedWeight = form.estimatedWeightKg || (Number(form.pallets) > 0 && Number(form.averagePalletWeightKg) > 0 ? String(Math.round(Number(form.pallets) * Number(form.averagePalletWeightKg))) : '');
      const payload = { ...form, customerCode: form.customerCode || form.marketName || 'MARKET', estimatedWeightKg: calculatedWeight, driverInstructions: [calculatedWeight ? `Weight: ${calculatedWeight} kg` : '', form.senderName ? `Sender: ${form.senderName}` : '', form.driverInstructions].filter(Boolean).join(' · '), deliveryWindowStartUtc: form.deliveryWindowStartUtc ? new Date(form.deliveryWindowStartUtc).toISOString() : '', deliveryWindowEndUtc: form.deliveryWindowEndUtc ? new Date(form.deliveryWindowEndUtc).toISOString() : '' };
      await api.stageOrder(payload, `web-manual:${form.poNumber}:${form.collectionDate}`, await token());
      setMessage('Order sent to staging review.');
      setForm(current => ({ ...current, poNumber: '', customerCode: '', deliveryDate: '', deliveryWindowStartUtc: '', deliveryWindowEndUtc: '', pallets: '', averagePalletWeightKg: '', estimatedWeightKg: '', sellerName: '', marketName: '', stallNumber: '', senderName: '', driverInstructions: '', mapLink: '' }));
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Order could not be submitted.'); }
    finally { setSaving(false); }
  }
  return <form className="quick-order" onSubmit={event => void submit(event)}><div><p className="eyebrow">Quick entry</p><h2>Plan a market or customer order</h2><p className="hint">Master data now drives the dropdowns, so market orders carry seller, salesman, sender, stall and map details into driver messages.</p></div><div className="field-grid"><label>Order type<select value={orderKind} onChange={event => { const value = event.target.value as 'market' | 'customer'; setOrderKind(value); setForm(current => ({ ...current, customerCode: '', marketName: '', sellerName: '', stallNumber: '', senderName: '' })); }}><option value="market">Market order</option><option value="customer">Customer / site order</option></select></label><label>Order / PO<input required value={form.poNumber} onChange={event => update('poNumber', event.target.value)} /></label>{orderKind === 'market' ? <><label>Market<select required value={form.marketName} onChange={event => chooseMarket(event.target.value)}><option value="">Select market…</option>{markets.map(market => <option key={market} value={market}>{market}</option>)}</select></label><label>Seller<select required value={form.sellerName} onChange={event => chooseSeller(event.target.value)} disabled={!form.marketName && markets.length > 0}><option value="">Select seller…</option>{sellers.map(seller => <option key={seller.id} value={seller.name}>{seller.name}{seller.salesman ? ` · Salesman: ${seller.salesman}` : ''}{seller.standOrLocation ? ` · ${seller.standOrLocation}` : ''}{seller.sender ? ` · Sender: ${seller.sender}` : ''}</option>)}</select></label><label>Sender<select value={form.senderName} onChange={event => update('senderName', event.target.value)}><option value="">Select sender…</option>{senders.map(sender => <option key={sender.id} value={sender.name}>{sender.name}{sender.standOrLocation ? ` · ${sender.standOrLocation}` : ''}</option>)}</select></label><label>Stall number<input value={form.stallNumber} onChange={event => update('stallNumber', event.target.value)} placeholder="Auto from seller" /></label></> : <><label>Customer<select required value={form.customerCode} onChange={event => chooseCustomer(event.target.value)}><option value="">Select customer…</option>{customerOptions.map(customer => <option key={customer.code} value={customer.code}>{customer.label}</option>)}</select></label><label>Site<select value={form.mapLink} onChange={event => { const site = sites.data?.find(item => item.id === event.target.value); if (site) setForm(current => ({ ...current, customerCode: current.customerCode || site.externalCode, mapLink: site.mapLink || '', driverInstructions: site.collectionInstructions || current.driverInstructions })); }}><option value="">Optional site/map…</option>{(sites.data || []).filter(site => site.active).map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label></>}<label>Collection date<input required type="date" value={form.collectionDate} onChange={event => update('collectionDate', event.target.value)} /></label><label>Delivery date<input type="date" value={form.deliveryDate} onChange={event => update('deliveryDate', event.target.value)} /></label><label>Delivery window start<input type="datetime-local" value={form.deliveryWindowStartUtc} onChange={event => update('deliveryWindowStartUtc', event.target.value)} /></label><label>Delivery window end<input type="datetime-local" value={form.deliveryWindowEndUtc} onChange={event => update('deliveryWindowEndUtc', event.target.value)} /></label><label>Pallets<input inputMode="numeric" value={form.pallets} onChange={event => update('pallets', event.target.value)} /></label><label>Avg weight kg<input inputMode="decimal" value={form.averagePalletWeightKg} onChange={event => update('averagePalletWeightKg', event.target.value)} /></label><label>Estimated weight kg<input inputMode="decimal" value={form.estimatedWeightKg} onChange={event => update('estimatedWeightKg', event.target.value)} placeholder="Auto if blank" /></label><label className="wide">Map link<input type="url" value={form.mapLink} onChange={event => update('mapLink', event.target.value)} placeholder="https://maps.google.com/..." /></label><label className="wide">Driver instructions<textarea value={form.driverInstructions} onChange={event => update('driverInstructions', event.target.value)} placeholder="Collection point, access notes, goods handling…" /></label></div>{(marketContacts.error || customers.error || sites.error) && <p className="notice inline-notice">Some dropdown data could not load yet. Manual fields still save into staging once API access is available.</p>}<DriverMessagePreview form={form} /><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Send for review'}</button>{message && <p className="hint">{message}</p>}</form>;
}
function DriverMessagePreview({ form }: { form: Record<string, string> }) { const lines = [`SLH run ${form.poNumber || '—'}`, form.marketName ? `${form.marketName}${form.stallNumber ? ` · Stall ${form.stallNumber}` : ''}` : form.customerCode || 'Customer to confirm', form.sellerName ? `Seller: ${form.sellerName}` : '', form.senderName ? `Sender: ${form.senderName}` : '', form.collectionDate ? `Collection: ${form.collectionDate}` : '', form.estimatedWeightKg || (Number(form.pallets) > 0 && Number(form.averagePalletWeightKg) > 0) ? `Weight: ${form.estimatedWeightKg || Math.round(Number(form.pallets) * Number(form.averagePalletWeightKg))} kg` : '', form.driverInstructions ? `Notes: ${form.driverInstructions}` : '', form.mapLink ? `Map: ${form.mapLink}` : ''].filter(Boolean); return <aside className="driver-message"><p className="eyebrow">Driver message preview</p><strong>Planner review required before send</strong><pre>{lines.join('\n')}</pre></aside>; }

type PlanningOrder = { id: string; poNumber: string; customerCode: string; collectionDate: string; deliveryDate: string; pallets: string; status: string; marketName?: string; sellerName?: string; stallNumber?: string; driverInstructions?: string; mapLink?: string };
function planningOrders(items?: TransportOrder[]): PlanningOrder[] { return (items || []).filter(item => item.status !== 'Cancelled').map(item => ({ id: item.id, poNumber: item.reference, customerCode: item.customerCode, collectionDate: item.collectionDate, deliveryDate: item.deliveryDate || '—', pallets: item.pallets?.toString() || '—', status: item.status, marketName: item.marketName, sellerName: item.sellerName, stallNumber: item.stallNumber, driverInstructions: item.driverInstructions, mapLink: item.mapLink })).sort((left, right) => left.collectionDate.localeCompare(right.collectionDate)); }

export function PlanningBoard() { const token = useAccessToken(); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const ordersApi = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token])); const [selected, setSelected] = useState<string[]>([]); const [saving, setSaving] = useState(false); const [message, setMessage] = useState<string>(); const loads = useApi(useCallback(async () => listRuns(date, await token()), [date, token])); const returns = useApi(useCallback(async () => api.returnLoadSuggestions(date, await token()), [date, token])); const today = planningOrders(ordersApi.data); const planned = loads.data || []; const selectedOrders = today.filter(order => selected.includes(order.id)); const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); async function buildLoad() { const chosen = today.filter(order => selected.includes(order.id)); if (!chosen.length) return; setSaving(true); setMessage(undefined); try { await createRun({ reference: `LOAD-${date.replaceAll('-', '')}-${String(planned.length + 1).padStart(2, '0')}`, planningDate: date, stops: chosen.map(order => ({ orderId: order.id, name: `${order.poNumber} · ${order.customerCode}` })) }, await token()); setSelected([]); await loads.refresh(); await returns.refresh(); setMessage('Load saved. Allocate the fleet, add addresses and calculate route/ETA. Market details are retained for dispatch.'); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Could not save the load.'); } finally { setSaving(false); } } return <section><div className="title-row"><div><p className="eyebrow">Plan and control</p><h1>Planning board</h1></div><button onClick={() => { void ordersApi.refresh(); void loads.refresh(); void returns.refresh(); }}>Refresh</button></div><div className="planner-toolbar"><label>Plan date <input type="date" value={date} onChange={event => { setDate(event.target.value); setSelected([]); }} /></label><span>{today.length} approved order{today.length === 1 ? '' : 's'} awaiting load allocation</span><button className="primary" disabled={!selected.length || saving} onClick={() => void buildLoad()}>{saving ? 'Saving…' : `Build load (${selected.length})`}</button></div><DriverReturnSuggestions data={returns.data} loading={returns.loading} error={returns.error} /><PlanningSuggestions orders={today} selected={selected} onSelect={setSelected} /><SelectedLoadPreview orders={selectedOrders} />{message && <p className="notice inline-notice">{message}</p>}<State loading={ordersApi.loading || loads.loading} error={ordersApi.error || loads.error}><div className="planner-workspace"><article className="lane unallocated"><h2>Ready to plan <span>{today.length}</span></h2>{today.length ? today.map(order => <OrderCard key={order.id} order={order} selected={selected.includes(order.id)} onToggle={() => toggle(order.id)} />) : <p className="hint">No approved orders are ready for this date. Review new orders in Staging.</p>}</article><article className="lane planner-lanes"><h2>Planned loads <span>{planned.length}</span></h2>{planned.length ? planned.map(load => <LoadCard key={load.id} load={load} onSaved={loads.refresh} />) : <p className="hint">Create a load from approved orders to allocate it here.</p>}</article><OperationalMap loads={planned} telemetry={undefined} /></div></State></section>; }
function ordinal(value: number) { const remainder = value % 100; return `${value}${remainder >= 11 && remainder <= 13 ? 'th' : value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'}`; }
function DriverReturnSuggestions({ data, loading, error }: { data?: ReturnLoadSuggestions; loading: boolean; error?: string }) { if (loading) return <aside className="return-suggestions"><p>Checking drivers already away…</p></aside>; if (error) return <aside className="return-suggestions warning"><p>Return-work suggestions are temporarily unavailable.</p></aside>; if (!data?.suggestions.length) return null; const urgent = data.suggestions.filter(item => item.priority >= 80 || item.consecutiveDays >= 4).length; return <aside className="return-suggestions"><div className="return-heading"><div><p className="eyebrow">Next-day driver positioning</p><h2>Bring-away drivers toward home</h2></div><span>{urgent} high priority</span></div><p className="hint">Prioritises full-time, casual, LTD then agency cover; flags drivers on day 5/6 and away in the north so planners can pull them south before assigning fresh local work.</p><div className="return-grid">{data.suggestions.slice(0, 8).map(item => <article className={item.priority >= 80 || item.consecutiveDays >= 4 ? 'urgent-return' : ''} key={item.driverId}><span className={item.priority >= 80 || item.consecutiveDays >= 4 ? 'priority urgent' : 'priority'}>{ordinal(item.consecutiveDays + 1)} day</span><strong>{item.driverName}</strong><small>{item.previousLoadReference} · {item.lastLocation || 'last stop not mapped'}</small><p>{item.reason}</p><dl><div><dt>Employee</dt><dd>{item.employeeNumber}</dd></div><div><dt>Priority</dt><dd>{item.priority}/100</dd></div></dl>{item.suggestedLoadReference ? <b>Suggested return load: {item.suggestedLoadReference}</b> : <b className="needs-load">Needs southbound load match</b>}</article>)}</div></aside>; }
function SelectedLoadPreview({ orders }: { orders: PlanningOrder[] }) { if (!orders.length) return null; const pallets = orders.reduce((total, order) => total + (Number(order.pallets) || 0), 0); const groups = [...new Set(orders.map(order => order.marketName || order.customerCode))]; return <aside className="selected-load-preview"><div><p className="eyebrow">Draft load preview</p><h2>{orders.length} stop{orders.length === 1 ? '' : 's'} · {pallets} pallets</h2></div><span>{groups.slice(0, 4).join(' → ')}{groups.length > 4 ? ` +${groups.length - 4} more` : ''}</span><small>Check the sequence and map points after saving, then allocate driver, vehicle and trailer.</small></aside>; }
function PlanningSuggestions({ orders, selected, onSelect }: { orders: PlanningOrder[]; selected: string[]; onSelect: (ids: string[]) => void }) { const groups = Object.values(orders.reduce<Record<string, PlanningOrder[]>>((result, order) => { const key = order.marketName ? `Market · ${order.marketName}` : `Customer · ${order.customerCode}`; (result[key] ||= []).push(order); return result; }, {})).filter(group => group.length > 1).sort((left, right) => right.length - left.length).slice(0, 3); if (!groups.length) return null; return <aside className="suggestions"><div><p className="eyebrow">Run suggestions</p><h2>Group compatible collections</h2></div>{groups.map(group => <button key={group[0].id} type="button" className={group.every(order => selected.includes(order.id)) ? 'selected' : ''} onClick={() => onSelect(group.map(order => order.id))}><strong>{group[0].marketName || group[0].customerCode}</strong><span>{group.length} collection{group.length === 1 ? '' : 's'} · select for a suggested run</span></button>)}</aside>; }
type RouteLine = { loadId: string; coordinates: [number, number][] };
function OperationalMap({ loads, telemetry }: { loads: Load[]; telemetry?: Telemetry }) { const token = useAccessToken(); const container = useRef<HTMLDivElement>(null); const [routes, setRoutes] = useState<RouteLine[]>([]); const [mapError, setMapError] = useState<string>(); const all = useMemo(() => [...loads.flatMap(load => load.stops.filter(stop => stop.latitude != null && stop.longitude != null).map(stop => ({ label: `${load.reference}: ${stop.name}`, latitude: stop.latitude!, longitude: stop.longitude!, type: 'stop' as const }))), ...(telemetry?.records || []).filter(record => record.latitude != null && record.longitude != null).map(record => ({ label: record.vehicleIdentifier, latitude: record.latitude!, longitude: record.longitude!, type: 'vehicle' as const }))], [loads, telemetry]); const points = all.filter(point => point.type === 'stop'); const vehicles = all.filter(point => point.type === 'vehicle'); const mapsClientId = import.meta.env.VITE_AZURE_MAPS_CLIENT_ID; const appClientId = import.meta.env.VITE_ENTRA_CLIENT_ID; const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID; useEffect(() => { let cancelled = false; if (!loads.length) { setRoutes([]); return () => { cancelled = true; }; } async function fetchRoutes() { try { const accessToken = await token(); const results = await Promise.all(loads.filter(load => load.stops.filter(stop => stop.latitude != null && stop.longitude != null).length > 1).map(async load => { try { const result = await getRunRoute(load.id, accessToken) as { routes?: Array<{ legs?: Array<{ points?: Array<{ latitude?: number; longitude?: number }> }> }> }; const coordinates = result.routes?.[0]?.legs?.flatMap(leg => (leg.points || []).flatMap(point => point.longitude != null && point.latitude != null ? [[point.longitude, point.latitude] as [number, number]] : [])) || []; return coordinates.length > 1 ? { loadId: load.id, coordinates } : undefined; } catch { return undefined; } })); if (!cancelled) setRoutes(results.filter((route): route is RouteLine => Boolean(route))); } catch { if (!cancelled) setRoutes([]); } } void fetchRoutes(); return () => { cancelled = true; }; }, [loads, token]); useEffect(() => { if (!container.current || !mapsClientId || !appClientId || !tenantId) return; setMapError(undefined); let map: import('azure-maps-control').Map | undefined; let disposed = false; void import('azure-maps-control').then(atlas => { if (disposed || !container.current) return; try { map = new atlas.Map(container.current, { authOptions: { authType: atlas.AuthenticationType.aad, clientId: mapsClientId, aadAppId: appClientId, aadTenant: tenantId }, center: [-1.5, 53.5], zoom: 5.5 }); map.events.add('ready', () => { try { if (!map) return; const source = new atlas.source.DataSource(); map.sources.add(source); source.add(all.map(point => new atlas.data.Feature(new atlas.data.Point([point.longitude, point.latitude]), { label: point.label, type: point.type }))); source.add(routes.map(route => new atlas.data.Feature(new atlas.data.LineString(route.coordinates), { type: 'route' }))); map.layers.add(new atlas.layer.LineLayer(source, undefined, { strokeColor: '#006d6c', strokeWidth: 4, strokeOpacity: .8, filter: ['==', ['get', 'type'], 'route'] })); map.layers.add(new atlas.layer.BubbleLayer(source, undefined, { color: ['match', ['get', 'type'], 'vehicle', '#087f8c', '#e39d30'], radius: 8, strokeColor: '#ffffff', strokeWidth: 2, filter: ['!=', ['get', 'type'], 'route'] })); map.layers.add(new atlas.layer.SymbolLayer(source, undefined, { textField: ['get', 'label'], textOffset: [0, 1.2], textSize: 11, textColor: '#17344a', filter: ['!=', ['get', 'type'], 'route'] })); const cameraPoints = [...all.map(point => [point.longitude, point.latitude] as [number, number]), ...routes.flatMap(route => route.coordinates)]; if (cameraPoints.length > 1) map.setCamera({ bounds: atlas.data.BoundingBox.fromPositions(cameraPoints), padding: 55 }); } catch { setMapError('The map could not initialise, but the planning board is still available.'); } }); } catch { setMapError('The map could not initialise, but the planning board is still available.'); } }); return () => { disposed = true; map?.dispose(); }; }, [all, appClientId, mapsClientId, routes, tenantId]); return <article className="map-panel"><p className="eyebrow">Route workspace</p><h2>Stops, routes & live fleet</h2>{mapError && <p className="notice inline-notice">{mapError}</p>}{mapsClientId ? <div ref={container} className="azure-map" /> : <div className="map-grid live-map"><p className="map-empty">Set <code>VITE_AZURE_MAPS_CLIENT_ID</code> in GitHub Variables to enable the Azure Maps tiles. Route points are still saved and routed through the API.</p></div>}<p className="hint">{points.length} route points · {routes.length} route{routes.length === 1 ? '' : 's'} drawn · {vehicles.length} live DOT vehicle positions</p></article>; }
function OrderCard({ order, selected, onToggle }: { order: PlanningOrder; selected: boolean; onToggle: () => void }) { return <button className={`order-card selectable ${selected ? 'selected' : ''}`} onClick={onToggle}><strong>{order.poNumber}</strong><span>{order.customerCode}</span><small>{order.pallets} pallets · Delivery {order.deliveryDate}</small><em className={`status ${order.status.toLowerCase()}`}>{selected ? 'Selected' : order.status}</em></button>; }
function LoadCard({ load, onSaved }: { load: Load; onSaved: () => Promise<void> }) {
  const token = useAccessToken();
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const trailers = useApi(useCallback(async () => api.trailers(await token()), [token]));
  const [vehicleId, setVehicleId] = useState(load.vehicleId || ''); const [driverId, setDriverId] = useState(load.driverId || ''); const [trailerId, setTrailerId] = useState(load.trailerId || ''); const [saving, setSaving] = useState(false); const [dispatchMessage, setDispatchMessage] = useState<string>(); const selectedDriver = drivers.data?.find(driver => driver.id === driverId);
  async function save() { setSaving(true); try { await allocateRun(load.id, { vehicleId: vehicleId || undefined, driverId: driverId || undefined, trailerId: trailerId || undefined }, await token()); await onSaved(); setDispatchMessage('Allocation saved. The driver brief can now be dispatched.'); } catch (exception) { setDispatchMessage(exception instanceof Error ? exception.message : 'Could not save allocation.'); } finally { setSaving(false); } }
  async function updateStatus(status: 'InProgress' | 'Completed') { setSaving(true); try { await updateRunStatus(load.id, status, await token()); await onSaved(); setDispatchMessage(status === 'InProgress' ? 'Load marked in progress.' : 'Load marked completed.'); } catch (exception) { setDispatchMessage(exception instanceof Error ? exception.message : 'Could not update load status.'); } finally { setSaving(false); } }
  async function copyDispatch() { setSaving(true); try { const accessToken = await token(); const dispatch: LoadDispatch = await getRunDispatch(load.id, accessToken); const stops = dispatch.stops.map(stop => { const order = stop.order; return [`${stop.sequence}. ${stop.name}`, order?.marketName ? `Market: ${order.marketName}${order.stallNumber ? ` · Stall ${order.stallNumber}` : ''}` : '', order?.sellerName ? `Seller: ${order.sellerName}` : '', stop.address ? `Address: ${stop.address}` : '', order?.driverInstructions ? `Notes: ${order.driverInstructions}` : '', order?.mapLink ? `Map: ${order.mapLink}` : ''].filter(Boolean).join('\n'); }).join('\n\n'); const message = [`SLH run ${dispatch.reference}`, dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : '', dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : '', dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : '', '', stops].filter(Boolean).join('\n'); await navigator.clipboard.writeText(message); if (load.status === 'Planned') { await updateRunStatus(load.id, 'Dispatched', accessToken); await onSaved(); } setDispatchMessage(load.status === 'Planned' ? `Driver message copied for ${dispatch.driver?.mobileNumber || 'driver mobile missing'}; load marked dispatched.` : `Driver message copied for ${dispatch.driver?.mobileNumber || 'driver mobile missing'}.`); } catch (exception) { setDispatchMessage(exception instanceof Error ? exception.message : 'Could not prepare the driver dispatch.'); } finally { setSaving(false); } }
  async function sendSms() { setSaving(true); try { const receipt = await api.sendDispatchSms(load.id, await token()); await onSaved(); setDispatchMessage(`${receipt.provider || 'SMS provider'} accepted the driver text for the mobile ending ${receipt.mobileSuffix}.`); } catch (exception) { setDispatchMessage(exception instanceof Error ? exception.message : 'Could not send the driver SMS.'); } finally { setSaving(false); } }
  return <div className="order-card allocation-card"><strong>{load.reference}</strong><span>{load.stops.length} planned stop{load.stops.length === 1 ? '' : 's'}</span><small>{load.stops.map(stop => stop.name).join(' → ') || 'No map points added yet'}</small><div className="allocation-fields"><select value={vehicleId} onChange={event => setVehicleId(event.target.value)}><option value="">Vehicle</option>{vehicles.data?.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.registration}</option>)}</select><select value={driverId} onChange={event => setDriverId(event.target.value)}><option value="">Driver</option>{drivers.data?.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select><select value={trailerId} onChange={event => setTrailerId(event.target.value)}><option value="">Trailer</option>{trailers.data?.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.trailerNumber}</option>)}</select><button onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Assign'}</button><button type="button" onClick={() => void copyDispatch()} disabled={saving}>Copy for MightyText</button><button type="button" className="primary" onClick={() => void sendSms()} disabled={saving}>Send driver SMS</button>{load.status === 'Dispatched' && <button type="button" onClick={() => void updateStatus('InProgress')} disabled={saving}>Start load</button>}{load.status === 'InProgress' && <button type="button" onClick={() => void updateStatus('Completed')} disabled={saving}>Complete load</button>}</div>{selectedDriver && <aside className="driver-copy-panel"><div><span>MightyText recipient</span><strong>{selectedDriver.mobileNumber || 'Mobile number needs approval in Master Data'}</strong><small>{selectedDriver.displayName}</small></div><button type="button" onClick={() => void navigator.clipboard.writeText(selectedDriver.mobileNumber || '')} disabled={!selectedDriver.mobileNumber}>Copy phone</button></aside>}{dispatchMessage && <p className="hint">{dispatchMessage}</p>}<StopEditor load={load} onSaved={onSaved} /><em className={`status ${load.status.toLowerCase()}`}>{load.status}</em></div>;
}
function StopEditor({ load, onSaved }: { load: Load; onSaved: () => Promise<void> }) {
  const token = useAccessToken(); const [open, setOpen] = useState(false); const [stops, setStops] = useState(load.stops.map(stop => ({ ...stop, latitude: stop.latitude?.toString() || '', longitude: stop.longitude?.toString() || '' }))); const [saving, setSaving] = useState(false); const [message, setMessage] = useState<string>(); const [routeSummary, setRouteSummary] = useState<string>();
  const update = (index: number, field: 'address' | 'latitude' | 'longitude' | 'plannedArrivalUtc', value: string) => setStops(current => current.map((stop, itemIndex) => itemIndex === index ? { ...stop, [field]: value } : stop));
  async function locateStops() { const addresses = stops.map((stop, index) => ({ index, address: stop.address?.trim() })).filter((stop): stop is { index: number; address: string } => Boolean(stop.address)); if (!addresses.length) { setMessage('Enter at least one stop address before locating it.'); return; } setSaving(true); setMessage(undefined); try { const accessToken = await token(); const results = await Promise.all(addresses.map(async stop => { const response = await api.geocode(stop.address, accessToken) as { results?: Array<{ position?: { lat?: number; lon?: number } }> }; const position = response.results?.[0]?.position; if (position?.lat == null || position.lon == null) throw new Error(`No map point found for ${stop.address}.`); return { index: stop.index, latitude: String(position.lat), longitude: String(position.lon) }; })); setStops(current => current.map((stop, index) => { const result = results.find(item => item.index === index); return result ? { ...stop, latitude: result.latitude, longitude: result.longitude } : stop; })); setMessage(`${results.length} stop${results.length === 1 ? '' : 's'} located. Save route points, then calculate the ETA.`); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Azure Maps could not locate the stop.'); } finally { setSaving(false); } }
  async function save() { setSaving(true); try { await updateRunStops(load.id, stops.map(stop => ({ orderId: stop.orderId, name: stop.name, address: stop.address, latitude: stop.latitude ? Number(stop.latitude) : undefined, longitude: stop.longitude ? Number(stop.longitude) : undefined, plannedArrivalUtc: stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).toISOString() : undefined })), await token()); await onSaved(); setMessage('Stops and planned ETAs saved.'); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Could not save stops.'); } finally { setSaving(false); } }
  async function calculateRoute() { setSaving(true); try { const result = await getRunRoute(load.id, await token()) as { routes?: Array<{ summary?: { lengthInMeters?: number; travelTimeInSeconds?: number } }> }; const summary = result.routes?.[0]?.summary; if (!summary) throw new Error('Azure Maps did not return a route.'); const miles = ((summary.lengthInMeters || 0) / 1609.344).toFixed(1); const minutes = Math.round((summary.travelTimeInSeconds || 0) / 60); setStops(current => current.map((stop, index) => index === current.length - 1 ? { ...stop, plannedArrivalUtc: new Date(Date.now() + minutes * 60_000).toISOString() } : stop)); setRouteSummary(`${miles} miles · estimated drive time ${Math.floor(minutes / 60)}h ${minutes % 60}m. Final-stop ETA populated; review and save it.`); } catch (exception) { setRouteSummary(exception instanceof Error ? exception.message : 'Route calculation failed.'); } finally { setSaving(false); } }
  return <div className="stop-editor"><button type="button" onClick={() => setOpen(current => !current)}>{open ? 'Hide route points' : 'Edit route points'}</button>{open && <><p className="hint">Enter an address, locate it with Azure Maps, then review the calculated final-stop ETA against the delivery window.</p>{stops.map((stop, index) => <div className="stop-row" key={stop.id || index}><strong>{index + 1}. {stop.name}</strong><input placeholder="Address" value={stop.address || ''} onChange={event => update(index, 'address', event.target.value)} /><input placeholder="Latitude" inputMode="decimal" value={stop.latitude} onChange={event => update(index, 'latitude', event.target.value)} /><input placeholder="Longitude" inputMode="decimal" value={stop.longitude} onChange={event => update(index, 'longitude', event.target.value)} /><input aria-label={`Planned ETA for ${stop.name}`} type="datetime-local" value={stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).toISOString().slice(0, 16) : ''} onChange={event => update(index, 'plannedArrivalUtc', event.target.value)} /></div>)}<div className="route-actions"><button type="button" onClick={() => void locateStops()} disabled={saving}>Locate addresses</button><button type="button" className="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save route & ETA'}</button><button type="button" onClick={() => void calculateRoute()} disabled={saving}>Calculate route & ETA</button></div>{message && <p className="hint">{message}</p>}{routeSummary && <p className="route-summary">{routeSummary}</p>}</>}</div>;
}

export function Loads() { const token = useAccessToken(); const load = useCallback(async () => api.orders(undefined, undefined, await token()), [token]); const { data, loading, error } = useApi(load); const orders = planningOrders(data); function exportCsv() { const rows = [['Collection date', 'Order / PO', 'Customer', 'Pallets', 'Delivery date', 'Readiness'], ...orders.map(order => [order.collectionDate, order.poNumber, order.customerCode, order.pallets, order.deliveryDate, order.status])]; const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `slh-loads-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href); } return <section><div className="title-row"><div><p className="eyebrow">Loads</p><h1>Approved order load list</h1></div><button onClick={exportCsv} disabled={!orders.length}>Download CSV</button></div><State loading={loading} error={error} empty={!orders.length}><div className="table-wrap"><table><thead><tr><th>Collection</th><th>Order</th><th>Customer</th><th>Pallets</th><th>Delivery</th><th>Readiness</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td>{order.collectionDate}</td><td>{order.poNumber}</td><td>{order.customerCode}</td><td>{order.pallets}</td><td>{order.deliveryDate}</td><td><span className={`status ${order.status.toLowerCase()}`}>{order.status}</span></td></tr>)}</tbody></table></div></State></section>; }

export function DriverAssignments() {
  const token = useAccessToken(); const today = new Date().toISOString().slice(0, 10); const params = new URLSearchParams(window.location.search); const initialFrom = params.get('from') || today; const initialTo = params.get('to') || initialFrom; const [from, setFrom] = useState(initialFrom); const [to, setTo] = useState(initialTo); const assignments = useApi(useCallback(async () => api.driverAssignments(from, to, await token()), [from, to, token]));
  const rows = assignments.data || []; const allocated = rows.filter(item => item.driver && item.vehicle).length; const unallocated = rows.length - allocated;
  function exportAssignments() { downloadCsv(`slh-driver-assignments-${from}-to-${to}`, [['Date', 'Load', 'Driver', 'Employee number', 'Vehicle', 'Trailer', 'Final stop', 'Stops', 'Status'], ...rows.map(item => [item.planningDate, item.loadReference, item.driver?.displayName, item.driver?.employeeNumber, item.vehicle?.registration, item.trailerNumber, item.finalStop, item.stopCount, item.status])]); }
  return <section><div className="driver-history-subnav" aria-label="Driver history sections"><NavLink to="/driver-assignments">Driver assignments</NavLink><NavLink to="/driver-timesheets">Timesheets</NavLink></div><div className="title-row"><div><p className="eyebrow">Driver history</p><h1>Driver assignments</h1></div><button onClick={exportAssignments} disabled={!rows.length}>Download CSV</button></div><div className="assignment-toolbar"><label>From <input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>To <input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label><button onClick={() => void assignments.refresh()}>Refresh</button></div><div className="metrics"><Metric label="Loads" value={String(rows.length)} detail={`${from} to ${to}`} /><Metric label="Fully allocated" value={String(allocated)} detail="Driver and vehicle recorded" /><Metric label="Unallocated" value={String(unallocated)} detail="Historic gaps to review" /><Metric label="Drivers used" value={String(new Set(rows.flatMap(item => item.driver ? [item.driver.id] : [])).size)} detail="Distinct assigned drivers" /></div><State loading={assignments.loading} error={assignments.error} empty={!rows.length}><div className="table-wrap"><table><thead><tr><th>Date</th><th>Load</th><th>Driver</th><th>Vehicle</th><th>Trailer</th><th>Final stop</th><th>Status</th></tr></thead><tbody>{rows.map((item: DriverAssignment) => <tr key={item.loadId}><td>{item.planningDate}</td><td><strong>{item.loadReference}</strong><small>{item.stopCount} stop{item.stopCount === 1 ? '' : 's'}</small></td><td>{item.driver ? <><strong>{item.driver.displayName}</strong><small>{item.driver.employeeNumber}</small></> : <span className="status failed">Not assigned</span>}</td><td>{item.vehicle?.registration || '—'}</td><td>{item.trailerNumber || '—'}</td><td>{item.finalStop || '—'}</td><td><span className={`status ${statusClass(item.status)}`}>{stagingStatus(item.status)}</span></td></tr>)}</tbody></table></div></State></section>;
}

type CsvCell = string | number | undefined;
function downloadCsv(name: string, rows: Array<Array<CsvCell> | Array<Array<CsvCell>>>) { const normalized = rows.flatMap(row => Array.isArray(row[0]) ? row as Array<Array<CsvCell>> : [row as Array<CsvCell>]); const csv = normalized.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href); }
export function ExportCentre() {
  const token = useAccessToken();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const ordersApi = useApi(useCallback(async () => api.orders(undefined, undefined, await token()), [token]));
  const loads = useApi(useCallback(async () => listRuns(undefined, await token()), [token]));
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const customerContacts = useApi(useCallback(async () => api.customerContacts(await token()), [token]));
  const telemetry = useApi(useCallback(async () => api.telemetry(await token()), [token]));
  const etaApi = useApi(useCallback(async () => api.deliveryEtas(date, await token()), [date, token]));
  const orders = planningOrders(ordersApi.data);
  const vehicleById = new Map((vehicles.data || []).map(vehicle => [vehicle.id, vehicle])); const driverById = new Map((drivers.data || []).map(driver => [driver.id, driver]));
  const etaEmailByCustomer = new Map((customerContacts.data || []).filter(contact => contact.receivesEtaUpdates && contact.email).map(contact => [contact.customerCode, contact.email]));
  const customerEtaRecords = (etaApi.data?.records || []).filter(item => item.customerCode);
  const customerEtaRows = customerEtaRecords.map(item => { const load = loads.data?.find(value => value.id === item.loadId); return [item.customerCode, etaEmailByCustomer.get(item.customerCode || ''), item.orderReference, item.loadReference, item.vehicleRegistration, driverById.get(load?.driverId || '')?.displayName, item.stopName, item.deliveryWindowStartUtc, item.deliveryWindowEndUtc, item.etaUtc, item.source, item.risk]; });
  const etaRiskCounts = customerEtaRecords.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.risk]: (counts[item.risk] || 0) + 1 }), {});
  const customerEtaMessage = customerEtaRecords.slice(0, 12).map(item => { const load = loads.data?.find(value => value.id === item.loadId); return [`${item.customerCode || 'Customer'} · ${item.orderReference || item.loadReference}`, `Vehicle: ${item.vehicleRegistration || 'TBC'} · Driver: ${driverById.get(load?.driverId || '')?.displayName || 'TBC'}`, `ETA: ${formatDate(item.etaUtc)} (${item.source}) · Window: ${formatDate(item.deliveryWindowStartUtc)} - ${formatDate(item.deliveryWindowEndUtc)}`, `Status: ${item.risk}`].join('\n'); }).join('\n\n');
  const ready = Boolean(orders.length || loads.data?.length || telemetry.data?.records.length || customerEtaRows.length);
  const exportErrors = [ordersApi.error, loads.error, vehicles.error, drivers.error, customerContacts.error, etaApi.error].filter(Boolean);
  const refresh = () => { void ordersApi.refresh(); void loads.refresh(); void vehicles.refresh(); void drivers.refresh(); void customerContacts.refresh(); void etaApi.refresh(); };
  async function copyCustomerEtas() { await navigator.clipboard.writeText(customerEtaMessage || 'No customer ETA records available for this date.'); }
  return <section><div className="title-row"><div><p className="eyebrow">Handover & reporting</p><h1>Operational exports</h1></div><button onClick={refresh}>Refresh data</button></div><div className="report-toolbar"><label>ETA operating date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>Customer ETA exports use live tracking where available and clearly label planned fallback values.</span></div><State loading={ordersApi.loading || loads.loading || vehicles.loading || drivers.loading || customerContacts.loading || etaApi.loading} error={exportErrors[0]} empty={!ready}>{telemetry.error && <p className="notice inline-notice">Live fleet export could not refresh yet; order and ETA exports are still available.</p>}<div className="eta-summary"><strong>{customerEtaRows.length} customer ETA line{customerEtaRows.length === 1 ? '' : 's'}</strong><span>{etaRiskCounts.Late || 0} late · {etaRiskCounts.AtRisk || 0} at risk · {etaRiskCounts.OnTrack || 0} on track · {etaRiskCounts.Pending || 0} pending</span><button onClick={() => void copyCustomerEtas()} disabled={!customerEtaRows.length}>Copy customer ETA brief</button></div><div className="export-grid"><article className="export-card"><h2>Customer ETA update</h2><p>Approved recipient, order, load, vehicle, driver, delivery window, ETA source and delivery risk.</p><button onClick={() => downloadCsv('slh-customer-eta-update', [['Customer', 'Recipient email', 'Order', 'Load', 'Vehicle', 'Driver', 'Delivery stop', 'Window start', 'Window end', 'ETA', 'ETA source', 'Status'], customerEtaRows])} disabled={!customerEtaRows.length}>Download customer ETA CSV</button></article><article className="export-card"><h2>Approved order list</h2><p>Approved orders with collection and delivery dates, ready for operational export.</p><button onClick={() => downloadCsv('slh-orders', [['Collection date', 'Order / PO', 'Customer', 'Pallets', 'Delivery date', 'Status'], ...orders.map(order => [order.collectionDate, order.poNumber, order.customerCode, order.pallets, order.deliveryDate, order.status])])} disabled={!orders.length}>Download orders CSV</button></article><article className="export-card"><h2>Planned loads</h2><p>Load references, assignment status and route stop count for daily control.</p><button onClick={() => downloadCsv('slh-planned-loads', [['Planning date', 'Load reference', 'Status', 'Vehicle', 'Driver', 'Trailer ID', 'Stops'], ...(loads.data || []).map(load => [load.planningDate, load.reference, load.status, vehicleById.get(load.vehicleId || '')?.registration, driverById.get(load.driverId || '')?.displayName, load.trailerId, load.stops.length])])} disabled={!loads.data?.length}>Download loads CSV</button></article><article className="export-card"><h2>Live fleet positions</h2><p>Latest DOT tracking data for escalation, customer updates and ETA review.</p><button onClick={() => downloadCsv('slh-live-fleet', [['Vehicle', 'Updated', 'Latitude', 'Longitude', 'Speed kph', 'Moving', 'Status'], ...(telemetry.data?.records || []).map(record => [record.vehicleIdentifier, record.eventTimeUtc, record.latitude, record.longitude, record.speedKph, record.isMoving ? 'Yes' : 'No', record.status])])} disabled={!telemetry.data?.records.length}>Download tracking CSV</button></article></div><div className="panel export-note"><h2>Automated intake</h2><p>The protected batch endpoint accepts up to 500 idempotent email or workbook rows into Staging for planner approval.</p></div></State></section>;
}

export function StagingQueue({ ordersOnly = false, masterOnly = false }: { ordersOnly?: boolean; masterOnly?: boolean } = {}) {
  const token = useAccessToken();
  const [entityFilter, setEntityFilter] = useState('');
  const [planningDate, setPlanningDate] = useState(() => new URLSearchParams(window.location.search).get('date') || localDateInput());
  const effectiveEntityFilter = ordersOnly ? 'order' : entityFilter;
  const load = useCallback(async () => {
    if (ordersOnly) {
      const records: StagedImport[] = [];
      let page = 1;
      while (page <= 20) {
        const result = await api.stagingQueue(planningDate, await token(), page, 100);
        records.push(...result.records);
        if (!result.hasMore) break;
        page += 1;
      }
      return records;
    }
    const access = await token();
    if (masterOnly) {
      if (effectiveEntityFilter)
        return api.staging(access, 'PendingReview', effectiveEntityFilter, 500);
      const batches = await Promise.all(masterStagingTypes.map(type => api.staging(access, 'PendingReview', type, 500)));
      return batches.flat().filter(item => masterStagingTypes.includes(item.entityType.toLowerCase()));
    }
    return api.staging(access, 'PendingReview', effectiveEntityFilter, 2000);
  }, [token, effectiveEntityFilter, ordersOnly, masterOnly, planningDate]);
  const { data, loading, error, refresh } = useApi(load);
  const [reviewing, setReviewing] = useState<string>();
  const [selected, setSelected] = useState<StagedImport>();
  const [bulkEntity, setBulkEntity] = useState('vehicle');
  const [message, setMessage] = useState<string>();
  const [requestingOrders, setRequestingOrders] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [sourceEvidenceId, setSourceEvidenceId] = useState<string>();
  const [masterImportBusy, setMasterImportBusy] = useState(false);

  async function review(item: StagedImport, approved: boolean) {
    setReviewing(item.id);
    setMessage(undefined);
    try {
      await api.review(item.id, approved, '', await token());
      if (ordersOnly) {
        setMessage(approved ? 'Order approved and promoted to Planner Builder.' : 'Order rejected and removed from Order Review.');
      } else {
        setMessage(approved
          ? `${item.entityType} record approved and promoted to Master Data.`
          : `${item.entityType} record rejected and removed from the import review queue.`);
      }
      setSelected(undefined);
      await refresh();
    } catch (exception) {
      setMessage(exception instanceof Error
        ? exception.message
        : ordersOnly
          ? 'The order could not be reviewed. Check the readiness reason and source evidence.'
          : 'The master-data record could not be reviewed.');
    } finally {
      setReviewing(undefined);
    }
  }

  async function requestOrders() {
    setRequestingOrders(true);
    setMessage(undefined);
    try {
      const result = await api.pollMailboxNow(await token());
      setMessage(`${result.message} ${result.lastMessagesIngested} new message${result.lastMessagesIngested === 1 ? '' : 's'} staged.`);
      await refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : 'Orders could not be requested from Microsoft Graph.');
    } finally {
      setRequestingOrders(false);
    }
  }

  async function replayRetainedEvidence() {
    setReplaying(true);
    setMessage(undefined);
    try {
      const result = await request<{ eligibleOrders: number; pendingAfterReplay: number; legacyMappingExceptionsArchived: number }>(
        '/api/v1/order-intake/replay-retained-evidence',
        await token(),
        {
          method: 'POST',
          body: JSON.stringify({
            receivedFromUtc: `${addDays(planningDate, -2)}T00:00:00Z`,
            minimumPlanningDate: planningDate,
            maximumPlanningDate: planningDate,
            refreshUnamendedPending: false,
            maxMessages: 500
          })
        }
      );
      setMessage(`Replay complete: ${result.eligibleOrders} order${result.eligibleOrders === 1 ? '' : 's'} re-parsed; ${result.legacyMappingExceptionsArchived} old mapping exception${result.legacyMappingExceptionsArchived === 1 ? '' : 's'} archived; ${result.pendingAfterReplay} now awaiting review.`);
      await refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : 'Retained evidence replay failed.');
    } finally {
      setReplaying(false);
    }
  }

  async function reloadGeofenceSeed() {
    if (!window.confirm('Reload the approved SLH Falcon geofence seed? Existing matching geofences will be updated rather than duplicated.')) return;
    setMasterImportBusy(true);
    setMessage(undefined);
    try {
      const result = await request<{ supplied: number; inserted: number; updated: number; siteMatched: number }>('/api/v1/geofences/import-slh-seed', await token(), { method: 'POST' });
      setMessage(`${result.supplied} geofences checked · ${result.inserted} inserted · ${result.updated} updated · ${result.siteMatched} linked to Sites.`);
      await refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : 'SLH geofence seed import failed.');
    } finally {
      setMasterImportBusy(false);
    }
  }

  async function approveBulk() {
    const pending = (data || []).filter(item => stagingStatus(item.status) === 'PendingReview' && item.entityType === bulkEntity);
    if (!pending.length) return;
    setReviewing('bulk');
    setMessage(undefined);
    try {
      const accessToken = await token();
      for (const item of pending) await api.review(item.id, true, `Bulk approved ${bulkEntity} master data`, accessToken);
      setMessage(`${pending.length} ${bulkEntity} record${pending.length === 1 ? '' : 's'} approved and promoted.`);
      await refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : 'Bulk approval failed.');
    } finally {
      setReviewing(undefined);
    }
  }

  const parseStagingPayload = (item?: StagedImport) => {
    if (!item) return {} as Record<string, unknown>;
    try { return JSON.parse(item.payloadJson) as Record<string, unknown>; } catch { return {}; }
  };
  const payload = selected ? parseStagingPayload(selected) : undefined;

  const orderSummary = (item: StagedImport) => {
    if (item.entityType !== 'order') return { collection: '—', delivery: '—', pallets: '—' };
    const value = parseStagingPayload(item);
    const pick = (...keys: string[]) => keys.map(key => value[key]).find(candidate => String(candidate ?? '').trim().length > 0);
    const collection = pick('collectionSiteName', 'collectionSite', 'collectionLocation', 'originSiteName', 'originSite', 'originSiteCode', 'sellerName', 'collectFrom', 'collectionAddress');
    const directDelivery = pick('deliverySiteName', 'deliverySite', 'deliveryLocation', 'destination', 'destinationName', 'destinationSiteName', 'destinationSite', 'destinationSiteCode', 'deliverTo', 'deliveryAddress');
    const market = pick('marketName', 'retailerName', 'retailerCode');
    const stall = pick('stallNumber', 'destinationCode');
    const delivery = directDelivery || (market && stall ? `${market} · ${stall}` : market || stall);
    const pallets = pick('pallets', 'palletQty', 'palletQuantity', 'quantity');
    return { collection: String(collection || '—'), delivery: String(delivery || '—'), pallets: String(pallets ?? '—') };
  };

  const masterSummary = (item: StagedImport) => {
    const value = parseStagingPayload(item);
    const pick = (...keys: string[]) => keys.map(key => value[key]).find(candidate => String(candidate ?? '').trim().length > 0);
    const identity = pick('displayName', 'name', 'registration', 'trailerNumber', 'externalCode', 'code', 'employeeNumber', 'market', 'provider');
    const secondary = pick('customerCode', 'fleetNumber', 'collectionAddress', 'driverType', 'standOrLocation', 'weekCommencing');
    return { identity: String(identity || item.id), secondary: String(secondary || '') };
  };

  const orderReadiness = new Map((data || []).filter(item => item.entityType === 'order').map(item => {
    const value = parseStagingPayload(item);
    const summary = orderSummary(item);
    const warnings = Array.isArray(value.intakeWarnings) ? value.intakeWarnings.filter(Boolean).map(String) : [];
    const hasPallets = Number(summary.pallets) > 0 || /backhaul|backload/i.test(String(value.jobType || ''));
    const hasPlannerContract = Object.prototype.hasOwnProperty.call(value, 'plannerReady');
    const plannerReady = !hasPlannerContract || value.plannerReady === true || value.plannerReady === 'true';
    const confidence = String(value.intakeConfidence || '').trim().toLowerCase();
    const confidenceReady = !confidence || confidence === 'high';
    const hasRoute = summary.collection !== '—' && summary.delivery !== '—';
    const ready = hasRoute && hasPallets && plannerReady && confidenceReady && warnings.length === 0;
    const reason = ready
      ? 'Route, quantity and intake checks passed.'
      : warnings[0] || (summary.collection === '—'
        ? 'Collection point is missing or not matched.'
        : summary.delivery === '—'
          ? 'Delivery point is missing or not matched.'
          : !hasPallets
            ? 'Pallet quantity is missing.'
            : !plannerReady
              ? 'Parser has not marked this order planner-ready.'
              : !confidenceReady
                ? 'Intake confidence requires planner review.'
                : 'Review the source evidence before approval.');
    return [item.id, { ...summary, ready, reason }] as const;
  }));

  const clearForApproval = (data || []).filter(item => orderReadiness.get(item.id)?.ready).length;
  const pendingCounts = (data || []).filter(item => stagingStatus(item.status) === 'PendingReview')
    .reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.entityType]: (counts[item.entityType] || 0) + 1 }), {});

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">{ordersOnly ? 'Microsoft Graph order intake' : 'Admin · Imports'}</p>
        <h1>{ordersOnly ? 'Order Review' : 'Master Data Imports & Staging Queue'}</h1>
        {ordersOnly
          ? <p className="hint">Orders captured from the Info mailbox through Microsoft Graph land here first. Check collection, delivery, pallet quantity and source evidence before approval.</p>
          : <p className="hint">Add, import and approve governed Master Data here only — sites, vehicles, drivers, trailers, customers, contacts, markets, fuel data and geofences. Transport orders never appear in this queue; they remain exclusively in Order Review.</p>}
      </div>
      <div className="actions">
        <button onClick={() => void refresh()}>Refresh</button>
        {ordersOnly && <button className="primary" disabled={requestingOrders || replaying || Boolean(reviewing)} onClick={() => void requestOrders()}>{requestingOrders ? 'Requesting orders…' : 'Request orders now'}</button>}
        {ordersOnly && <button disabled={requestingOrders || replaying || Boolean(reviewing)} onClick={() => void replayRetainedEvidence()}>{replaying ? 'Replaying…' : `Re-parse ${planningDate}`}</button>}
      </div>
    </div>

    {!ordersOnly && <div className="admin-card" style={{ marginBottom: 18 }}>
      <div className="title-row" style={{ marginBottom: 10 }}>
        <div><p className="eyebrow">Master Data import controls</p><h2>Import into staging</h2><p className="hint">All Master Data import actions live here. Imported records remain subject to the staging/review rules below unless the source is an approved system seed.</p></div>
        <button disabled={masterImportBusy || Boolean(reviewing)} onClick={() => void reloadGeofenceSeed()}>{masterImportBusy ? 'Loading geofences…' : 'Reload approved geofence seed'}</button>
      </div>
      <MasterDataCsvImport onCommitted={() => void refresh()} />
    </div>}

    {ordersOnly
      ? <div className="planner-toolbar staging-filter"><label>Orders for planning date <input type="date" value={planningDate} onChange={event => { setPlanningDate(event.target.value); setSelected(undefined); }} /></label><strong>{data?.length || 0} order{data?.length === 1 ? '' : 's'} awaiting review</strong><span>{clearForApproval} clear for approval · {Math.max((data?.length || 0) - clearForApproval, 0)} need review</span>{message && <span className="notice inline-notice">{message}</span>}</div>
      : <div className="planner-toolbar staging-filter"><label>Show pending <select value={entityFilter} onChange={event => { setEntityFilter(event.target.value); setSelected(undefined); }}><option value="">All master-data types</option>{masterStagingTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label><span>{data?.length || 0} pending master-data record{data?.length === 1 ? '' : 's'} shown</span>{message && <span className="notice inline-notice">{message}</span>}</div>}

    <State loading={loading} error={error} empty={!data?.length}>
      {ordersOnly && <div className="review-readiness-summary"><strong>{data?.length || 0} order{data?.length === 1 ? '' : 's'} in review</strong><span>{clearForApproval} clear for approval</span><span>{Math.max((data?.length || 0) - clearForApproval, 0)} need route, quantity or master-data review</span></div>}

      {!ordersOnly && <div className="bulk-review panel">
        <div><h2>Bulk approve master data</h2><p>This queue is only for additions or changes to Master Data. Order approvals are deliberately excluded and stay in Order Review.</p></div>
        <label>Record type <select value={bulkEntity} onChange={event => setBulkEntity(event.target.value)}>{masterStagingTypes.map(type => <option key={type} value={type}>{type} ({pendingCounts[type] || 0})</option>)}</select></label>
        <button className="primary" disabled={!pendingCounts[bulkEntity] || reviewing === 'bulk'} onClick={() => void approveBulk()}>{reviewing === 'bulk' ? 'Approving...' : `Approve ${pendingCounts[bulkEntity] || 0}`}</button>
      </div>}

      {selected && <div className="review-modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(undefined); }}>
        <div className="panel review-panel review-modal" role="dialog" aria-modal="true" aria-label="Review details">
          <div><p className="eyebrow">Reviewing {selected.entityType}</p><h2>{String(payload?.poNumber || payload?.name || payload?.displayName || payload?.registration || payload?.externalCode || selected.id)}</h2></div>
          <div className="actions">
            {selected.entityType === 'order' && <button onClick={() => setSourceEvidenceId(selected.id)}>View email & attachments</button>}
            <button onClick={() => setSelected(undefined)}>Close</button>
          </div>
          <dl>{Object.entries(payload || {}).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{Array.isArray(value) ? value.join(', ') || '—' : String(value ?? '—')}</dd></div>)}</dl>
        </div>
      </div>}
      {sourceEvidenceId && <SourceEmailEvidenceDrawer stagingId={sourceEvidenceId} onClose={() => setSourceEvidenceId(undefined)} />}

      {ordersOnly ? <div className="table-wrap">
        <table className="staging-review-table">
          <thead><tr><th>Received</th><th>Collection point</th><th>Delivery location</th><th>Pallets</th><th>Source</th><th>Readiness</th><th>Action</th></tr></thead>
          <tbody>{data?.map(item => {
            const summary = orderSummary(item);
            const readiness = orderReadiness.get(item.id);
            return <tr key={item.id}>
              <td>{formatDate(item.receivedAtUtc)}</td>
              <td>{summary.collection}</td>
              <td>{summary.delivery}</td>
              <td>{summary.pallets}</td>
              <td>{item.source || '—'}</td>
              <td>{readiness
                ? <span className={`order-readiness ${readiness.ready ? 'clear' : 'review'}`} title={readiness.reason}><strong>{readiness.ready ? 'Clear for approval' : 'Needs review'}</strong><small>{readiness.reason}</small></span>
                : <span className={`status ${statusClass(item.status)}`}>{stagingStatus(item.status)}</span>}</td>
              <td><div className="actions">
                <button onClick={() => { setSelected(item); setSourceEvidenceId(undefined); }}>Review details</button>
                {stagingStatus(item.status) === 'PendingReview' && <>
                  <button className="approve" disabled={reviewing === item.id} onClick={() => void review(item, true)}>Approve</button>
                  <button className="reject" disabled={reviewing === item.id} onClick={() => void review(item, false)}>Reject</button>
                </>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <div className="table-wrap">
        <table className="staging-review-table">
          <thead><tr><th>Received</th><th>Type</th><th>Record</th><th>Source</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{data?.map(item => {
            const summary = masterSummary(item);
            return <tr key={item.id}>
              <td>{formatDate(item.receivedAtUtc)}</td>
              <td>{item.entityType}</td>
              <td><strong>{summary.identity}</strong>{summary.secondary && <small style={{ display: 'block' }}>{summary.secondary}</small>}</td>
              <td>{item.source || '—'}</td>
              <td><span className={`status ${statusClass(item.status)}`}>{stagingStatus(item.status)}</span></td>
              <td><div className="actions">
                <button onClick={() => setSelected(item)}>Review details</button>
                {stagingStatus(item.status) === 'PendingReview' && <>
                  <button className="approve" disabled={reviewing === item.id || reviewing === 'bulk'} onClick={() => void review(item, true)}>Approve</button>
                  <button className="reject" disabled={reviewing === item.id || reviewing === 'bulk'} onClick={() => void review(item, false)}>Reject</button>
                </>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </State>
  </section>;
}

async function loadFleetStatus(accessToken: string): Promise<FleetStatus> {
  try { return await api.fleetStatus(accessToken); }
  catch {
    const [vehiclesResult, telemetryResult] = await Promise.allSettled([api.vehicles(accessToken), api.telemetry(accessToken)]);
    const vehicles = vehiclesResult.status === 'fulfilled' ? vehiclesResult.value : [];
    const telemetry = telemetryResult.status === 'fulfilled' ? telemetryResult.value : undefined;
    if (telemetry?.records.length) return fleetStatusFromTelemetry(vehicles, telemetry);
    if (vehicles.length) return { provider: 'Master data', retrievedAtUtc: new Date().toISOString(), vehicleCount: vehicles.length, readyCount: 0, attentionCount: vehicles.length, vehicles: vehicles.map(vehicle => ({ vehicleId: vehicle.id, registration: vehicle.registration, fleetNumber: vehicle.fleetNumber, condition: 'NotSignedOn', driverMismatch: false })) };
    return { provider: 'Tracking unavailable', retrievedAtUtc: new Date().toISOString(), vehicleCount: 0, readyCount: 0, attentionCount: 0, vehicles: [] };
  }
}
function fleetStatusFromTelemetry(vehicles: Vehicle[], telemetry: Telemetry): FleetStatus {
  const latest = new Map<string, Telemetry['records'][number]>();
  for (const record of telemetry.records) for (const alias of trackingAliases(record.vehicleIdentifier)) {
    const current = latest.get(alias);
    if (!current || new Date(record.eventTimeUtc).getTime() > new Date(current.eventTimeUtc).getTime()) latest.set(alias, record);
  }
  const matched = new Set<Telemetry['records'][number]>();
  const rows = vehicles.map(vehicle => {
    const aliases = [vehicle.registration, vehicle.fleetNumber, vehicle.abbreviation].filter(Boolean).flatMap(value => trackingAliases(value || ''));
    const record = aliases.map(alias => latest.get(alias)).filter(Boolean).sort((left, right) => new Date(right!.eventTimeUtc).getTime() - new Date(left!.eventTimeUtc).getTime())[0];
    if (record) matched.add(record);
    return record ? telemetryVehicle(vehicle.id, vehicle.registration, vehicle.fleetNumber, record) : { vehicleId: vehicle.id, registration: vehicle.registration, fleetNumber: vehicle.fleetNumber, condition: 'NotSignedOn' as const, driverMismatch: false };
  });
  rows.push(...telemetry.records.filter(record => !matched.has(record)).map(record => telemetryVehicle(`roadtech-${record.vehicleIdentifier}`, record.vehicleIdentifier, undefined, record)));
  const readyCount = rows.filter(row => row.condition !== 'NotSignedOn' && row.condition !== 'Stale').length;
  return { provider: 'RoadTech Falcon · direct telemetry', retrievedAtUtc: telemetry.retrievedAtUtc, vehicleCount: rows.length, readyCount, attentionCount: rows.length - readyCount, vehicles: rows };
}
function telemetryVehicle(vehicleId: string, registration: string, fleetNumber: string | undefined, record: Telemetry['records'][number]): FleetStatus['vehicles'][number] {
  return { vehicleId, registration, fleetNumber, trackingIdentifier: record.vehicleIdentifier, condition: record.isMoving ? 'Moving' : 'SignedOn', lastEventTimeUtc: record.eventTimeUtc, isMoving: record.isMoving, speedKph: record.speedKph, latitude: record.latitude, longitude: record.longitude, driverMismatch: false };
}
function trackingAliases(value: string) {
  const normalised = value.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const aliases = new Set<string>([normalised]);
  if (normalised.length > 3) aliases.add(normalised.slice(-3));
  if (normalised.endsWith('H') && normalised.length > 4) aliases.add(normalised.slice(0, -1));
  return [...aliases].filter(Boolean);
}

export function LiveTracking() { const token = useAccessToken(); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [mode, setMode] = useState<'live' | 'history'>('live'); const fleet = useApi(useCallback(async () => loadFleetStatus(await token()), [token])); const roadTech = useApi(useCallback(async () => api.roadTechStatus(await token()), [token])); const history = useApi(useCallback(async () => api.trackingHistory(date, await token()), [date, token])); const loading = mode === 'live' ? fleet.loading || roadTech.loading : history.loading; const error = mode === 'live' ? fleet.error : history.error; const refresh = mode === 'live' ? async () => { await fleet.refresh(); await roadTech.refresh(); } : history.refresh; return <section><div className="title-row"><div><p className="eyebrow">RoadTech Falcon</p><h1>Vehicle tracking</h1></div><button onClick={() => void refresh()}>Refresh</button></div><div className="tracking-controls"><button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>Live fleet</button><button className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}>Historic day</button>{mode === 'history' && <label>Tracking date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>}</div><State loading={loading} error={error}>{mode === 'live' ? <><div className="panel"><strong>{fleet.data?.vehicleCount || 0} active fleet vehicles</strong><span>{fleet.data?.readyCount || 0} signed on, moving or started · {fleet.data?.attentionCount || 0} to watch · refreshed {formatDate(fleet.data?.retrievedAtUtc)}</span></div>{roadTech.data && <p className={roadTech.data.connected ? 'notice ready' : 'notice'}>{roadTech.data.message}</p>}{fleet.data?.provider === 'Master data' && <p className="notice">Fleet status endpoint is unavailable, so this view is showing Master Data only.</p>}{fleet.data?.provider.includes('direct telemetry') && <p className="notice ready">Live RoadTech telemetry is connected. Fleet status is being calculated directly from the latest vehicle positions.</p>}{fleet.data?.vehicleCount ? <FleetRollout fleet={fleet.data} /> : <div className="state"><strong>No active vehicles are in Master Data yet.</strong><span>Import the Transport Operations master workbook, then approve vehicle records in Staging Review.</span><a href="/master-data">Import Master Data</a><a href="/staging">Open Staging Review</a></div>}</> : <><div className="panel"><strong>{history.data?.recordCount || 0} stored tracking events</strong><span>History for {date}</span></div><div className="tracking-grid">{history.data?.records.map(record => <article className="vehicle-card" key={`${record.vehicleIdentifier}-${record.eventTimeUtc}`}><h2>{record.vehicleIdentifier}</h2><p>{record.isMoving ? 'Moving' : 'Stationary'} · {record.speedKph ?? 0} km/h</p><small>Recorded {formatDate(record.eventTimeUtc)}</small></article>)}</div></>}</State></section>; }

export function Exceptions() { const token = useAccessToken(); const staging = useApi(useCallback(async () => api.staging(await token(), ''), [token])); const fleet = useApi(useCallback(async () => loadFleetStatus(await token()), [token])); const rejected = staging.data?.filter(item => ['Rejected', 'Failed'].includes(stagingStatus(item.status))) || []; const stale = (fleet.data?.vehicles || []).filter(vehicle => vehicle.condition === 'Stale'); return <section><div className="title-row"><div><p className="eyebrow">Attention required</p><h1>Exceptions</h1></div><button onClick={() => { void staging.refresh(); }}>Refresh</button></div><div className="metrics"><Metric label="Import issues" value={String(rejected.length)} detail="Rejected or failed records" /><Metric label="Stale vehicle updates" value={String(stale.length)} detail="No update in 30 minutes" /><Metric label="Review queue" value={String(staging.data?.filter(item => stagingStatus(item.status) === 'PendingReview').length || 0)} detail="Needs planner decision" /><Metric label="Fleet vehicles" value={String(fleet.data?.vehicleCount || 0)} detail="Master data plus telemetry status" /></div><State loading={staging.loading} error={staging.error} empty={!rejected.length && !stale.length}><div className="exception-list">{rejected.map(item => <article key={item.id}><strong>Import {statusClass(item.status)}</strong><span>{item.entityType} · {item.source || 'Unknown source'}</span><small>{formatDate(item.receivedAtUtc)}</small></article>)}{stale.map(vehicle => <article key={vehicle.vehicleId}><strong>Tracking update overdue</strong><span>{vehicle.registration} · {fleetConditionLabel(vehicle.condition)}</span><small>{formatDate(vehicle.lastEventTimeUtc)}</small></article>)}</div></State></section>; }

export function Reporting() { const token = useAccessToken(); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const staging = useApi(useCallback(async () => api.staging(await token(), ''), [token])); const loads = useApi(useCallback(async () => listRuns(date, await token()), [date, token])); const promoted = staging.data?.filter(item => stagingStatus(item.status) === 'Promoted').length || 0; const pending = staging.data?.filter(item => stagingStatus(item.status) === 'PendingReview').length || 0; const reportLoads = loads.data || []; const allocated = reportLoads.filter(load => load.driverId && load.vehicleId).length; const dispatched = reportLoads.filter(load => load.status === 'Dispatched' || load.status === 'InProgress').length; const completed = reportLoads.filter(load => load.status === 'Completed').length; function exportDay() { const rows = [['Load', 'Status', 'Driver allocated', 'Vehicle allocated', 'Trailer allocated', 'Stops'], ...reportLoads.map(load => [load.reference, load.status, load.driverId ? 'Yes' : 'No', load.vehicleId ? 'Yes' : 'No', load.trailerId ? 'Yes' : 'No', String(load.stops.length)])]; const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `slh-daily-control-${date}.csv`; link.click(); URL.revokeObjectURL(link.href); } return <section><div className="title-row"><div><p className="eyebrow">Operations insight</p><h1>Daily control report</h1></div><button onClick={exportDay} disabled={!reportLoads.length}>Export day CSV</button></div><div className="report-toolbar"><label>Planning date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>Shows saved loads and their operational lifecycle for the selected day.</span></div><State loading={staging.loading || loads.loading} error={staging.error || loads.error}><div className="metrics"><Metric label="Loads planned" value={String(reportLoads.length)} detail={`For ${date}`} /><Metric label="Fleet allocated" value={String(allocated)} detail="Driver and vehicle assigned" /><Metric label="On the road" value={String(dispatched)} detail="Dispatched or in progress" /><Metric label="Completed" value={String(completed)} detail="Marked completed" /></div><div className="report-breakdown"><article><h2>Planning readiness</h2><p><strong>{Math.max(reportLoads.length - allocated, 0)}</strong> load{reportLoads.length - allocated === 1 ? '' : 's'} still need a driver or vehicle.</p><p><strong>{pending}</strong> import{pending === 1 ? '' : 's'} await staging review; <strong>{promoted}</strong> have been promoted.</p></article><article><h2>Load status</h2>{['Draft', 'Planned', 'Dispatched', 'InProgress', 'Completed', 'Cancelled'].map(status => <div className="status-line" key={status}><span>{status === 'InProgress' ? 'In progress' : status}</span><strong>{reportLoads.filter(load => load.status === status).length}</strong></div>)}</article></div></State></section>; }

function normaliseTableValue(value: unknown) { if (value === true) return 'Yes'; if (value === false) return 'No'; return value == null || value === '' ? '—' : String(value); }
function MasterValidation({ issues }: { issues: string[] }) { return <div className={issues.length ? 'master-validation warning' : 'master-validation'}><strong>{issues.length ? `${issues.length} validation item${issues.length === 1 ? '' : 's'} to fix` : 'No obvious validation issues'}</strong>{issues.length ? <ul>{issues.slice(0, 8).map(issue => <li key={issue}>{issue}</li>)}</ul> : <span>Records loaded cleanly from the live cloud master data.</span>}</div>; }
function MasterTable<T>({ rows, columns, rowKey }: { rows: T[]; columns: Array<[string, (row: T) => unknown]>; rowKey: (row: T) => string }) { return <div className="master-table-wrap"><table className="master-table"><thead><tr>{columns.map(([label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(([label, value]) => <td key={label}>{normaliseTableValue(value(row))}</td>)}</tr>)}</tbody></table></div>; }

export function DriversMaster() {
  const token = useAccessToken(); const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const rows = drivers.data || [];
  const issues = rows.flatMap(driver => [!driver.employeeNumber ? `${driver.displayName || 'Driver'} missing employee number for Sage alignment.` : '', !driver.mobileNumber ? `${driver.displayName} missing driver text mobile.` : '', !driver.tachoName ? `${driver.displayName} missing Tacho name.` : ''].filter(Boolean));
  return <section><div className="title-row"><div><p className="eyebrow">Master data</p><h1>Drivers</h1></div><button onClick={() => void drivers.refresh()}>Refresh</button></div><p className="intro">One live row per driver. Sage and TachoMaster should sync into this page so employee numbers, tacho names, mobile numbers and planning priority stay together.</p><MasterValidation issues={issues} /><MasterWorkbookImport mode="drivers" onApplied={drivers.refresh} /><State loading={drivers.loading} error={drivers.error} empty={!rows.length}><MasterTable rows={rows} rowKey={row => row.id} columns={[["Employee", row => row.employeeNumber], ["Driver", row => row.displayName], ["Tacho name", row => row.tachoName], ["Phone number", row => row.mobileNumber], ["Driver type", row => row.driverType], ["Driver group", row => row.driverGroup], ["Skills", row => row.skills], ["Active", row => row.active]]} /></State><DriverQuickAdd onSaved={drivers.refresh} /></section>;
}
function DriverQuickAdd({ onSaved }: { onSaved: () => void }) { const token = useAccessToken(); const [form, setForm] = useState({ employeeNumber: '', displayName: '', tachoName: '', mobileNumber: '', driverType: '', driverGroup: '', skills: '' }); const [message, setMessage] = useState<string>(); const [saving, setSaving] = useState(false); const update = (name: keyof typeof form, value: string) => setForm(current => ({ ...current, [name]: value })); async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { await api.stageRecord('driver', { ...form, active: true }, `web-driver:${form.employeeNumber}`, await token()); setMessage('Driver sent to staging review.'); setForm({ employeeNumber: '', displayName: '', tachoName: '', mobileNumber: '', driverType: '', driverGroup: '', skills: '' }); onSaved(); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Driver could not be saved.'); } finally { setSaving(false); } } return <form className="quick-order master-edit-form" onSubmit={event => void submit(event)}><h2>Add or update driver</h2><div className="field-grid"><label>Employee number<input required value={form.employeeNumber} onChange={event => update('employeeNumber', event.target.value)} /></label><label>Display name<input required value={form.displayName} onChange={event => update('displayName', event.target.value)} /></label><label>Tacho name<input value={form.tachoName} onChange={event => update('tachoName', event.target.value)} /></label><label>Driver text mobile<input value={form.mobileNumber} onChange={event => update('mobileNumber', event.target.value)} /></label><label>Driver type<input value={form.driverType} onChange={event => update('driverType', event.target.value)} /></label><label>Driver group<input value={form.driverGroup} onChange={event => update('driverGroup', event.target.value)} /></label><label className="wide">Skills / notes<input value={form.skills} onChange={event => update('skills', event.target.value)} /></label></div><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Send driver for review'}</button>{message && <p className="hint">{message}</p>}</form>; }

export function FleetAssetsMaster() {
  const token = useAccessToken(); const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token])); const trailers = useApi(useCallback(async () => api.trailers(await token()), [token])); const fleetio = useApi(useCallback(async () => api.fleetioVehicleAlignment(await token()), [token]));
  const vehicleRows = vehicles.data || []; const trailerRows = trailers.data || [];
  const issues = [...vehicleRows.flatMap(vehicle => [!vehicle.abbreviation ? `${vehicle.registration} missing abbreviation for RoadTech matching.` : ''].filter(Boolean)), ...trailerRows.flatMap(trailer => [!trailer.standardCapacity ? `Trailer ${trailer.trailerNumber} missing standard capacity.` : '', !trailer.euroCapacity ? `Trailer ${trailer.trailerNumber} missing Euro capacity.` : ''].filter(Boolean)), ...(fleetio.data?.records || []).flatMap(record => record.status === 'Matched' ? [] : [`Fleetio alignment: ${record.tmsRegistration || record.fleetioRegistration || record.fleetioName} is ${record.status}.`])];
  const refreshAll = () => { void vehicles.refresh(); void trailers.refresh(); void fleetio.refresh(); };
  return <section><div className="title-row"><div><p className="eyebrow">Master data</p><h1>Vehicles & trailers</h1></div><button onClick={refreshAll}>Refresh</button></div><p className="intro">This is the editable fleet reference list used for RoadTech matching, trailer capacity checks and Fleetio service/VOR alignment. Fuel PINs and full card numbers are held outside this portal.</p><MasterValidation issues={issues} /><MasterWorkbookImport mode="vehicles" onApplied={refreshAll} /><FleetioAlignmentPanel data={fleetio.data} loading={fleetio.loading} error={fleetio.error} onRefresh={fleetio.refresh} /><State loading={vehicles.loading || trailers.loading} error={vehicles.error || trailers.error}><h2 className="master-subtitle">Vehicles</h2><EditableVehicleTable rows={vehicleRows} onSaved={refreshAll} /><h2 className="master-subtitle">Trailers</h2><MasterTable rows={trailerRows} rowKey={row => row.id} columns={[["Trailer", row => row.trailerNumber], ["Type", row => row.type], ["Standard capacity", row => row.standardCapacity], ["Euro capacity", row => row.euroCapacity], ["Active", row => row.active]]} /></State><FleetQuickAdd onSaved={refreshAll} /></section>;
}
function EditableVehicleTable({ rows, onSaved }: { rows: Vehicle[]; onSaved: () => void }) {
  const token = useAccessToken();
  const [editing, setEditing] = useState<Record<string, Vehicle>>({});
  const [message, setMessage] = useState<string>();
  const startEdit = (row: Vehicle) => setEditing(current => ({ ...current, [row.id]: { ...row } }));
  const update = (id: string, field: keyof Vehicle, value: string | boolean) => setEditing(current => ({ ...current, [id]: { ...current[id], [field]: value } }));
  const cancel = (id: string) => setEditing(current => { const next = { ...current }; delete next[id]; return next; });
  async function save(row: Vehicle) {
    const draft = editing[row.id];
    if (!draft) return;
    try {
      await api.updateVehicle(row.id, { registration: draft.registration, fleetNumber: draft.fleetNumber, abbreviation: draft.abbreviation, transmission: draft.transmission, dvsCompliant: draft.dvsCompliant, fuelProvider: draft.fuelProvider, cabMobile: draft.cabMobile, notes: draft.notes, fuelPinSecretName: draft.fuelPinSecretName, fuelCardLastFour: draft.fuelCardLastFour, active: draft.active }, await token());
      cancel(row.id);
      setMessage(`${draft.registration} updated.`);
      onSaved();
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Vehicle could not be updated.'); }
  }
  return <div><div className="master-table-wrap"><table className="master-table editable-master-table"><thead><tr><th>Registration</th><th>Fleet number</th><th>Abbreviation</th><th>Transmission</th><th>DVS</th><th>Cab Mobile</th><th>Fuel provider</th><th>Card suffix</th><th>Notes</th><th>Active</th><th>Actions</th></tr></thead><tbody>{rows.map(row => { const draft = editing[row.id]; const current = draft || row; return <tr key={row.id}><td>{draft ? <input value={current.registration} onChange={event => update(row.id, 'registration', event.target.value)} /> : <button className="link-button" onClick={() => startEdit(row)}>{row.registration}</button>}</td><td>{draft ? <input value={current.fleetNumber || ''} onChange={event => update(row.id, 'fleetNumber', event.target.value)} /> : normaliseTableValue(row.fleetNumber)}</td><td>{draft ? <input value={current.abbreviation || ''} onChange={event => update(row.id, 'abbreviation', event.target.value)} /> : normaliseTableValue(row.abbreviation)}</td><td>{draft ? <input value={current.transmission || ''} onChange={event => update(row.id, 'transmission', event.target.value)} /> : normaliseTableValue(row.transmission)}</td><td>{draft ? <input type="checkbox" checked={Boolean(current.dvsCompliant)} onChange={event => update(row.id, 'dvsCompliant', event.target.checked)} /> : normaliseTableValue(row.dvsCompliant)}</td><td>{draft ? <input value={current.cabMobile || ''} onChange={event => update(row.id, 'cabMobile', event.target.value)} /> : normaliseTableValue(row.cabMobile)}</td><td>{draft ? <input value={current.fuelProvider || ''} onChange={event => update(row.id, 'fuelProvider', event.target.value)} /> : normaliseTableValue(row.fuelProvider)}</td><td>{draft ? <input value={current.fuelCardLastFour || ''} onChange={event => update(row.id, 'fuelCardLastFour', event.target.value.replace(/[^0-9]/g, '').slice(-4))} /> : normaliseTableValue(row.fuelCardLastFour ? `•••• ${row.fuelCardLastFour}` : undefined)}</td><td>{draft ? <input value={current.notes || ''} onChange={event => update(row.id, 'notes', event.target.value)} /> : normaliseTableValue(row.notes)}</td><td>{draft ? <input type="checkbox" checked={current.active} onChange={event => update(row.id, 'active', event.target.checked)} /> : normaliseTableValue(row.active)}</td><td>{draft ? <span className="table-actions"><button className="primary" onClick={() => void save(row)}>Save</button><button onClick={() => cancel(row.id)}>Cancel</button></span> : <button onClick={() => startEdit(row)}>Edit</button>}</td></tr>; })}</tbody></table></div>{message && <p className="hint">{message}</p>}</div>;
}
function FleetioAlignmentPanel({ data, loading, error, onRefresh }: { data?: import('../lib/api').FleetioVehicleAlignment; loading: boolean; error?: string; onRefresh: () => void }) { if (loading) return <div className="panel fleetio-panel"><strong>Checking Fleetio vehicle alignment…</strong></div>; if (error) return <p className="notice inline-notice">Fleetio alignment could not refresh: {error}</p>; if (!data) return null; return <div className="panel fleetio-panel"><div><p className="eyebrow">Fleetio alignment</p><h2>{data.connected ? `${data.matched} matched · ${data.missingInFleetio} missing · ${data.unmatchedFleetio} Fleetio-only` : 'Fleetio setup needed'}</h2><p>{data.message}</p>{Boolean(data.missingSettings?.length) && <small>{data.missingSettings?.join(', ')}</small>}</div><button onClick={() => void onRefresh()}>Refresh Fleetio</button>{data.records.length > 0 && <div className="master-table-wrap fleetio-table"><table className="master-table"><thead><tr><th>Status</th><th>TMS registration</th><th>Fleetio registration</th><th>Fleetio name</th><th>Fleetio status</th></tr></thead><tbody>{data.records.slice(0, 25).map((row, index) => <tr key={`${row.status}-${row.tmsRegistration || row.fleetioRegistration || index}`}><td><span className={`status ${row.status.toLowerCase()}`}>{row.status}</span></td><td>{row.tmsRegistration || '—'}</td><td>{row.fleetioRegistration || '—'}</td><td>{row.fleetioName || '—'}</td><td>{row.fleetioStatus || '—'}</td></tr>)}</tbody></table></div>}</div>; }
function FleetQuickAdd({ onSaved }: { onSaved: () => void }) { const token = useAccessToken(); const [entity, setEntity] = useState<'vehicle' | 'trailer'>('vehicle'); const [first, setFirst] = useState(''); const [second, setSecond] = useState(''); const [third, setThird] = useState(''); const [message, setMessage] = useState<string>(); const [saving, setSaving] = useState(false); async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { const payload = entity === 'vehicle' ? { registration: first, fleetNumber: second, abbreviation: third, active: true } : { trailerNumber: first, type: second, standardCapacity: third ? Number(third) : undefined, active: true }; await api.stageRecord(entity, payload, `web-${entity}:${first}`, await token()); setMessage(`${entity} sent to staging review.`); setFirst(''); setSecond(''); setThird(''); onSaved(); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Record could not be saved.'); } finally { setSaving(false); } } return <form className="quick-order master-edit-form" onSubmit={event => void submit(event)}><h2>Add or update fleet record</h2><div className="field-grid"><label>Type<select value={entity} onChange={event => setEntity(event.target.value as 'vehicle' | 'trailer')}><option value="vehicle">Vehicle</option><option value="trailer">Trailer</option></select></label><label>{entity === 'vehicle' ? 'Registration' : 'Trailer number'}<input required value={first} onChange={event => setFirst(event.target.value)} /></label><label>{entity === 'vehicle' ? 'VehicleID' : 'Type'}<input value={second} onChange={event => setSecond(event.target.value)} /></label><label>{entity === 'vehicle' ? 'Abbreviation' : 'Standard capacity'}<input value={third} onChange={event => setThird(event.target.value)} /></label></div><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Send for review'}</button>{message && <p className="hint">{message}</p>}</form>; }

export function MarketsMaster() { const token = useAccessToken(); const contacts = useApi(useCallback(async () => api.marketContacts(await token()), [token])); const rows = contacts.data || []; const issues = rows.flatMap(contact => [!contact.standOrLocation && contact.market !== 'Sender' ? `${contact.market} / ${contact.name} missing stall or stand.` : '', !contact.salesman && contact.market !== 'Sender' ? `${contact.market} / ${contact.name} missing salesman.` : ''].filter(Boolean)); const grouped = ['Covent', 'Spit', 'Western', 'Sender'].map(market => [market, rows.filter(row => row.market === market)] as const); return <section><div className="title-row"><div><p className="eyebrow">Master data</p><h1>Markets & senders</h1></div><button onClick={() => void contacts.refresh()}>Refresh</button></div><p className="intro">Market orders use this list for Covent, Spit and Western sellers, stall details, salesman and sender dropdowns.</p><MasterValidation issues={issues} /><MasterWorkbookImport mode="markets" onApplied={contacts.refresh} /><State loading={contacts.loading} error={contacts.error} empty={!rows.length}>{grouped.map(([market, marketRows]) => <div className="market-section" key={market}><h2>{market}</h2><MasterTable rows={marketRows} rowKey={row => row.id} columns={[[market === 'Sender' ? 'Sender' : 'Seller', row => row.name], ["Stall / stand", row => row.standOrLocation], ["Salesman", row => row.salesman], ["Sender", row => row.sender], ["Active", row => row.active]]} /></div>)}</State><MarketQuickAdd onSaved={contacts.refresh} /></section>; }
function MarketQuickAdd({ onSaved }: { onSaved: () => void }) { const token = useAccessToken(); const [form, setForm] = useState({ market: 'Covent', name: '', standOrLocation: '', salesman: '', sender: '' }); const [message, setMessage] = useState<string>(); const [saving, setSaving] = useState(false); const update = (name: keyof typeof form, value: string) => setForm(current => ({ ...current, [name]: value })); async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { await api.stageRecord('marketcontact', { ...form, active: true }, `web-market:${form.market}:${form.name}`, await token()); setMessage('Market record sent to staging review.'); setForm({ market: 'Covent', name: '', standOrLocation: '', salesman: '', sender: '' }); onSaved(); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Market record could not be saved.'); } finally { setSaving(false); } } return <form className="quick-order master-edit-form" onSubmit={event => void submit(event)}><h2>Add market seller or sender</h2><div className="field-grid"><label>Market<select value={form.market} onChange={event => update('market', event.target.value)}><option>Covent</option><option>Spit</option><option>Western</option><option>Sender</option></select></label><label>{form.market === 'Sender' ? 'Sender' : 'Seller'}<input required value={form.name} onChange={event => update('name', event.target.value)} /></label><label>Stall / stand<input value={form.standOrLocation} onChange={event => update('standOrLocation', event.target.value)} /></label><label>Salesman<input value={form.salesman} onChange={event => update('salesman', event.target.value)} /></label><label>Sender<input value={form.sender} onChange={event => update('sender', event.target.value)} /></label></div><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Send for review'}</button>{message && <p className="hint">{message}</p>}</form>; }

export function FuelMaster() {
  const token = useAccessToken();
  const prices = useApi(useCallback(async () => api.fuelPrices(await token()), [token]));
  const [adding, setAdding] = useState(false);
  const rows = prices.data || [];
  const latest = rows[0];
  const providers = new Set(rows.map(row => row.provider));
  const issues = rows.length ? [] : ['No fuel prices loaded yet. Add this week’s provider prices.'];
  return <section>
    <div className="title-row">
      <div><p className="eyebrow">Master data</p><h1>Fuel price history</h1></div>
      <div className="title-actions">
        <button onClick={() => void prices.refresh()}>Refresh</button>
        <MasterDataExportButton section="fuel-prices" label="Fuel prices" rows={(rows) as unknown as Record<string, unknown>[]} />
        <button className="primary" onClick={() => setAdding(true)}>Add fuel price</button>
      </div>
    </div>
    <p className="intro">Weekly fuel prices are canonical Master Data used for pricing history and trend reporting.</p>
    <MasterValidation issues={issues} />
    <div className="metrics">
      <Metric label="Latest week" value={latest?.weekCommencing || '—'} detail="Most recent upload" />
      <Metric label="Providers" value={String(providers.size)} detail="Tracked fuel suppliers" />
      <Metric label="History rows" value={String(rows.length)} detail="Stored in Azure SQL" />
      <Metric label="Pricing max" value={String(rows.find(row => row.isPricingMaximum)?.pricePencePerLitre ?? '—')} detail="Current max pence/litre" />
    </div>
    <State loading={prices.loading} error={prices.error}>
      <MasterTable rows={rows} rowKey={row => row.id} columns={[["Week commencing", row => row.weekCommencing], ["Provider", row => row.provider], ["Pence/litre", row => row.pricePencePerLitre], ["Pricing maximum", row => row.isPricingMaximum], ["Source", row => row.source], ["Notes", row => row.notes]]} />
    </State>
    {adding && <FuelPriceForm onSaved={prices.refresh} onClose={() => setAdding(false)} />}
  </section>;
}
function FuelPriceForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const token = useAccessToken();
  const [form, setForm] = useState({ weekCommencing: new Date().toISOString().slice(0, 10), provider: '', pricePencePerLitre: '', isPricingMaximum: false, notes: '' });
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      await api.saveFuelPrice({ weekCommencing: form.weekCommencing, provider: form.provider, pricePencePerLitre: Number(form.pricePencePerLitre), isPricingMaximum: form.isPricingMaximum, source: 'SLH TMS Web', notes: form.notes }, await token());
      setMessage('Fuel price saved to Master Data.');
      onSaved();
      onClose();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : 'Fuel price could not be saved.');
    } finally { setSaving(false); }
  }
  return <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Add fuel price Master Data" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form className="crm-modal" onSubmit={event => void submit(event)}>
      <div className="crm-modal-header"><div><p className="eyebrow">Fuel price Master Data</p><h2>Add weekly fuel price</h2></div><button type="button" disabled={saving} onClick={onClose}>Close</button></div>
      <div className="crm-modal-body"><section><h3>Price details</h3><div className="crm-form-grid">
        <label>Week commencing<input type="date" required value={form.weekCommencing} onChange={event => setForm(current => ({ ...current, weekCommencing: event.target.value }))} /></label>
        <label>Provider<input required value={form.provider} onChange={event => setForm(current => ({ ...current, provider: event.target.value }))} /></label>
        <label>Pence per litre<input required type="number" step="0.01" value={form.pricePencePerLitre} onChange={event => setForm(current => ({ ...current, pricePencePerLitre: event.target.value }))} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={form.isPricingMaximum} onChange={event => setForm(current => ({ ...current, isPricingMaximum: event.target.checked }))} /> Use as pricing maximum</label>
        <label style={{ gridColumn: '1 / -1' }}>Notes<textarea rows={4} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} /></label>
      </div></section>{message && <p className="notice inline-notice">{message}</p>}</div>
      <div className="crm-modal-actions"><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save Master Data record'}</button><button type="button" disabled={saving} onClick={onClose}>Cancel</button></div>
    </form>
  </div>;
}

export function SitesMaster() { const token = useAccessToken(); const sites = useApi(useCallback(async () => api.sites(await token()), [token])); const contacts = useApi(useCallback(async () => api.customerContacts(await token()), [token])); const siteRows = sites.data || []; const contactRows = contacts.data || []; const issues = [...siteRows.flatMap(site => [!site.collectionAddress ? `${site.name} missing address.` : '', !site.mapLink ? `${site.name} missing map link.` : ''].filter(Boolean)), ...contactRows.flatMap(contact => [contact.receivesEtaUpdates && !contact.email ? `${contact.customerCode} / ${contact.name} missing ETA email.` : ''].filter(Boolean))]; const refreshAll = () => { void sites.refresh(); void contacts.refresh(); }; return <section><div className="title-row"><div><p className="eyebrow">Master data</p><h1>Sites & contacts</h1></div><button onClick={refreshAll}>Refresh</button></div><p className="intro">All delivery and collection sites plus customer contacts for ETA updates and order communication.</p><MasterValidation issues={issues} /><MasterWorkbookImport mode="sites" onApplied={refreshAll} /><State loading={sites.loading || contacts.loading} error={sites.error || contacts.error}><h2 className="master-subtitle">Sites</h2><MasterTable rows={siteRows} rowKey={row => row.id} columns={[["Site", row => row.name], ["Driver text name", row => row.driverTextName], ["Address", row => row.collectionAddress], ["Map link", row => row.mapLink ? 'Yes' : 'No'], ["Instructions", row => row.collectionInstructions], ["Active", row => row.active]]} /><h2 className="master-subtitle">Customer contacts</h2><MasterTable rows={contactRows} rowKey={row => row.id} columns={[["Customer", row => row.customerCode], ["Contact", row => row.name], ["Email", row => row.email], ["Phone", row => row.mobileNumber], ["ETA updates", row => row.receivesEtaUpdates], ["Active", row => row.active]]} /></State><SiteSetupForm /></section>; }

export function MasterData() {
  const token = useAccessToken();
  const customers = useApi(useCallback(async () => api.customers(await token()), [token]));
  const customerContacts = useApi(useCallback(async () => api.customerContacts(await token()), [token]));
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const trailers = useApi(useCallback(async () => api.trailers(await token()), [token]));
  const sites = useApi(useCallback(async () => api.sites(await token()), [token]));
  const contacts = useApi(useCallback(async () => api.marketContacts(await token()), [token]));
  const diagnostics = useApi(useCallback(async () => api.diagnosticsTables(await token()), [token]));
  const errors = [customers.error, customerContacts.error, vehicles.error, drivers.error, trailers.error, sites.error, contacts.error, diagnostics.error].filter(Boolean);
  const loading = customers.loading || customerContacts.loading || vehicles.loading || drivers.loading || trailers.loading || sites.loading || contacts.loading || diagnostics.loading;
  const [linking, setLinking] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string>();
  async function linkRegistered() {
    setLinking(true);
    setLinkMessage(undefined);
    try {
      const result = await api.linkMasterRegister(await token());
      setLinkMessage(result.message);
      void Promise.all([customers.refresh(), customerContacts.refresh(), vehicles.refresh(), drivers.refresh(), trailers.refresh(), sites.refresh(), contacts.refresh(), diagnostics.refresh()]);
    } catch (exception) {
      setLinkMessage(exception instanceof Error ? exception.message : 'Registered master-data rows could not be linked.');
    } finally {
      setLinking(false);
    }
  }

  return <section><div className="title-row"><div><p className="eyebrow">Reference data</p><h1>Master data & CRM</h1></div><button onClick={() => void linkRegistered()} disabled={linking}>{linking ? 'Linking…' : 'Link registered rows'}</button></div>{linkMessage && <p className="notice inline-notice">{linkMessage}</p>}<MasterWorkbookImport /><CoreMasterDataForm /><SiteSetupForm />{errors.length > 0 && <p className="notice inline-notice">Some master-data lists could not refresh yet: {errors.join(' · ')}</p>}<MasterDataCounts diagnostics={diagnostics.data} /><State loading={loading} error={undefined}><div className="master-grid">
    <DataList title="Customers" data={customers.data} render={(item: Customer) => <><strong>{item.name}</strong><small>{item.code}</small></>} />
    <DataList title="Customer ETA contacts" data={customerContacts.data} render={(item: CustomerContact) => <><strong>{item.name}</strong><small>{item.customerCode} · {item.email || 'No ETA email'}{item.receivesEtaUpdates ? ' · ETA updates on' : ' · ETA updates off'}</small></>} />
    <DataList title="Vehicles" data={vehicles.data} render={(item: Vehicle) => <><strong>{item.registration}</strong><small>{item.fleetNumber || item.abbreviation || 'Fleet vehicle'}</small></>} />
    <DataList title="Drivers" data={drivers.data} render={(item: Driver) => <><strong>{item.displayName}</strong><small>{item.employeeNumber}{item.mobileNumber ? ` · ${item.mobileNumber}` : ' · Mobile number required'}</small></>} />
    <DataList title="Trailers" data={trailers.data} render={(item: Trailer) => <><strong>{item.trailerNumber}</strong><small>{item.type || 'Trailer'}</small></>} />
    <DataList title="Sites" data={sites.data} render={(item: Site) => <><strong>{item.name}</strong><small>{item.externalCode} {item.collectionAddress ? `· ${item.collectionAddress}` : ''}</small></>} />
    <DataList title="Market contacts" data={contacts.data} render={(item: MarketContact) => <><strong>{item.name}</strong><small>{item.market}{item.standOrLocation ? ` · ${item.standOrLocation}` : ''}</small></>} />
  </div></State></section>;
}
function MasterDataCounts({ diagnostics }: { diagnostics?: DiagnosticsTables }) {
  const cards = [
    ['Customers', diagnostics?.customers],
    ['Customer contacts', diagnostics?.customerContacts],
    ['Drivers', diagnostics?.drivers],
    ['Vehicles', diagnostics?.vehicles],
    ['Sites', diagnostics?.sites],
    ['Market contacts', diagnostics?.marketContacts]
  ] as const;
  return <div className="master-counts">{cards.map(([label, value]) => <article key={label} className={value?.ok === false ? 'error' : ''}><span>{label}</span><strong>{value?.ok === false ? '!' : value?.count ?? '—'}</strong>{value?.error && <small>{value.error}</small>}</article>)}</div>;
}

type MasterEntity = 'customer' | 'customercontact' | 'vehicle' | 'driver' | 'trailer' | 'marketcontact';
type MasterImportMode = 'all' | 'drivers' | 'vehicles' | 'trailers' | 'sites' | 'markets' | 'contacts' | 'fuel';
function MasterWorkbookImport({ mode = 'all', onApplied }: { mode?: MasterImportMode; onApplied?: () => void }) {
  const token = useAccessToken();
  const [workbook, setWorkbook] = useState<XLSX.WorkBook>();
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [records, setRecords] = useState<StageBatchRequest[]>([]);
  const [summary, setSummary] = useState<string>();
  const [issues, setIssues] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function prepare(nextWorkbook: XLSX.WorkBook, nextSheet: string) {
    const scopedWorkbook = nextSheet ? ({ SheetNames: [nextSheet], Sheets: { [nextSheet]: nextWorkbook.Sheets[nextSheet] } } as XLSX.WorkBook) : nextWorkbook;
    const mapped = filterMasterRecords(mapMasterWorkbook(scopedWorkbook), mode);
    const importRun = Date.now().toString(36);
    setRecords(mapped.records.map((record, index) => ({ ...record, idempotencyKey: scopedImportKey(record, importRun, index) })));
    setIssues(mapped.issues);
    const scope = mode === 'all' ? 'master-data' : mode;
    setSummary(`${mapped.records.length} ${scope} record${mapped.records.length === 1 ? '' : 's'} found${nextSheet ? ` from ${nextSheet}` : ''}: ${summariseBatch(mapped.records) || 'nothing recognised'}. If this count is wrong, choose a different sheet before applying.`);
  }

  async function selectWorkbook(file?: File) {
    if (!file) return;
    setSummary(undefined); setIssues([]); setRecords([]);
    try {
      const nextWorkbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const nextSheet = preferredSheet(nextWorkbook, mode);
      setWorkbook(nextWorkbook);
      setSheetNames(nextWorkbook.SheetNames);
      setSelectedSheet(nextSheet);
      prepare(nextWorkbook, nextSheet);
    } catch {
      setSummary('The master-data workbook could not be read.');
    }
  }

  function changeSheet(nextSheet: string) {
    setSelectedSheet(nextSheet);
    if (workbook) prepare(workbook, nextSheet);
  }

  async function submit() {
    setSubmitting(true);
    try {
      const accessToken = await token();
      const response = await api.applyMasterData(records, accessToken);
      const applied = response.applied;
      const registered = response.results.filter(result => result.registered).length;
      const failures = response.results.filter(result => !result.applied).slice(0, 20).map(result => `${result.entityType}: ${result.error || 'record failed'}`);
      const attempted = records.length;
      const linked = response.linked || 0;
      const waiting = Math.max(0, registered - linked);
      setSummary(`${applied}/${attempted} master-data records accepted by the live cloud register${linked ? ` (${linked} linked into SQL tables)` : ''}${waiting ? ` (${waiting} still waiting to link into SQL tables)` : ''}.${failures.length ? ` ${failures.length} issue${failures.length === 1 ? '' : 's'}: ${failures.slice(0, 12).join('; ')}` : ''}`);
      if (!failures.length) setRecords([]);
      onApplied?.();
    } catch (exception) {
      setSummary(exception instanceof Error ? exception.message : 'Master-data import failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === 'all' ? 'Import master-data workbook' : `Import ${mode}`;
  return <div className="panel import-panel master-import"><h2>{title}</h2><p>{mode === 'all' ? 'Upload the Transport Operations master workbook to update live drivers, vehicles, trailers, sites, market sellers and ETA contacts in the cloud master data.' : 'Upload the workbook here, choose the correct sheet, and this tab will only apply the matching records.'}</p><input type="file" accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={event => void selectWorkbook(event.target.files?.[0])} />{sheetNames.length > 0 && <label className="sheet-picker">Sheet to read<select value={selectedSheet} onChange={event => changeSheet(event.target.value)}>{mode === 'all' && <option value="">All sheets</option>}{sheetNames.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label>}<p className="hint">Planner order is retained from Driver Type and Driver Group: full-time drivers first, then casual, LTD and agency. This applies directly to the live cloud master data.</p>{summary && <p className="notice inline-notice">{summary}</p>}{issues.length > 0 && <div className="import-issues"><strong>Import notes</strong><ul>{issues.slice(0, 12).map(issue => <li key={issue}>{issue}</li>)}</ul>{issues.length > 12 && <small>{issues.length - 12} more notes hidden.</small>}</div>}{records.length > 0 && <button className="primary" disabled={submitting} onClick={() => void submit()}>{submitting ? 'Applying...' : `Apply ${records.length} records to Master Data`}</button>}</div>;
}

function preferredSheet(workbook: XLSX.WorkBook, mode: MasterImportMode) {
  if (mode === 'all') return '';
  const hints: Record<Exclude<MasterImportMode, 'all'>, string[]> = {
    drivers: ['drivers', 'driver', 'rota', 'employee'],
    vehicles: ['vehiclesfuel', 'vehicles', 'cabphone', 'fuel', 'fleet'],
    trailers: ['trailers', 'trailer'],
    sites: ['sites', 'site', 'crm', 'contacts', 'customers'],
    markets: ['covent', 'spit', 'spitalfields', 'western', 'market'],
    contacts: ['contacts', 'crm', 'customer'],
    fuel: ['fuelprice', 'fuelprices', 'fueltrend']
  };
  return workbook.SheetNames.find(sheet => hints[mode].some(hint => normaliseHeader(sheet).includes(hint))) || workbook.SheetNames[0] || '';
}

function filterMasterRecords(mapped: { records: StageBatchRequest[]; issues: string[] }, mode: MasterImportMode) {
  if (mode === 'all') return mapped;
  const allowed: Record<Exclude<MasterImportMode, 'all'>, string[]> = {
    drivers: ['driver'],
    vehicles: ['vehicle', 'trailer'],
    trailers: ['trailer'],
    sites: ['site', 'customer', 'customercontact'],
    markets: ['marketcontact'],
    contacts: ['customer', 'customercontact'],
    fuel: ['fuelprice']
  };
  const records = mapped.records.filter(record => allowed[mode].includes(record.entityType));
  const issues = mapped.issues.filter(issue => records.length === 0 || !/No (driver|vehicle) rows recognised/i.test(issue));
  return { records, issues };
}

function mapMasterWorkbook(workbook: XLSX.WorkBook): { records: StageBatchRequest[]; issues: string[] } {
  const issues: string[] = [];
  const records: StageBatchRequest[] = [];
  const add = (entityType: string, key: string, payload: StageBatchRequest['payload']) => {
    const normalKey = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!normalKey) return;
    const idempotencyKey = `master:${entityType}:${normalKey}`;
    const existingIndex = records.findIndex(record => record.idempotencyKey === idempotencyKey);
    const record = { entityType, idempotencyKey, source: 'SLH Transport Operations Master Data workbook', payload };
    if (existingIndex >= 0) records[existingIndex] = record;
    else records.push(record);
  };
  const active = (row: SheetRow) => {
    const value = text(read(row, 'Active') || read(row, 'Status') || 'Yes').toLowerCase();
    return !['no', 'n', 'false', 'inactive', 'terminated', 'left', 'leaver', 'deleted'].includes(value);
  };

  const driverRows = driverSheetRows(workbook);
  const vehicleRows = vehicleSheetRows(workbook);
  const trailerRows = sheetRows(workbook, ['Trailers', 'Trailer Master'], ['Trailer', 'Type', 'Standard Capacity']);
  const siteRows = sheetRows(workbook, ['Sites', 'Site Master', 'Customers', 'Collections', 'Site Contacts'], ['SiteID', 'Site', 'Collection Address', 'Customer', 'Name']);
  const contactRows = sheetRows(workbook, ['Customer Contacts', 'CRM', 'Contacts', 'Customers', 'Site Contacts'], ['Customer', 'Contact Name', 'Name', 'Email', 'E-mail']);

  for (const row of driverRows) {
    const displayName = driverDisplayName(row);
    const employeeNumber = firstText(row, ['DriverID', 'Driver ID', 'Employee Number', 'Employee No', 'EmployeeNumber', 'Payroll Number', 'Payroll No', 'Sage Employee Number', 'Sage ID', 'Employee ID', 'Emp No']) || driverKey(displayName);
    if (!employeeNumber || !displayName || !active(row)) continue;
    add('driver', employeeNumber, { employeeNumber, displayName, tachoName: firstText(row, ['Tacho Name', 'TachoName']), mobileNumber: normalisePhone(firstText(row, ['Phone Number', 'Mobile Number', 'Mobile', 'Driver Phone', 'Text Number'])), driverType: firstText(row, ['Driver Type', 'Employment Type', 'Type']) || 'Full Time', driverGroup: firstText(row, ['Driver Group', 'Group', 'Agency', 'Planner Group']), skills: firstText(row, ['Driver Skills', 'Skills', 'Licence', 'Licence Type']), active: true });
  }
  for (const row of vehicleRows) {
    const registration = firstText(row, ['Registration', 'Reg', 'Reg No', 'Registration Number', 'Vehicle Registration', 'Vehicle Reg', 'Number Plate', 'Plate'])
      .replace(/\s+/g, '').toUpperCase();
    if (!registration || !active(row)) continue;
    // Do not upload fuel PINs or full card numbers from operational workbooks.
    // Secret values belong in the runtime secret store, outside the browser and Git.
    add('vehicle', registration, { registration, fleetNumber: firstText(row, ['VehicleID', 'Vehicle ID', 'Fleet Number', 'Fleet No']), abbreviation: firstText(row, ['Abbreviation', 'Short Reg', 'Reg Last 3']) || registration.slice(-3), transmission: firstText(row, ['Transmission', 'Gearbox']), dvsCompliant: yesNo(read(row, 'DVS') || read(row, 'DVS Compliant')), fuelProvider: bestFuelProvider(row), cabMobile: normalisePhone(firstText(row, ['Cab Mobile', 'Cab Phone', 'Cab Phone Number', 'Cab Telephone', 'Mobile', 'Phone'])), notes: firstText(row, ['Notes', 'Comments']), active: true });
  }
  for (const row of trailerRows) {
    const trailerNumber = text(read(row, 'Trailer'));
    if (!trailerNumber || !active(row)) continue;
    add('trailer', trailerNumber, { trailerNumber, type: text(read(row, 'Type')), standardCapacity: numberValue(read(row, 'Standard Capacity')), euroCapacity: numberValue(read(row, 'Euro Capacity')), active: true });
  }
  for (const row of siteRows) {
    const externalCode = firstText(row, ['SiteID', 'Site ID', 'Site', 'Site Name', 'Customer Code', 'Customer', 'Account Code', 'Code']);
    const name = firstText(row, ['Site', 'Site Name', 'Customer Name', 'Name', 'Collection Site']);
    if (!externalCode || !name || !active(row)) continue;
    add('customer', externalCode, { code: externalCode, name, active: true });
    add('site', externalCode, { externalCode, name, driverTextName: text(read(row, 'Driver Text Name')) || name, collectionAddress: text(read(row, 'Collection Address')), collectionInstructions: text(read(row, 'Collection Notes / Instructions')), mapLink: text(read(row, 'Map Link')), active: true });
  }
  for (const row of contactRows) {
    const customerCode = firstText(row, ['Customer', 'Customer Code', 'SiteID', 'Site ID', 'Account Code', 'Code']);
    const customerName = firstText(row, ['Customer Name', 'Site Name', 'Customer', 'Site', 'Account Name']) || customerCode;
    const name = firstText(row, ['Contact Name', 'Contact', 'Name', 'Site Contact']) || customerName;
    const email = firstText(row, ['Email', 'E-mail', 'Email Address', 'ETA Email']);
    if (!customerCode || !name || !active(row)) continue;
    add('customer', customerCode, { code: customerCode, name: customerName, active: true });
    add('customercontact', `${customerCode}-${name}-${email}`, { customerCode, customerName, name, email, mobileNumber: normalisePhone(firstText(row, ['Phone', 'Mobile', 'Mobile Number', 'Telephone'])), receivesEtaUpdates: Boolean(email), active: true });
  }
  records.push(...marketContactRecords(workbook));
  records.push(...fuelPriceRecords(workbook));
  if (!driverRows.length) issues.push('No driver rows recognised. Check the workbook has DriverID/Driver headings.');
  if (!vehicleRows.length) issues.push('No vehicle rows recognised. Check the workbook has Registration headings.');
  return { records, issues };
}

function sheetRows(workbook: XLSX.WorkBook, names: string[], requiredHeaders: string[]): SheetRow[] {
  const candidateSheets = matchingSheets(workbook, names);
  const wanted = requiredHeaders.map(normaliseHeader);
  const minimumMatches = wanted.length > 1 ? 2 : 1;
  const result: SheetRow[] = [];
  for (const candidate of candidateSheets) {
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | undefined>>(workbook.Sheets[candidate], { header: 1, defval: '', blankrows: false });
    const headerIndex = rows.findIndex(row => {
      const headers = row.map(normaliseHeader);
      return wanted.filter(header => headers.includes(header)).length >= minimumMatches;
    });
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(value => text(value));
    result.push(...rows.slice(headerIndex + 1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])) as SheetRow).filter(row => Object.values(row).some(value => text(value))));
  }
  return result;
}
function vehicleSheetRows(workbook: XLSX.WorkBook): SheetRow[] {
  const candidateSheets = matchingSheets(workbook, ['Vehicles & Fuel', 'Vehicles', 'Fleet', 'Cab Phone Numbers', 'Fuel', 'Vehicle Master']);
  const result: SheetRow[] = [];
  const registrationHeaders = new Set(['registration', 'reg', 'regno', 'registrationnumber', 'vehicleregistration', 'vehiclereg', 'numberplate', 'plate']);
  const vehicleContextHeaders = new Set(['vehicleid', 'fleetnumber', 'fleetno', 'abbreviation', 'transmission', 'dvs', 'dvscompliant', 'cabmobile', 'cabphone', 'cabphonenumber', 'fuelpin', 'fuelcardpin', 'shellcard', 'bpredcard', 'bpplaincard', 'fuelprovider']);
  for (const candidate of candidateSheets) {
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | undefined>>(workbook.Sheets[candidate], { header: 1, defval: '', blankrows: false });
    const headerIndex = rows.findIndex(row => {
      const headers = row.map(value => normaliseHeader(text(value)));
      const hasRegistration = headers.some(header => registrationHeaders.has(header));
      const contextMatches = headers.filter(header => vehicleContextHeaders.has(header)).length;
      return hasRegistration && (contextMatches > 0 || candidateSheets.length === 1);
    });
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(value => text(value));
    result.push(...rows.slice(headerIndex + 1)
      .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])) as SheetRow)
      .filter(row => Object.values(row).some(value => text(value)) && firstText(row, ['Registration', 'Reg', 'Reg No', 'Registration Number', 'Vehicle Registration', 'Vehicle Reg', 'Number Plate', 'Plate'])));
  }
  return result;
}
function driverSheetRows(workbook: XLSX.WorkBook): SheetRow[] {
  const candidateSheets = matchingSheets(workbook, ['Drivers', 'Driver Master', 'Driver List', 'Rota', 'Driver Rota', 'Employees', 'Master Data']);
  const result: SheetRow[] = [];
  for (const candidate of candidateSheets) {
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | undefined>>(workbook.Sheets[candidate], { header: 1, defval: '', blankrows: false });
    const headerIndex = rows.findIndex(row => driverHeaderScore(row) >= 2);
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(value => text(value));
    const mapped = rows.slice(headerIndex + 1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])) as SheetRow).filter(row => Object.values(row).some(value => text(value)));
    const usable = mapped.filter(row => driverDisplayName(row));
    result.push(...usable);
  }
  return result;
}
function driverHeaderScore(row: Array<string | number | boolean | Date | undefined>) {
  const headers = row.map(value => normaliseHeader(text(value)));
  const hasName = headers.some(header => ['driver', 'drivers', 'drivername', 'displayname', 'name', 'fullname', 'employeename'].includes(header));
  const hasEmployee = headers.some(header => ['driverid', 'employeeid', 'employeenumber', 'employeeno', 'empno', 'payrollnumber', 'payrollno', 'sageid', 'sageemployeenumber'].includes(header));
  const hasDriverContext = headers.some(header => ['tachoname', 'drivertype', 'employmenttype', 'drivergroup', 'mobile', 'mobilenumber', 'phonenumber'].includes(header));
  return Number(hasName) + Number(hasEmployee) + Number(hasDriverContext);
}
function matchingSheets(workbook: XLSX.WorkBook, names: string[]) {
  const normalisedNames = names.map(normaliseHeader);
  const matches = workbook.SheetNames.filter(sheet => normalisedNames.some(name => normaliseHeader(sheet) === name || normaliseHeader(sheet).includes(name) || name.includes(normaliseHeader(sheet))));
  return matches.length ? matches : workbook.SheetNames;
}
function marketContactRecords(workbook: XLSX.WorkBook): StageBatchRequest[] {
  const records: StageBatchRequest[] = [];
  const seen = new Set<string>();
  const addMarketContact = (source: string, market: string, sellerValue: string, salesmanValue?: string, senderValue?: string, palletsValue?: unknown) => {
    const parsed = parseSellerStand(sellerValue);
    if (!parsed.name || /^\d+$/.test(parsed.name) || ['total', 'totals', 'salesmen', 'salesman', 'seller', 'sellers'].includes(normaliseHeader(parsed.name))) return;
    const sender = text(senderValue);
    const salesman = text(salesmanValue) || parsed.name;
    const key = `master:marketcontact:${market}-${parsed.name}-${parsed.standOrLocation || ''}-${sender || salesman}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (seen.has(key)) return;
    seen.add(key);
    records.push({ entityType: 'marketcontact', idempotencyKey: key, source, payload: { market, name: parsed.name, standOrLocation: parsed.standOrLocation, salesman, sender, pallets: numberValue(palletsValue), active: true } });
  };
  for (const candidate of workbook.SheetNames) {
    const market = marketFromSheetName(candidate);
    if (!market) continue;
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | undefined>>(workbook.Sheets[candidate], { header: 1, defval: '', blankrows: false });
    const headerIndex = rows.findIndex(row => {
      const headings = row.map(value => normaliseHeader(text(value)));
      return headings.some(heading => ['salesmen', 'salesman', 'salesperson', 'seller', 'sellername', 'sellers', 'grower', 'vendor', 'name'].includes(heading)) && headings.includes('sender');
    });
    if (headerIndex < 0) continue;
    const headings = rows[headerIndex].map(value => normaliseHeader(text(value)));
    const sellerColumn = headings.findIndex(heading => ['seller', 'sellername', 'sellers', 'grower', 'vendor', 'name'].includes(heading));
    const salesmanColumn = headings.findIndex(heading => ['salesmen', 'salesman', 'salesperson'].includes(heading));
    const stallColumn = headings.findIndex(heading => ['stall', 'stallnumber', 'stand', 'standnumber', 'standlocation', 'location'].includes(heading));
    const palletsColumn = headings.findIndex(heading => ['pallets', 'pallet', 'plt', 'plts'].includes(heading));
    const senderColumn = headings.findIndex(heading => heading === 'sender');
    rows.slice(headerIndex + 1).forEach(row => {
      const sellerCell = text(row[sellerColumn >= 0 ? sellerColumn : salesmanColumn]);
      const stall = stallColumn >= 0 ? text(row[stallColumn]) : '';
      const sellerWithStall = sellerCell && stall && !sellerCell.includes(stall) ? `${sellerCell} (${stall})` : sellerCell;
      addMarketContact(`SLH ${candidate} market tab`, market, sellerWithStall, salesmanColumn >= 0 ? text(row[salesmanColumn]) : '', senderColumn >= 0 ? text(row[senderColumn]) : '', palletsColumn >= 0 ? row[palletsColumn] : undefined);
    });
  }
  const candidateSheets = matchingSheets(workbook, ['Market Contacts', 'Markets', 'Market Sellers', 'Market']);
  for (const candidate of candidateSheets) {
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | undefined>>(workbook.Sheets[candidate], { header: 1, defval: '', blankrows: false });
    const headerIndex = rows.findIndex(row => row.map(value => marketLabel(text(value))).some(label => ['Western', 'Spit', 'Covent'].includes(label)) || row.map(value => normaliseHeader(text(value))).includes('sender'));
    if (headerIndex < 0) continue;
    const headings = (rows[headerIndex] || []).map(value => text(value));
    const marketColumns = headings.flatMap((heading, index) => {
      const label = marketLabel(heading);
      return ['Western', 'Spit', 'Covent'].includes(label) ? [{ market: label, valueColumn: index, salesmanColumn: index + 1 }] : [];
    });
    const senderColumn = headings.findIndex(heading => normaliseHeader(heading) === 'sender');
    rows.slice(headerIndex + 1).forEach(row => {
      for (const item of marketColumns) {
        const sellerCell = text(row[item.valueColumn]);
        const salesman = text(row[item.salesmanColumn]);
        addMarketContact('SLH Transport Operations Master Data workbook', item.market, sellerCell, salesman);
      }
      if (senderColumn >= 0) {
        const sender = text(row[senderColumn]);
        if (sender) {
          const parsed = parseSellerStand(sender);
          const key = `master:marketcontact:Sender-${parsed.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          if (!seen.has(key)) {
            seen.add(key);
            records.push({ entityType: 'marketcontact', idempotencyKey: key, source: 'SLH Transport Operations Master Data workbook', payload: { market: 'Sender', name: parsed.name, standOrLocation: parsed.standOrLocation, active: true } });
          }
        }
      }
    });
  }
  return records;
}
function fuelPriceRecords(workbook: XLSX.WorkBook): StageBatchRequest[] {
  const rows = sheetRows(workbook, ['Fuel Price Updates', 'Fuel Price History', 'Fuel Trend Data', 'Fuel Prices'], ['Provider', 'PricePencePerLitre', 'WeekCommencing', 'Week Commencing', 'Price']);
  const records: StageBatchRequest[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const provider = firstText(row, ['Provider', 'Supplier', 'Fuel Provider', 'Card Provider']);
    const weekCommencing = dateText(read(row, 'WeekCommencing') || read(row, 'Week Commencing') || read(row, 'Date') || read(row, 'Week'));
    const pricePencePerLitre = numberValue(read(row, 'PricePencePerLitre') || read(row, 'Price Pence Per Litre') || read(row, 'Pence/Litre') || read(row, 'PPL') || read(row, 'Price'));
    if (!provider || !weekCommencing || pricePencePerLitre === undefined) continue;
    const idempotencyKey = `master:fuelprice:${provider}-${weekCommencing}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (seen.has(idempotencyKey)) continue;
    seen.add(idempotencyKey);
    records.push({ entityType: 'fuelprice', idempotencyKey, source: 'SLH Transport Operations Master Data workbook', payload: { provider, weekCommencing, pricePencePerLitre, isPricingMaximum: yesNo(read(row, 'IsPricingMaximum') || read(row, 'Pricing Maximum') || read(row, 'Max')), source: firstText(row, ['Source', 'Sheet']) || 'Master workbook', notes: firstText(row, ['Notes', 'Comment']), active: true } });
  }
  return records;
}
function parseSellerStand(value: string) { const match = value.match(/^(.*)\((.*)\)$/); return { name: (match?.[1] || value).trim(), standOrLocation: match?.[2]?.trim() }; }
function marketLabel(value: string) { const normalised = normaliseHeader(value); return normalised.includes('western') ? 'Western' : normalised.includes('spit') ? 'Spit' : normalised.includes('covent') ? 'Covent' : normalised === 'sender' ? 'Sender' : value.trim(); }
function marketFromSheetName(value: string) { const normalised = normaliseHeader(value); if (normalised.includes('covent')) return 'Covent'; if (normalised.includes('spit') || normalised.includes('spitalfields')) return 'Spit'; if (normalised.includes('western') || normalised.startsWith('west')) return 'Western'; if (normalised.includes('brighton')) return 'Brighton'; return undefined; }
function driverKey(value: string) { return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function scopedImportKey(record: StageBatchRequest, importRun: string, index: number) {
  const entity = record.entityType.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
  const payloadKey = String(record.payload.employeeNumber || record.payload.registration || record.payload.trailerNumber || record.payload.externalCode || record.payload.customerCode || record.payload.name || index).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96);
  return `master:${entity}:${payloadKey || index}:run:${importRun}:${index}`;
}
function summariseBatch(records: StageBatchRequest[]) { const counts = records.reduce<Record<string, number>>((total, record) => ({ ...total, [record.entityType]: (total[record.entityType] || 0) + 1 }), {}); return Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(', '); }
function read(row: SheetRow, key: string) { const exact = row[key]; if (exact !== undefined) return exact; const wanted = normaliseHeader(key); const match = Object.entries(row).find(([header]) => normaliseHeader(header) === wanted); return match?.[1]; }
function firstText(row: SheetRow, keys: string[]) { for (const key of keys) { const value = text(read(row, key)); if (value) return value; } return ''; }
function driverDisplayName(row: SheetRow) {
  const candidates = ['Driver', 'Driver Name', 'Drivers', 'Display Name', 'Employee Name', 'Full Name', 'Name'].map(key => firstText(row, [key])).filter(Boolean);
  return candidates.find(value => !looksLikeEmployeeNumber(value)) || '';
}
function looksLikeEmployeeNumber(value: string) { const compact = value.replace(/\s+/g, ''); return /^\d+$/.test(compact) || /^e?mp?\d+$/i.test(compact) || /^[a-z]{0,4}\d{3,}$/i.test(compact); }
function text(value: unknown) { return String(value ?? '').trim(); }
function dateText(value: unknown) { if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10); const raw = text(value); if (!raw) return ''; const parsed = new Date(raw); return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10); }
function numberValue(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function yesNo(value: unknown) { const normalised = text(value).toLowerCase(); return normalised ? ['yes', 'y', 'true'].includes(normalised) : undefined; }
function normalisePhone(value: unknown) { return text(value).replace(/[^\d+]/g, ''); }
function bestFuelProvider(row: SheetRow) { if (read(row, 'Shell Card')) return 'Shell'; if (read(row, 'BP Red Card') || read(row, 'BP Plain Card')) return 'BP'; return undefined; }
function CoreMasterDataForm() {
  const token = useAccessToken(); const [entity, setEntity] = useState<MasterEntity>('customer'); const [first, setFirst] = useState(''); const [second, setSecond] = useState(''); const [optional, setOptional] = useState(''); const [message, setMessage] = useState<string>(); const [saving, setSaving] = useState(false);
  const labels: Record<MasterEntity, [string, string, string]> = { customer: ['Customer code', 'Customer name', 'Account note'], customercontact: ['Customer code', 'Contact name', 'ETA email address'], vehicle: ['Registration', 'Fleet number', 'Abbreviation'], driver: ['Employee number', 'Driver name', 'Mobile number'], trailer: ['Trailer number', 'Trailer type', 'Standard capacity'], marketcontact: ['Market', 'Contact name', 'Stand or location'] };
  const [firstLabel, secondLabel, optionalLabel] = labels[entity];
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { const payload: Record<string, string | boolean | number | undefined> = entity === 'customer' ? { code: first, name: second, active: true } : entity === 'customercontact' ? { customerCode: first, name: second, email: optional, receivesEtaUpdates: true, active: true } : entity === 'vehicle' ? { registration: first, fleetNumber: second, abbreviation: optional, active: true } : entity === 'driver' ? { employeeNumber: first, displayName: second, mobileNumber: optional, active: true } : entity === 'trailer' ? { trailerNumber: first, type: second, standardCapacity: optional ? Number(optional) : undefined, active: true } : { market: first, name: second, standOrLocation: optional, active: true }; await api.stageRecord(entity, payload, `web-${entity}:${first.trim().toLowerCase().replaceAll(' ', '-')}:${second.trim().toLowerCase().replaceAll(' ', '-')}`, await token()); setMessage(`${entity === 'customercontact' ? 'Customer ETA contact' : entity === 'marketcontact' ? 'Market contact' : entity[0].toUpperCase() + entity.slice(1)} sent to staging review.`); setFirst(''); setSecond(''); setOptional(''); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Record could not be submitted.'); } finally { setSaving(false); } }
  return <form className="quick-order master-setup" onSubmit={event => void submit(event)}><div><p className="eyebrow">Core setup</p><h2>Add customer, contact, fleet or driver records</h2></div><div className="field-grid"><label>Record type<select value={entity} onChange={event => { setEntity(event.target.value as MasterEntity); setFirst(''); setSecond(''); setOptional(''); }}><option value="customer">Customer</option><option value="customercontact">Customer ETA contact</option><option value="vehicle">Vehicle</option><option value="driver">Driver</option><option value="trailer">Trailer</option><option value="marketcontact">Market contact</option></select></label><label>{firstLabel}<input required value={first} onChange={event => setFirst(event.target.value)} /></label><label>{secondLabel}<input required value={second} onChange={event => setSecond(event.target.value)} /></label><label>{optionalLabel}<input type={entity === 'driver' ? 'tel' : entity === 'customercontact' ? 'email' : 'text'} value={optional} onChange={event => setOptional(event.target.value)} /></label></div><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Send for review'}</button>{message && <p className="hint">{message}</p>}</form>;
}
function SiteSetupForm() { const token = useAccessToken(); const [form, setForm] = useState({ externalCode: '', name: '', collectionAddress: '', collectionInstructions: '', mapLink: '' }); const [message, setMessage] = useState<string>(); const [saving, setSaving] = useState(false); const update = (name: keyof typeof form, value: string) => setForm(current => ({ ...current, [name]: value })); async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { await api.stageRecord('site', { ...form, active: true }, `web-site:${form.externalCode}`, await token()); setMessage('Site sent to staging review.'); setForm({ externalCode: '', name: '', collectionAddress: '', collectionInstructions: '', mapLink: '' }); } catch (exception) { setMessage(exception instanceof Error ? exception.message : 'Site could not be submitted.'); } finally { setSaving(false); } } return <form className="quick-order site-setup" onSubmit={event => void submit(event)}><p className="eyebrow">Site setup</p><h2>Add a collection or market location</h2><div className="field-grid"><label>Site code<input required value={form.externalCode} onChange={event => update('externalCode', event.target.value)} /></label><label>Site name<input required value={form.name} onChange={event => update('name', event.target.value)} /></label><label className="wide">Address<input value={form.collectionAddress} onChange={event => update('collectionAddress', event.target.value)} /></label><label className="wide">Map link<input type="url" value={form.mapLink} onChange={event => update('mapLink', event.target.value)} /></label><label className="wide">Driver instructions<textarea value={form.collectionInstructions} onChange={event => update('collectionInstructions', event.target.value)} placeholder="Access, gate, stand or collection notes…" /></label></div><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Send site for review'}</button>{message && <p className="hint">{message}</p>}</form>; }
function DataList<T extends { id: string }>({ title, data, render }: { title: string; data?: T[]; render: (item: T) => ReactNode }) { return <article className="data-list"><h2>{title}<span>{data?.length || 0}</span></h2>{data?.slice(0, 8).map(item => <div key={item.id}>{render(item)}</div>) || <p>No active records.</p>}</article>; }

export function OperationalPlaceholder({ title }: { title: string }) { return <section className="placeholder"><p className="eyebrow">Operational workspace</p><h1>{title}</h1><div className="panel"><h2>Ready for the next backend increment</h2><p>This production shell preserves the planning workflow and navigation, but the current API has no {title.toLowerCase()} endpoints. It will become live once the matching versioned endpoint is introduced in the backend.</p></div></section>; }
