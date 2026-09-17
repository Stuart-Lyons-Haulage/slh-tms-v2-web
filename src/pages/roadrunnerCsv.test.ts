import { describe, expect, it } from 'vitest';
import type { Driver, TransportOrder, Vehicle } from '../lib/api';
import type { Run } from '../api/runs';
import { buildRoadrunnerExport, roadRunnerRowsToCsv } from './roadrunnerCsv';

const run: Run = {
  id: 'run-1',
  reference: 'AM 12',
  planningDate: '2026-09-18',
  status: 'Allocated',
  driverId: 'driver-1',
  vehicleId: 'vehicle-1',
  stops: [
    { id: 'stop-1', orderId: 'order-1', sequence: 1, name: 'Selsey', address: 'Selsey, West Sussex', pallets: 8 },
    { id: 'stop-2', orderId: 'order-1', sequence: 2, name: 'Aldi', address: 'Aldi RDC', pallets: 8 },
  ],
};

const order: TransportOrder = {
  id: 'order-1',
  reference: 'ORD-123',
  customerCode: 'ALDI',
  customerName: 'Aldi',
  collectionDate: '2026-09-18',
  collectionLocation: 'Selsey',
  deliveryDate: '2026-09-18',
  deliveryLocation: 'Aldi RDC',
  pallets: 8,
  status: 'Planned',
};

const driver: Driver = {
  id: 'driver-1',
  employeeNumber: 'D001',
  displayName: 'Test Driver',
  tachoMasterDriverId: 'TM-99',
  tachoCardNumber: 'CARD-99',
  active: true,
};

const vehicle: Vehicle = {
  id: 'vehicle-1',
  registration: 'AB12 CDE',
  fleetNumber: '12',
  trackingIdentifier: 'DOT-12',
  active: true,
};

describe('Roadrunner CSV export', () => {
  it('exports the linked order with driver, TachoMaster and tracking identifiers', () => {
    const result = buildRoadrunnerExport([run], [order], [driver], [vehicle]);

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      RunReference: 'AM 12',
      OrderReference: 'ORD-123',
      CustomerCode: 'ALDI',
      DriverName: 'Test Driver',
      TachoMasterDriverId: 'TM-99',
      TachoCardNumber: 'CARD-99',
      VehicleRegistration: 'AB12 CDE',
      VehicleTrackingIdentifier: 'DOT-12',
      Pallets: 8,
    });
  });

  it('warns when the matching identifiers required for integration are absent', () => {
    const result = buildRoadrunnerExport(
      [run],
      [order],
      [{ ...driver, tachoMasterDriverId: undefined, tachoCardNumber: undefined }],
      [{ ...vehicle, trackingIdentifier: undefined, fleetNumber: undefined }],
    );

    expect(result.issues.map(issue => issue.message)).toContain('Driver has no TachoMaster ID or tacho card number.');
    expect(result.issues.map(issue => issue.message)).toContain('Vehicle has no tracking identifier or fleet number.');
  });

  it('escapes commas and quotes in CSV values', () => {
    const csv = roadRunnerRowsToCsv([{ RunReference: 'AM 12', PlannerNotes: 'Collect, then "call"' }]);
    expect(csv).toContain('"Collect, then ""call"""');
  });
});
