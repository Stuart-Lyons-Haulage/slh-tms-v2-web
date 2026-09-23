import type { Customer, Driver, RoadrunnerSiteProfile, Site, TransportOrder, Vehicle } from '../lib/api';
import type { Run } from '../api/runs';

export type RoadrunnerExportRow = Record<string, string | number | boolean | undefined>;

export type RoadrunnerExportIssue = {
  runId: string;
  runReference: string;
  severity: 'warning' | 'error';
  message: string;
};

export type RoadrunnerOrderExportIssue = {
  orderId: string;
  orderReference: string;
  severity: 'warning' | 'error';
  message: string;
};

export type RoadrunnerOrderExportRow = {
  Ref: string;
  'Cust Code': string;
  'Cust Ref': string;
  'Cons Ref': string;
  'Order Category': string;
  'PO / POS': string;
  'Collect Site Code': string;
  'Collect Lookup Code': string;
  'Collect Date': string;
  'Collect Time': string;
  'Collect Time To': string;
  'Collect Company': string;
  'Collect Add1': string;
  'Collect Add2': string;
  'Collect Add3': string;
  'Collect Town': string;
  'Collect County': string;
  'Collect Postcode': string;
  'Deliver Site Code': string;
  'Deliver Lookup Code': string;
  'Del Date': string;
  'Del Time': string;
  'Del Time To': string;
  Company: string;
  Add1: string;
  Add2: string;
  Add3: string;
  Town: string;
  County: string;
  Postcode: string;
  Pallets: number | '';
  Weight: number | '';
  Cases: number | '';
  Trays: number | '';
  Trolleys: number | '';
  Temperature: string;
  'Trailer Notes': string;
  'Driver Instructions': string;
  Comment: string;
  'TMS Order ID': string;
  'Source Subject': string;
  'Source Attachment': string;
};

export const ROADRUNNER_ORDER_HEADERS: Array<keyof RoadrunnerOrderExportRow> = [
  'Ref',
  'Cust Code',
  'Cust Ref',
  'Cons Ref',
  'Order Category',
  'PO / POS',
  'Collect Site Code',
  'Collect Lookup Code',
  'Collect Date',
  'Collect Time',
  'Collect Time To',
  'Collect Company',
  'Collect Add1',
  'Collect Add2',
  'Collect Add3',
  'Collect Town',
  'Collect County',
  'Collect Postcode',
  'Deliver Site Code',
  'Deliver Lookup Code',
  'Del Date',
  'Del Time',
  'Del Time To',
  'Company',
  'Add1',
  'Add2',
  'Add3',
  'Town',
  'County',
  'Postcode',
  'Pallets',
  'Weight',
  'Cases',
  'Trays',
  'Trolleys',
  'Temperature',
  'Trailer Notes',
  'Driver Instructions',
  'Comment',
  'TMS Order ID',
  'Source Subject',
  'Source Attachment',
];

export const ROADRUNNER_SITE_MASTER_HEADERS = [
  'Code',
  'Lookup Code',
  'Company Letter',
  'Company',
  'Add1',
  'Add2',
  'Add3',
  'AddTown',
  'AddCounty',
  'AddPostcode',
  'AddCountry',
  'Latitude',
  'Longitude',
  'Contact1',
  'Contact2',
  'Telephone',
  'Fax',
  'Email',
  'Collect Time From 1',
  'Collect Time To 1',
  'Collect Time From 2',
  'Collect Time To 2',
  'Deliver Time From 1',
  'Deliver Time To 1',
  'Deliver Time From 2',
  'Deliver Time To 2',
  'Collect Turnaround',
  'Collect Turnaround Per Pallet',
  'Deliver Turnaround',
  'Deliver Turnaround Per Pallet',
  'Vehicle Type',
  'TailLiftRequired',
  'Grid Ref',
  'Rate Area',
  'Booking Required',
  'Van Route Name',
] as const;

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some(value => value.trim().length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.replace(/\r$/, ''));
  if (row.some(value => value.trim().length > 0)) rows.push(row);
  return rows;
}

function optionalText(value?: string) {
  const trimmed = String(value || '').trim();
  return trimmed || undefined;
}

function optionalNumber(value?: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalBoolean(value?: string) {
  const normal = String(value || '').trim().toLowerCase();
  if (!normal) return undefined;
  if (['true', 'yes', 'y', '1'].includes(normal)) return true;
  if (['false', 'no', 'n', '0'].includes(normal)) return false;
  return undefined;
}

export function decodeRoadrunnerSiteMasterBytes(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const looksUtf16Le =
    (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) ||
    bytes.slice(0, Math.min(bytes.length, 200)).filter((_, index) => index % 2 === 1 && bytes[index] === 0).length > 20;
  return new TextDecoder(looksUtf16Le ? 'utf-16le' : 'utf-8').decode(buffer).replace(/^\uFEFF/, '');
}

export function parseRoadrunnerSiteMasterCsv(text: string): RoadrunnerSiteProfile[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];

  const headers = rows[0].map(header => header.replace(/^\uFEFF/, '').trim());
  const indexByHeader = new Map(headers.map((header, index) => [header.toLowerCase(), index]));
  const missing = ROADRUNNER_SITE_MASTER_HEADERS
    .filter(header => !indexByHeader.has(header.toLowerCase()));

  if (missing.length) {
    throw new Error(`This does not look like a Roadrunner Site Master export. Missing columns: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`);
  }

  const value = (row: string[], header: string) => row[indexByHeader.get(header.toLowerCase())!] || '';
  return rows.slice(1)
    .filter(row => optionalText(value(row, 'Code')) || optionalText(value(row, 'Company')))
    .map(row => ({
      code: optionalText(value(row, 'Code')),
      lookupCode: optionalText(value(row, 'Lookup Code')),
      companyLetter: optionalText(value(row, 'Company Letter')),
      company: optionalText(value(row, 'Company')),
      add1: optionalText(value(row, 'Add1')),
      add2: optionalText(value(row, 'Add2')),
      add3: optionalText(value(row, 'Add3')),
      addTown: optionalText(value(row, 'AddTown')),
      addCounty: optionalText(value(row, 'AddCounty')),
      addPostcode: optionalText(value(row, 'AddPostcode')),
      addCountry: optionalText(value(row, 'AddCountry')),
      latitude: optionalNumber(value(row, 'Latitude')),
      longitude: optionalNumber(value(row, 'Longitude')),
      contact1: optionalText(value(row, 'Contact1')),
      contact2: optionalText(value(row, 'Contact2')),
      telephone: optionalText(value(row, 'Telephone')),
      fax: optionalText(value(row, 'Fax')),
      email: optionalText(value(row, 'Email')),
      collectTimeFrom1: optionalText(value(row, 'Collect Time From 1')),
      collectTimeTo1: optionalText(value(row, 'Collect Time To 1')),
      collectTimeFrom2: optionalText(value(row, 'Collect Time From 2')),
      collectTimeTo2: optionalText(value(row, 'Collect Time To 2')),
      deliverTimeFrom1: optionalText(value(row, 'Deliver Time From 1')),
      deliverTimeTo1: optionalText(value(row, 'Deliver Time To 1')),
      deliverTimeFrom2: optionalText(value(row, 'Deliver Time From 2')),
      deliverTimeTo2: optionalText(value(row, 'Deliver Time To 2')),
      collectTurnaround: optionalText(value(row, 'Collect Turnaround')),
      collectTurnaroundPerPallet: optionalText(value(row, 'Collect Turnaround Per Pallet')),
      deliverTurnaround: optionalText(value(row, 'Deliver Turnaround')),
      deliverTurnaroundPerPallet: optionalText(value(row, 'Deliver Turnaround Per Pallet')),
      vehicleType: optionalText(value(row, 'Vehicle Type')),
      tailLiftRequired: optionalBoolean(value(row, 'TailLiftRequired')),
      gridRef: optionalText(value(row, 'Grid Ref')),
      rateArea: optionalText(value(row, 'Rate Area')),
      bookingRequired: optionalBoolean(value(row, 'Booking Required')),
      vanRouteName: optionalText(value(row, 'Van Route Name')),
    }));
}

function csvCell(value: unknown) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function clean(value?: string) {
  return String(value || '').trim();
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function formatRoadrunnerDate(value?: string) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : clean(value);
}

function formatRoadrunnerTime(value?: string) {
  const text = clean(value);
  if (!text) return '';

  const plain = text.match(/^(\d{1,2}):(\d{2})/);
  if (plain) return `${plain[1].padStart(2, '0')}:${plain[2]}`;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(parsed);
  }

  const embedded = text.match(/T(\d{2}):(\d{2})/);
  return embedded ? `${embedded[1]}:${embedded[2]}` : text;
}

function formatPostcode(value: string) {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : value.toUpperCase();
}

function splitUkAddress(address?: string) {
  const source = clean(address);
  const postcodeMatch = source.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  const postcode = postcodeMatch ? formatPostcode(postcodeMatch[1]) : '';

  const parts = source
    .split(/[,\r\n]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => postcode ? part.replace(new RegExp(postcode.replace(' ', '\\s*'), 'i'), '').trim() : part)
    .filter(Boolean);

  const town = parts.length >= 2 ? parts.at(-2)! : parts.at(-1) || '';
  const county = parts.length >= 3 ? parts.at(-1)! : '';
  const addressParts = parts.slice(0, Math.max(0, parts.length - (parts.length >= 3 ? 2 : 1)));

  return {
    add1: addressParts[0] || '',
    add2: addressParts[1] || '',
    add3: addressParts.slice(2).join(', '),
    town,
    county,
    postcode,
  };
}

function normaliseLookup(value?: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function siteAliases(site: Site) {
  return [
    site.name,
    site.driverTextName,
    site.externalCode,
    site.roadrunnerCode,
    ...(site.aliases || '').split(/[;,]/),
  ].map(normaliseLookup).filter(Boolean);
}

function siteForOrder(order: TransportOrder, sites: Site[], kind: 'collection' | 'delivery') {
  const siteId = kind === 'collection' ? order.collectionSiteId : order.deliverySiteId;
  if (siteId) {
    const exact = sites.find(site => site.id === siteId);
    if (exact) return exact;
  }

  const location = normaliseLookup(kind === 'collection' ? order.collectionLocation : order.deliveryLocation);
  if (!location) return undefined;
  return sites.find(site => siteAliases(site).includes(location));
}

function customerForOrder(order: TransportOrder, customers: Customer[]) {
  const code = normaliseLookup(order.customerCode);
  const name = normaliseLookup(order.customerName);
  return customers.find(customer =>
    (code && normaliseLookup(customer.code) === code) ||
    (name && normaliseLookup(customer.name) === name),
  );
}

function roadRunnerProfile(site?: Site): RoadrunnerSiteProfile | undefined {
  const raw = clean(site?.roadrunnerProfileJson);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as RoadrunnerSiteProfile;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function siteExportDetails(site: Site | undefined, fallbackAddress?: string, fallbackCompany?: string) {
  const profile = roadRunnerProfile(site);
  const parsed = splitUkAddress(fallbackAddress || site?.collectionAddress);
  return {
    code: clean(profile?.code) || clean(site?.roadrunnerCode) || clean(site?.externalCode),
    lookupCode: clean(profile?.lookupCode),
    company: clean(profile?.company) || clean(site?.driverTextName) || clean(site?.name) || clean(fallbackCompany),
    add1: clean(profile?.add1) || parsed.add1,
    add2: clean(profile?.add2) || parsed.add2,
    add3: clean(profile?.add3) || parsed.add3,
    town: clean(profile?.addTown) || parsed.town,
    county: clean(profile?.addCounty) || parsed.county,
    postcode: clean(profile?.addPostcode) ? formatPostcode(clean(profile?.addPostcode)) : parsed.postcode,
  };
}

function orderComment(order: TransportOrder) {
  const parts: string[] = [];
  if (clean(order.reference)) parts.push(`TMS ${clean(order.reference)}`);

  const po = clean(order.purchaseOrderNumber || order.poNumber);
  if (po) parts.push(`PO/POS ${po}`);

  if (clean(order.sourceOrderReference) && clean(order.sourceOrderReference) !== po) {
    parts.push(`Customer ref ${clean(order.sourceOrderReference)}`);
  }

  if (clean(order.notes)) parts.push(clean(order.notes));
  return parts.join(' | ');
}

export function buildRoadrunnerOrdersExport(
  orders: TransportOrder[],
  sites: Site[] = [],
  customers: Customer[] = [],
) {
  const rows: RoadrunnerOrderExportRow[] = [];
  const issues: RoadrunnerOrderExportIssue[] = [];

  for (const order of orders) {
    const collectionSite = siteForOrder(order, sites, 'collection');
    const deliverySite = siteForOrder(order, sites, 'delivery');
    const customer = customerForOrder(order, customers);

    const collection = siteExportDetails(collectionSite, order.collectionAddress, order.collectionLocation);
    const delivery = siteExportDetails(deliverySite, order.deliveryAddress, order.deliveryLocation);

    const poPos = clean(order.purchaseOrderNumber || order.poNumber);
    const customerReference = poPos || clean(order.sourceOrderReference) || clean(order.reference);
    const consignmentReference = clean(order.reference);
    const customerCode = clean(customer?.code) || clean(order.customerCode);
    const deliveryDate = formatRoadrunnerDate(order.deliveryDate);
    const deliveryTime = formatRoadrunnerTime(order.deliveryWindowStartUtc);
    const collectionDate = formatRoadrunnerDate(order.collectionDate);
    const collectionTime = formatRoadrunnerTime(order.collectionWindowStartUtc);

    if (!customerReference) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'error', message: 'No PO/POS, customer reference or TMS reference is available for Roadrunner matching.' });
    }
    if (!poPos) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'warning', message: 'PO/POS is blank. Destination and customer reference will need to carry the Roadrunner match.' });
    }
    if (!collectionSite) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'warning', message: 'Collection site is not linked to Site Master; export is using the order address/name as fallback.' });
    }
    if (!deliverySite) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'warning', message: 'Delivery site is not linked to Site Master; export is using the order address/name as fallback.' });
    }
    if (!deliveryDate) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'error', message: 'Delivery date is missing.' });
    }
    if (!delivery.company) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'error', message: 'Delivery company/site is missing.' });
    }
    if (!delivery.postcode) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'warning', message: 'Delivery postcode could not be derived from Site Master or the order.' });
    }
    if (!deliveryTime) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'warning', message: 'Delivery booked time is blank.' });
    }

    rows.push({
      Ref: customerReference,
      'Cust Code': customerCode,
      'Cust Ref': customerReference,
      'Cons Ref': consignmentReference,
      'Order Category': clean(order.jobType) || 'Delivery',
      'PO / POS': poPos,
      'Collect Site Code': collection.code,
      'Collect Lookup Code': collection.lookupCode,
      'Collect Date': collectionDate,
      'Collect Time': collectionTime,
      'Collect Time To': formatRoadrunnerTime(order.collectionWindowEndUtc),
      'Collect Company': collection.company,
      'Collect Add1': collection.add1,
      'Collect Add2': collection.add2,
      'Collect Add3': collection.add3,
      'Collect Town': collection.town,
      'Collect County': collection.county,
      'Collect Postcode': collection.postcode,
      'Deliver Site Code': delivery.code,
      'Deliver Lookup Code': delivery.lookupCode,
      'Del Date': deliveryDate,
      'Del Time': deliveryTime,
      'Del Time To': formatRoadrunnerTime(order.deliveryWindowEndUtc),
      Company: delivery.company,
      Add1: delivery.add1,
      Add2: delivery.add2,
      Add3: delivery.add3,
      Town: delivery.town,
      County: delivery.county,
      Postcode: delivery.postcode,
      Pallets: order.pallets ?? '',
      Weight: '',
      Cases: order.cases ?? '',
      Trays: order.trays ?? '',
      Trolleys: order.trolleys ?? '',
      Temperature: clean(order.temperatureRequirement),
      'Trailer Notes': clean(order.trailerNotes),
      'Driver Instructions': clean(order.driverInstructions),
      Comment: orderComment(order),
      'TMS Order ID': order.id,
      'Source Subject': clean(order.sourceSubject),
      'Source Attachment': clean(order.sourceAttachmentName),
    });
  }

  return { rows, issues };
}

export function roadRunnerOrderRowsToCsv(rows: RoadrunnerOrderExportRow[]) {
  if (!rows.length) return '';
  return [
    ROADRUNNER_ORDER_HEADERS.join(','),
    ...rows.map(row => ROADRUNNER_ORDER_HEADERS.map(header => csvCell(row[header])).join(',')),
  ].join('\r\n');
}

export function buildRoadrunnerRunExport(
  runs: Run[],
  orders: TransportOrder[],
  drivers: Driver[],
  vehicles: Vehicle[],
) {
  const orderById = new Map(orders.map(order => [order.id, order]));
  const driverById = new Map(drivers.map(driver => [driver.id, driver]));
  const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const rows: RoadrunnerExportRow[] = [];
  const issues: RoadrunnerExportIssue[] = [];

  for (const run of runs) {
    const driver = run.driverId ? driverById.get(run.driverId) : undefined;
    const vehicle = run.vehicleId ? vehicleById.get(run.vehicleId) : undefined;
    const linkedOrders = unique(run.stops.map(stop => stop.orderId)).map(id => orderById.get(id)).filter((order): order is TransportOrder => Boolean(order));

    if (!run.stops.length) {
      issues.push({ runId: run.id, runReference: run.reference, severity: 'error', message: 'Run has no stops.' });
    }
    if (!run.driverId || !driver) {
      issues.push({ runId: run.id, runReference: run.reference, severity: 'error', message: 'No matched driver is allocated.' });
    } else if (!clean(driver.tachoMasterDriverId) && !clean(driver.tachoCardNumber)) {
      issues.push({ runId: run.id, runReference: run.reference, severity: 'warning', message: 'Driver has no TachoMaster ID or tacho card number.' });
    }
    if (!run.vehicleId || !vehicle) {
      issues.push({ runId: run.id, runReference: run.reference, severity: 'error', message: 'No matched vehicle is allocated.' });
    } else if (!clean(vehicle.trackingIdentifier) && !clean(vehicle.fleetNumber)) {
      issues.push({ runId: run.id, runReference: run.reference, severity: 'warning', message: 'Vehicle has no tracking identifier or fleet number.' });
    }
    if (!linkedOrders.length) {
      issues.push({ runId: run.id, runReference: run.reference, severity: 'warning', message: 'No order-linked stops were found. A run-level row will still be exported for testing.' });
    }

    const sourceOrders = linkedOrders.length ? linkedOrders : [undefined];
    for (const order of sourceOrders) {
      const orderStops = order ? run.stops.filter(stop => stop.orderId === order.id) : run.stops;
      const stopSummary = orderStops.map(stop => `${stop.sequence}:${stop.name}`).join(' | ');
      const firstStop = orderStops[0];
      const lastStop = orderStops.at(-1);

      rows.push({
        SourceSystem: 'SLH-TMS',
        RunId: run.id,
        RunReference: run.reference,
        RawRunReference: run.rawReference,
        PlanningDate: run.planningDate,
        RunStatus: run.status,
        RouteName: run.routeName,
        Wave: run.wave,
        StartTime: run.startTime,
        SignOnTime: run.signOnTime,
        Overnight: run.overnight ?? false,
        NightOutRequired: run.nightOutRequired ?? false,
        RunPalletSpacesUsed: run.palletSpacesUsed,
        RunCapacity: run.totalPalletSpaces,
        CapacityType: run.capacityType,
        TemperatureC: run.temperatureC,
        PlannerNotes: run.plannerNotes || run.notes,
        DriverId: driver?.id,
        DriverName: driver?.displayName,
        DriverEmployeeNumber: driver?.employeeNumber,
        DriverTachoName: driver?.tachoName,
        TachoMasterDriverId: driver?.tachoMasterDriverId,
        TachoCardNumber: driver?.tachoCardNumber,
        DriverMobile: driver?.mobileNumber,
        VehicleId: vehicle?.id,
        VehicleRegistration: vehicle?.registration,
        VehicleFleetNumber: vehicle?.fleetNumber,
        VehicleAbbreviation: vehicle?.abbreviation,
        VehicleTrackingIdentifier: vehicle?.trackingIdentifier,
        OrderId: order?.id,
        OrderReference: order?.reference,
        CustomerCode: order?.customerCode,
        CustomerName: order?.customerName,
        CustomerSupplier: order?.customerSupplier,
        JobType: order?.jobType,
        PurchaseOrderNumber: order?.purchaseOrderNumber || order?.poNumber,
        SourceOrderReference: order?.sourceOrderReference,
        CollectionDate: order?.collectionDate,
        CollectionWindowStartUtc: order?.collectionWindowStartUtc,
        CollectionWindowEndUtc: order?.collectionWindowEndUtc,
        CollectionLocation: order?.collectionLocation || firstStop?.name,
        CollectionAddress: order?.collectionAddress || firstStop?.address,
        DeliveryDate: order?.deliveryDate,
        DeliveryWindowStartUtc: order?.deliveryWindowStartUtc,
        DeliveryWindowEndUtc: order?.deliveryWindowEndUtc,
        DeliveryLocation: order?.deliveryLocation || lastStop?.name,
        DeliveryAddress: order?.deliveryAddress || lastStop?.address,
        Pallets: order?.pallets ?? orderStops.reduce((sum, stop) => sum + (stop.pallets || 0), 0),
        Cases: order?.cases ?? orderStops.reduce((sum, stop) => sum + (stop.cases || 0), 0),
        Trays: order?.trays ?? orderStops.reduce((sum, stop) => sum + (stop.trays || 0), 0),
        Trolleys: order?.trolleys ?? orderStops.reduce((sum, stop) => sum + (stop.trolleys || 0), 0),
        TemperatureRequirement: order?.temperatureRequirement,
        DriverInstructions: order?.driverInstructions,
        OrderNotes: order?.notes,
        Stops: stopSummary,
      });
    }
  }

  return { rows, issues };
}

export const buildRoadrunnerExport = buildRoadrunnerRunExport;

export function roadRunnerRowsToCsv(rows: RoadrunnerExportRow[]) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\r\n');
}
