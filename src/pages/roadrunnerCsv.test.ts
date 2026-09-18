import { describe, expect, it } from 'vitest';
import type { Driver, Site, TransportOrder, Vehicle } from '../lib/api';
import type { Run } from '../api/runs';
import {
  buildRoadrunnerOrdersExport,
  buildRoadrunnerRunExport,
  ROADRUNNER_ORDER_HEADERS,
  roadRunnerOrderRowsToCsv,
  roadRunnerRowsToCsv,
} from './roadrunnerCsv';

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
  purchaseOrderNumber: 'PO-456',
  collectionDate: '2026-09-18',
  collectionWindowStartUtc: '2026-09-18T05:30:00Z',
  collectionLocation: 'Selsey',
  deliveryDate: '2026-09-20',
  deliveryWindowStartUtc: '2026-09-20T13:30:00Z',
  deliverySiteId: 'site-1',
  deliveryLocation: 'Waitrose Leyland',
  pallets: 8,
  cases: 120,
  status: 'Planned',
};

const site: Site = {
  id: 'site-1',
  externalCode: 'WAITROSE-LEYLAND',
  name: 'Waitrose Leyland',
  collectionAddress: 'Eaton Avenue, Leyland, Lancashire, PR7 7NA',
  active: true,
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
  it('exports the linked run with driver, TachoMaster and tracking identifiers', () => {
    const result = buildRoadrunnerRunExport([run], [order], [driver], [vehicle]);

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

  it('warns when run matching identifiers are absent', () => {
    const result = buildRoadrunnerRunExport(
      [run],
      [order],
      [{ ...driver, tachoMasterDriverId: undefined, tachoCardNumber: undefined }],
      [{ ...vehicle, trackingIdentifier: undefined, fleetNumber: undefined }],
    );

    expect(result.issues.map(issue => issue.message)).toContain('Driver has no TachoMaster ID or tacho card number.');
    expect(result.issues.map(issue => issue.message)).toContain('Vehicle has no tracking identifier or fleet number.');
  });

  it('builds the exact observed Roadrunner order import columns', () => {
    const result = buildRoadrunnerOrdersExport([order], [site]);

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([{
      Ref: 'PO-456',
      'Del Date': '20/09/2026',
      'Del Time': '14:30',
      Company: 'Waitrose Leyland',
      Town: 'Leyland',
      County: 'Lancashire',
      Postcode: 'PR7 7NA',
      Pallets: 8,
      Weight: '',
      Cases: 120,
      Comment: 'TMS ORD-123 | PO PO-456 | Collect 18/09/2026 06:30 Selsey',
    }]);

    expect(ROADRUNNER_ORDER_HEADERS).toEqual([
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
    ]);
  });

  it('uses Site Master as the destination-address fallback', () => {
    const result = buildRoadrunnerOrdersExport([
      { ...order, deliveryAddress: undefined },
    ], [site]);

    expect(result.rows[0]).toMatchObject({
      Company: 'Waitrose Leyland',
      Town: 'Leyland',
      County: 'Lancashire',
      Postcode: 'PR7 7NA',
    });
    expect(result.issues).toEqual([]);
  });

  it('warns when a Roadrunner order is missing postcode or delivery time', () => {
    const result = buildRoadrunnerOrdersExport([
      {
        ...order,
        deliverySiteId: undefined,
        deliveryAddress: 'Eaton Avenue, Leyland',
        deliveryWindowStartUtc: undefined,
      },
    ]);

    expect(result.issues.map(issue => issue.message)).toContain('Delivery postcode could not be derived from the order or Site Master address.');
    expect(result.issues.map(issue => issue.message)).toContain('Delivery booked time is blank.');
  });

  it('writes exact order headers and escapes commas and quotes', () => {
    const csv = roadRunnerOrderRowsToCsv([{
      Ref: '123456',
      'Del Date': '20/09/2026',
      'Del Time': '14:30',
      Company: 'Road Tech',
      Town: 'Shenley',
      County: 'Hertfordshire',
      Postcode: 'WD7 9AN',
      Pallets: 26,
      Weight: 12541.654,
      Cases: 2345,
      Comment: 'Pre Book, then "call"',
    }]);

    expect(csv.split('\r\n')[0]).toBe('Ref,Del Date,Del Time,Company,Town,County,Postcode,Pallets,Weight,Cases,Comment');
    expect(csv).toContain('"Pre Book, then ""call"""');
  });

  it('escapes commas and quotes in detailed run CSV values', () => {
    const csv = roadRunnerRowsToCsv([{ RunReference: 'AM 12', PlannerNotes: 'Collect, then "call"' }]);
    expect(csv).toContain('"Collect, then ""call"""');
  });
});
