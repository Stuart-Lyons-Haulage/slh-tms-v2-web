import { request, type TransportOrder } from "./api";

export type OrderUpdatePayload = {
  reference: string;
  customerCode: string;
  collectionDate: string;
  deliveryDate?: string;
  deliveryWindowStartUtc?: string;
  deliveryWindowEndUtc?: string;
  pallets?: number;
  collectionSite?: string;
  depotId?: string;
  destination?: string;
  deliveryAddress?: string;
  customerRef?: string;
  poRef?: string;
  palletName?: string;
  unitType?: string;
  notes?: string;
  mapLink?: string;
};

export const orderMaintenance = {
  update: (id: string, payload: OrderUpdatePayload, token?: string) =>
    request<TransportOrder>(`/api/v1/operational-recovery/orders/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  cancel: (id: string, token?: string) =>
    request<{ id: string; reference: string; status: string; removedStops: number; warning?: string }>(
      `/api/v1/operational-recovery/orders/${id}`,
      token,
      { method: "DELETE" },
    ),
};
