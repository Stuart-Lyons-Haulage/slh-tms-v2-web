import type { Driver, TransportOrder, Vehicle } from '../lib/api';
import type { Run } from '../api/runs';

export type RoadrunnerExportRow = Record<string, string | number | boolean | undefined>;

export type RoadrunnerExportIssue = {
  runId: string;
  runReference: string;
  severity: 'warning' | 'error';
  message: string;
};

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

export function buildRoadrunnerExport(
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

export function roadRunnerRowsToCsv(rows: RoadrunnerExportRow[]) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\r\n');
}
