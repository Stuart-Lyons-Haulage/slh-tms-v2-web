export type WarehouseMovement = {
  direction: 'Inbound' | 'Outbound'; loadId: string; runReference: string; period: string;
  driver?: string; vehicle?: string; trailer?: string; customer: string; from?: string; to?: string;
  poReference?: string; loadReference?: string; palletType?: string; plannedPallets: number;
  temperature?: string; dueDate?: string; dueTime?: string; expectedAtUtc?: string; status: string; difference?: number;
};
export type WarehouseDailyResult = {
  planningDate: string; inbound: WarehouseMovement[]; outbound: WarehouseMovement[];
  totals: { inboundRows: number; outboundRows: number; inboundPallets: number; outboundPallets: number };
};

export function warehouseDisplayRows(data: WarehouseDailyResult) {
  return [...data.inbound, ...data.outbound].sort((a, b) =>
    (a.expectedAtUtc || `${data.planningDate}T23:59:59Z`).localeCompare(b.expectedAtUtc || `${data.planningDate}T23:59:59Z`) ||
    a.runReference.localeCompare(b.runReference));
}
