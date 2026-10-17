import { describe, expect, it } from 'vitest';
import { warehouseDisplayRows, type WarehouseDailyResult } from './warehousePlanningData';

describe('warehouseDisplayRows', () => {
  it('keeps inbound and outbound movements ordered by expected warehouse time', () => {
    const data: WarehouseDailyResult = {
      planningDate: '2026-09-08',
      totals: { inboundRows: 1, outboundRows: 1, inboundPallets: 17, outboundPallets: 26 },
      inbound: [{ direction: 'Inbound', loadId: '1', runReference: 'RUN 4 PM', period: 'PM', driver: 'Adam Smith', customer: 'WAITROSE', from: 'Vitacress Runcton', to: 'Barnham Coldstore', palletType: 'Standard', plannedPallets: 17, expectedAtUtc: '2026-09-08T18:30:00Z', status: 'Planned' }],
      outbound: [{ direction: 'Outbound', loadId: '2', runReference: 'RUN 7 PM', period: 'PM', driver: 'Dean Bramley', customer: 'COOP', from: 'Stuart Lyons Distribution', to: 'Andover', palletType: 'Standard', plannedPallets: 26, expectedAtUtc: '2026-09-08T20:00:00Z', status: 'Dispatched' }],
    };

    expect(warehouseDisplayRows(data).map(row => [row.direction, row.runReference, row.plannedPallets])).toEqual([
      ['Inbound', 'RUN 4 PM', 17],
      ['Outbound', 'RUN 7 PM', 26],
    ]);
  });
});
