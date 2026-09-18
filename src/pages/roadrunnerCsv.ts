import type { Driver, Site, TransportOrder, Vehicle } from '../lib/api';
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
  'Del Date': string;
  'Del Time': string;
  Company: string;
  Town: string;
  County: string;
  Postcode: string;
  Pallets: number | '';
  Weight: number | '';
  Cases: number | '';
  Comment: string;
};

export const ROADRUNNER_ORDER_HEADERS: Array<keyof RoadrunnerOrderExportRow> = [
  'Ref',
  'Del Date',
  'Del Time',
  'Company',
  'Town',
  'County',
  'Postcode',
  'Pallets',
  'Weight',
  'Cases',
  'Comment',
];

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

  return { town, county, postcode };
}

function siteForOrder(order: TransportOrder, sites: Site[]) {
  if (order.deliverySiteId) {
    const exact = sites.find(site => site.id === order.deliverySiteId);
    if (exact) return exact;
  }

  const delivery = clean(order.deliveryLocation).toLowerCase();
  if (!delivery) return undefined;
  return sites.find(site =>
    clean(site.name).toLowerCase() === delivery ||
    clean(site.driverTextName).toLowerCase() === delivery ||
    clean(site.externalCode).toLowerCase() === delivery,
  );
}

function orderComment(order: TransportOrder) {
  const parts: string[] = [];
  if (clean(order.reference)) parts.push(`TMS ${clean(order.reference)}`);

  const po = clean(order.purchaseOrderNumber || order.poNumber);
  if (po && po !== clean(order.reference)) parts.push(`PO ${po}`);

  const collectionDate = formatRoadrunnerDate(order.collectionDate);
  const collectionTime = formatRoadrunnerTime(order.collectionWindowStartUtc);
  const collectionLocation = clean(order.collectionLocation);
  if (collectionDate || collectionTime || collectionLocation) {
    parts.push(`Collect ${[collectionDate, collectionTime, collectionLocation].filter(Boolean).join(' ')}`);
  }

  if (clean(order.temperatureRequirement)) parts.push(`Temp ${clean(order.temperatureRequirement)}`);
  if (clean(order.driverInstructions)) parts.push(clean(order.driverInstructions));
  if (clean(order.trailerNotes)) parts.push(clean(order.trailerNotes));
  if (clean(order.notes)) parts.push(clean(order.notes));

  return parts.join(' | ');
}

export function buildRoadrunnerOrdersExport(orders: TransportOrder[], sites: Site[] = []) {
  const rows: RoadrunnerOrderExportRow[] = [];
  const issues: RoadrunnerOrderExportIssue[] = [];

  for (const order of orders) {
    const site = siteForOrder(order, sites);
    const address = clean(order.deliveryAddress) || clean(site?.collectionAddress);
    const { town, county, postcode } = splitUkAddress(address);
    const company = clean(order.deliveryLocation) || clean(site?.driverTextName) || clean(site?.name) || clean(order.customerName) || clean(order.customerCode);
    const ref = clean(order.sourceOrderReference) || clean(order.purchaseOrderNumber) || clean(order.poNumber) || clean(order.reference);
    const deliveryDate = formatRoadrunnerDate(order.deliveryDate);
    const deliveryTime = formatRoadrunnerTime(order.deliveryWindowStartUtc);

    if (!ref) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'error', message: 'No Roadrunner Ref could be derived from the order reference/PO.' });
    }
    if (!deliveryDate) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'error', message: 'Delivery date is missing.' });
    }
    if (!company) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'error', message: 'Delivery company/site is missing.' });
    }
    if (!postcode) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'warning', message: 'Delivery postcode could not be derived from the order or Site Master address.' });
    }
    if (!deliveryTime) {
      issues.push({ orderId: order.id, orderReference: order.reference, severity: 'warning', message: 'Delivery booked time is blank.' });
    }

    rows.push({
      Ref: ref,
      'Del Date': deliveryDate,
      'Del Time': deliveryTime,
      Company: company,
      Town: town,
      County: county,
      Postcode: postcode,
      Pallets: order.pallets ?? '',
      Weight: '',
      Cases: order.cases ?? '',
      Comment: orderComment(order),
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

// Backwards-compatible name retained for any existing imports.
export const buildRoadrunnerExport = buildRoadrunnerRunExport;

export function roadRunnerRowsToCsv(rows: RoadrunnerExportRow[]) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\r\n');
}
