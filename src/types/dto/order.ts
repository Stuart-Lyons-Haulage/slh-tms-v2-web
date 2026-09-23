export interface OrderDto {
  id: string;
  reference: string;
  customerCode: string;
  customerName?: string;
  customerSupplier?: string;
  jobType?: string;
  purchaseOrderNumber?: string;
  poNumber?: string;
  sourceOrderReference?: string;
  collectionDate: string;
  collectionWindowStartUtc?: string;
  collectionWindowEndUtc?: string;
  collectionSiteId?: string;
  collectionLocation?: string;
  collectionAddress?: string;
  deliveryDate?: string;
  deliveryWindowStartUtc?: string;
  deliveryWindowEndUtc?: string;
  deliverySiteId?: string;
  deliveryLocation?: string;
  deliveryAddress?: string;
  pallets?: number;
  cases?: number;
  trays?: number;
  trolleys?: number;
  temperatureRequirement?: string;
  trailerNotes?: string;
  notes?: string;
  deadlineUtc?: string;
  status: string;
  sellerName?: string;
  marketName?: string;
  stallNumber?: string;
  driverInstructions?: string;
  mapLink?: string;
  sourceEmail?: string;
  sourceSubject?: string;
  sourceAttachmentName?: string;
  sourceAttachmentLink?: string;
  createdAtUtc?: string;
  updatedAtUtc?: string;
}

export interface OrderRevisionDto {
  id: string;
  orderId: string;
  revisionNumber: number;
  status?: string;
  changeSummary?: string;
  payloadHash?: string;
  sourceEmail?: string;
  sourceSubject?: string;
  sourceAttachmentName?: string;
  sourceAttachmentLink?: string;
  createdAtUtc: string;
  createdBy?: string;
}
