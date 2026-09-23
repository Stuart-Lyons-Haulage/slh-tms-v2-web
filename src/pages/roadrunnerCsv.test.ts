import { describe, expect, it } from 'vitest';
import type { Customer, Driver, Site, TransportOrder, Vehicle } from '../lib/api';
import type { Run } from '../api/runs';
import {
  buildRoadrunnerOrdersExport,
  buildRoadrunnerRunExport,
  ROADRUNNER_ORDER_HEADERS,
  decodeRoadrunnerSiteMasterBytes,
  parseRoadrunnerSiteMasterCsv,
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
  customerCode: 'WAITROS2',
  customerName: 'Waitrose Ltd',
  purchaseOrderNumber: 'PO-456',
  collectionDate: '2026-09-18',
  collectionWindowStartUtc: '2026-09-18T05:30:00Z',
  collectionSiteId: 'site-collect',
  collectionLocation: 'Barfoots Of Botley',
  deliveryDate: '2026-09-20',
  deliveryWindowStartUtc: '2026-09-20T13:30:00Z',
  deliverySiteId: 'site-deliver',
  deliveryLocation: 'Waitrose Leyland',
  pallets: 8,
  cases: 120,
  status: 'Planned',
  temperatureRequirement: '+10c',
};

const collectionSite: Site = {
  id: 'site-collect',
  externalCode: 'BARFOOTS',
  roadrunnerCode: 'BARFOOT',
  name: 'Barfoots Of Botley',
  collectionAddress: 'Unit 1 Chichester Food Park, Bognor Road, Chichester, PO22 0AQ',
  roadrunnerProfileJson: JSON.stringify({
    code: 'BARFOOT',
    lookupCode: 'BARFOOTS',
    company: 'Barfoots Of Botley',
    add1: 'Unit 1 Chichester Food Park',
    add2: 'Bognor Road',
    addTown: 'Chichester',
    addCounty: 'West Sussex',
    addPostcode: 'PO22 0AQ',
  }),
  active: true,
};

const deliverySite: Site = {
  id: 'site-deliver',
  externalCode: 'WAITROSE-LEYLAND',
  roadrunnerCode: 'WAITLEY',
  name: 'Waitrose Leyland',
  collectionAddress: 'Eaton Avenue, Leyland, Lancashire, PR7 7NA',
  roadrunnerProfileJson: JSON.stringify({
    code: 'WAITLEY',
    lookupCode: 'WAITROSE-LEYLAND',
    company: 'Waitrose Leyland',
    add1: 'Eaton Avenue',
    addTown: 'Leyland',
    addCounty: 'Lancashire',
    addPostcode: 'PR7 7NA',
  }),
  active: true,
};

const customer: Customer = {
  id: 'customer-1',
  code: 'WAITROS2',
  name: 'Waitrose Ltd',
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
      CustomerCode: 'WAITROS2',
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

  it('builds a master-enriched consignment row and preserves PO/POS for matching', () => {
    const result = buildRoadrunnerOrdersExport([order], [collectionSite, deliverySite], [customer]);

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([{
      Ref: 'PO-456',
      'Cust Code': 'WAITROS2',
      'Cust Ref': 'PO-456',
      'Cons Ref': 'ORD-123',
      'Order Category': 'Delivery',
      'PO / POS': 'PO-456',
      'Collect Site Code': 'BARFOOT',
      'Collect Lookup Code': 'BARFOOTS',
      'Collect Date': '18/09/2026',
      'Collect Time': '06:30',
      'Collect Time To': '',
      'Collect Company': 'Barfoots Of Botley',
      'Collect Add1': 'Unit 1 Chichester Food Park',
      'Collect Add2': 'Bognor Road',
      'Collect Add3': '',
      'Collect Town': 'Chichester',
      'Collect County': 'West Sussex',
      'Collect Postcode': 'PO22 0AQ',
      'Deliver Site Code': 'WAITLEY',
      'Deliver Lookup Code': 'WAITROSE-LEYLAND',
      'Del Date': '20/09/2026',
      'Del Time': '14:30',
      'Del Time To': '',
      Company: 'Waitrose Leyland',
      Add1: 'Eaton Avenue',
      Add2: '',
      Add3: '',
      Town: 'Leyland',
      County: 'Lancashire',
      Postcode: 'PR7 7NA',
      Pallets: 8,
      Weight: '',
      Cases: 120,
      Trays: '',
      Trolleys: '',
      Temperature: '+10c',
      'Trailer Notes': '',
      'Driver Instructions': '',
      Comment: 'TMS ORD-123 | PO/POS PO-456',
      'TMS Order ID': 'order-1',
      'Source Subject': '',
      'Source Attachment': '',
    }]);

    expect(ROADRUNNER_ORDER_HEADERS).toContain('PO / POS');
    expect(ROADRUNNER_ORDER_HEADERS).toContain('Collect Site Code');
    expect(ROADRUNNER_ORDER_HEADERS).toContain('Deliver Site Code');
    expect(ROADRUNNER_ORDER_HEADERS).toContain('Cons Ref');
  });

  it('keeps orders separate even when PO and destination match', () => {
    const result = buildRoadrunnerOrdersExport([
      order,
      { ...order, id: 'order-2', reference: 'ORD-124', pallets: 13 },
    ], [collectionSite, deliverySite], [customer]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(row => row['PO / POS'])).toEqual(['PO-456', 'PO-456']);
    expect(result.rows.map(row => row.Company)).toEqual(['Waitrose Leyland', 'Waitrose Leyland']);
    expect(result.rows.map(row => row['Cons Ref'])).toEqual(['ORD-123', 'ORD-124']);
    expect(result.rows.map(row => row.Pallets)).toEqual([8, 13]);
  });

  it('uses order data as a fallback when a Site Master link is missing', () => {
    const result = buildRoadrunnerOrdersExport([
      {
        ...order,
        collectionSiteId: undefined,
        collectionLocation: 'Selsey',
        collectionAddress: 'Selsey Road, Chichester, West Sussex, PO20 0AA',
        deliverySiteId: undefined,
        deliveryAddress: 'Eaton Avenue, Leyland, Lancashire, PR7 7NA',
      },
    ], [], [customer]);

    expect(result.rows[0]).toMatchObject({
      'Collect Company': 'Selsey',
      'Collect Postcode': 'PO20 0AA',
      Company: 'Waitrose Leyland',
      Postcode: 'PR7 7NA',
    });
    expect(result.issues.map(issue => issue.message)).toContain('Collection site is not linked to Site Master; export is using the order address/name as fallback.');
    expect(result.issues.map(issue => issue.message)).toContain('Delivery site is not linked to Site Master; export is using the order address/name as fallback.');
  });

  it('warns when PO/POS, destination postcode or delivery time are absent', () => {
    const result = buildRoadrunnerOrdersExport([
      {
        ...order,
        purchaseOrderNumber: undefined,
        poNumber: undefined,
        deliverySiteId: undefined,
        deliveryAddress: 'Eaton Avenue, Leyland',
        deliveryWindowStartUtc: undefined,
      },
    ], [collectionSite], [customer]);

    expect(result.issues.map(issue => issue.message)).toContain('PO/POS is blank. Destination and customer reference will need to carry the Roadrunner match.');
    expect(result.issues.map(issue => issue.message)).toContain('Delivery postcode could not be derived from Site Master or the order.');
    expect(result.issues.map(issue => issue.message)).toContain('Delivery booked time is blank.');
  });

  it('parses the Roadrunner Site Master export and keeps the external site identity', () => {
    const csv = [
      'Code,Lookup Code,Company Letter,Company,Add1,Add2,Add3,AddTown,AddCounty,AddPostcode,AddCountry,Latitude,Longitude,Contact1,Contact2,Telephone,Fax,Email,Collect Time From 1,Collect Time To 1,Collect Time From 2,Collect Time To 2,Deliver Time From 1,Deliver Time To 1,Deliver Time From 2,Deliver Time To 2,Collect Turnaround,Collect Turnaround Per Pallet,Deliver Turnaround,Deliver Turnaround Per Pallet,Vehicle Type,TailLiftRequired,Grid Ref,Rate Area,Booking Required,Van Route Name',
      'ALDIGOLD,ALDI-GOLD,A,"Aldi, Goldthorpe",Commercial Road,,,Goldthorpe,South Yorkshire,S63 9BL,GB,53.534,-1.302,Goods In,,0123456789,,goods@example.com,,,,,,,,,30,2,45,3,Artic,TRUE,,NORTH,TRUE,',
    ].join('\r\n');

    const records = parseRoadrunnerSiteMasterCsv(csv);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      code: 'ALDIGOLD',
      lookupCode: 'ALDI-GOLD',
      company: 'Aldi, Goldthorpe',
      addTown: 'Goldthorpe',
      addCounty: 'South Yorkshire',
      addPostcode: 'S63 9BL',
      latitude: 53.534,
      longitude: -1.302,
      telephone: '0123456789',
      email: 'goods@example.com',
      tailLiftRequired: true,
      bookingRequired: true,
    });
  });

  it('decodes UTF-16LE Roadrunner site exports', () => {
    const source = 'Code,Company\r\nAYLESFOR,WAITROSE LTD.';
    const bytes = new Uint8Array(source.length * 2 + 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let index = 0; index < source.length; index += 1) {
      bytes[2 + index * 2] = source.charCodeAt(index);
    }

    expect(decodeRoadrunnerSiteMasterBytes(bytes.buffer)).toBe(source);
  });

  it('writes enriched order headers and escapes commas and quotes', () => {
    const csv = roadRunnerOrderRowsToCsv([{
      Ref: '123456',
      'Cust Code': 'WAITROS2',
      'Cust Ref': '123456',
      'Cons Ref': 'ORD-1',
      'Order Category': 'Delivery',
      'PO / POS': '123456',
      'Collect Site Code': 'BARFOOT',
      'Collect Lookup Code': 'BARFOOTS',
      'Collect Date': '19/09/2026',
      'Collect Time': '18:00',
      'Collect Time To': '',
      'Collect Company': 'Barfoots Of Botley',
      'Collect Add1': 'Unit 1',
      'Collect Add2': '',
      'Collect Add3': '',
      'Collect Town': 'Chichester',
      'Collect County': 'West Sussex',
      'Collect Postcode': 'PO22 0AQ',
      'Deliver Site Code': 'WAITLEY',
      'Deliver Lookup Code': 'WAITROSE-LEYLAND',
      'Del Date': '20/09/2026',
      'Del Time': '14:30',
      'Del Time To': '',
      Company: 'Road Tech',
      Add1: 'Test Road',
      Add2: '',
      Add3: '',
      Town: 'Shenley',
      County: 'Hertfordshire',
      Postcode: 'WD7 9AN',
      Pallets: 26,
      Weight: 12541.654,
      Cases: 2345,
      Trays: '',
      Trolleys: '',
      Temperature: '+10c',
      'Trailer Notes': '',
      'Driver Instructions': '',
      Comment: 'Pre Book, then "call"',
      'TMS Order ID': 'order-1',
      'Source Subject': '',
      'Source Attachment': '',
    }]);

    expect(csv.split('\r\n')[0]).toContain('Ref,Cust Code,Cust Ref,Cons Ref,Order Category,PO / POS');
    expect(csv).toContain('"Pre Book, then ""call"""');
  });

  it('escapes commas and quotes in detailed run CSV values', () => {
    const csv = roadRunnerRowsToCsv([{ RunReference: 'AM 12', PlannerNotes: 'Collect, then "call"' }]);
    expect(csv).toContain('"Collect, then ""call"""');
  });
});
