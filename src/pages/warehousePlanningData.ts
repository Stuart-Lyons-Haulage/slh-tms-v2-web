export type WarehouseCheck = {
  movementKey: string; date: string; direction: 'Inbound' | 'Outbound'; action: string;
  actualQuantity: number; note?: string; recordedBy?: string; recordedAtUtc: string;
};
export type WarehouseMovement = {
  direction: 'Inbound' | 'Outbound'; loadId: string; runReference: string; period: string;
  driver?: string; vehicle?: string; trailer?: string; customer: string; from?: string; to?: string;
  poReference?: string; loadReference?: string; palletType?: string; plannedPallets: number;
  temperature?: string; dueDate?: string; dueTime?: string; expectedAtUtc?: string; status: string; difference?: number;
  movementKey?: string; source?: string; onwardTo?: string;
  liveEtaUtc?: string; etaRisk?: string; etaCapturedAtUtc?: string; etaSource?: string;
  actualQuantity?: number; checkedAtUtc?: string; checkedBy?: string; checkHistory?: WarehouseCheck[];
};
export type WarehouseDailyResult = {
  planningDate: string; inbound: WarehouseMovement[]; outbound: WarehouseMovement[];
  totals: { inboundRows: number; outboundRows: number; inboundPallets: number; outboundPallets: number };
};

/** The time the warehouse should expect it: live tracking ETA first, then the planned arrival. */
export function expectedAt(row: WarehouseMovement) {
  return row.liveEtaUtc || row.expectedAtUtc;
}

export function warehouseDisplayRows(data: WarehouseDailyResult) {
  return [...data.inbound, ...data.outbound].sort((a, b) =>
    (expectedAt(a) || `${data.planningDate}T23:59:59Z`).localeCompare(expectedAt(b) || `${data.planningDate}T23:59:59Z`) ||
    a.runReference.localeCompare(b.runReference));
}

export function sortByExpected(rows: WarehouseMovement[], planningDate: string) {
  const late = `${planningDate}T23:59:59Z`;
  return [...rows].sort((a, b) => (expectedAt(a) || late).localeCompare(expectedAt(b) || late) || a.runReference.localeCompare(b.runReference));
}

/** Units are counted per type: trolleys, trays and crates are never added into pallets. */
export function unitLabel(row: WarehouseMovement) {
  const type = (row.palletType || '').toLowerCase();
  if (type.includes('trolley')) return 'trolleys';
  if (type.includes('tray')) return 'trays';
  if (type.includes('crate')) return 'crates';
  return 'pallets';
}
