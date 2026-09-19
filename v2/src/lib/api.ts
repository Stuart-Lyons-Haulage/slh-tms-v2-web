export type IntakeReviewRecord = {
  id: string;
  evidenceId: string;
  extractedJson: string;
  resolutionJson?: string | null;
  state: string | number;
  confidence: number;
  reviewReason?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
};

export type MasterRecord = Record<string, unknown> & {
  id: string;
  active?: boolean;
};

export type MasterReviewItem = MasterRecord & {
  key: string;
  category: string;
  entityType: string;
  sourceReference?: string | null;
  summary: string;
  payloadJson?: string | null;
  resolved: boolean;
  resolutionNotes?: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
};

export type SiteCrmProfile = {
  site: MasterRecord;
  customer?: MasterRecord | null;
  aliases: MasterRecord[];
  cutoffs: MasterRecord[];
  markets: MasterRecord[];
  externalIdentities: MasterRecord[];
  routeTimes: MasterRecord[];
  customerContacts: MasterRecord[];
  reviewItems: MasterReviewItem[];
};

export type ReviewAllocation = {
  id: string;
  kind: 'review' | 'alias' | 'routeTiming' | 'customerContact';
  category: string;
  summary: string;
  reference?: string | null;
  source?: string | null;
};

export type MasterCounts = {
  customers: number;
  sites: number;
  markets: number;
  drivers: number;
  vehicles: number;
  fuelCards: number;
  trailers: number;
  customerContacts: number;
  marketContacts: number;
  siteCutoffs: number;
  routeTimes: number;
  fuelPrices: number;
  aliasCandidates: number;
  reviewItems: number;
};

export type PlanningPeriod = 'AM' | 'PM' | 0 | 1;

export type PlanningMovement = {
  movementKey: string;
  period: PlanningPeriod;
  collectionSiteId: string;
  collectionSite: string;
  deliverySiteId: string;
  deliverySite: string;
  orderCount: number;
  totalStandardPallets: number;
  plannedStandardPallets: number;
  remainingStandardPallets: number;
  totalEuroPallets: number;
  plannedEuroPallets: number;
  remainingEuroPallets: number;
  totalTrolleys: number;
  plannedTrolleys: number;
  remainingTrolleys: number;
  temperatureRequirement?: string | null;
  trailerRequirement?: string | null;
  latestCollectionTime?: string | null;
  latestDeliveryTime?: string | null;
};

export type RunMovement = {
  movementKey: string;
  collectionSiteId: string;
  collectionSite: string;
  deliverySiteId: string;
  deliverySite: string;
  standardPallets: number;
  euroPallets: number;
  trolleys: number;
};

export type CapacityView = {
  status: string;
  utilisationPercent?: number | null;
  standardPallets: number;
  euroPallets: number;
  trolleys: number;
  standardCapacity?: number | null;
  euroCapacity?: number | null;
  trolleyCapacity?: number | null;
  equivalentUsed?: number | null;
  equivalentCapacity?: number | null;
  message: string;
};

export type PlanningRun = {
  id: string;
  runNumber: string;
  planDate: string;
  period: PlanningPeriod;
  driverId?: string | null;
  driver?: string | null;
  vehicleId?: string | null;
  vehicle?: string | null;
  trailerId?: string | null;
  trailer?: string | null;
  startTime?: string | null;
  nightOut: boolean;
  trailerSwapNotes?: string | null;
  notes?: string | null;
  capacityOverrideReason?: string | null;
  state: string | number;
  capacity: CapacityView;
  movements: RunMovement[];
};

export type PalletMatrixCell = {
  collectionSiteId: string;
  collectionSite: string;
  deliverySiteId: string;
  deliverySite: string;
  totalStandardPallets: number;
  plannedStandardPallets: number;
  outstandingStandardPallets: number;
  totalEuroPallets: number;
  plannedEuroPallets: number;
  outstandingEuroPallets: number;
  totalTrolleys: number;
  plannedTrolleys: number;
  outstandingTrolleys: number;
};

export type PlanningSnapshot = {
  planDate: string;
  movements: PlanningMovement[];
  runs: PlanningRun[];
  palletMatrix: PalletMatrixCell[];
};

export type MasterWorkbookImportResult = {
  committed: boolean;
  rows: Record<string, number>;
  issues: string[];
};

const configuredBase = import.meta.env.VITE_API_BASE?.trim();
const API_BASE = configuredBase
  ? configuredBase.replace(/\/$/, '')
  : '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const api = {
  planningSnapshot: (date: string) =>
    request<PlanningSnapshot>(`/api/v2/planning?date=${encodeURIComponent(date)}`),

  createPlanningRun: (planDate: string, period: 'AM' | 'PM', runNumber?: string) =>
    request('/api/v2/planning/runs', {
      method: 'POST',
      body: JSON.stringify({ planDate, period, runNumber: runNumber || null }),
    }),

  updatePlanningRun: (id: string, payload: Record<string, unknown>) =>
    request(`/api/v2/planning/runs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  setPlanningMovement: (
    runId: string,
    movementKey: string,
    standardPallets: number,
    euroPallets: number,
    trolleys: number,
  ) =>
    request(`/api/v2/planning/runs/${runId}/movement`, {
      method: 'PUT',
      body: JSON.stringify({ movementKey, standardPallets, euroPallets, trolleys }),
    }),

  intakeReview: () =>
    request<IntakeReviewRecord[]>('/api/v2/intake/review'),

  resolveIntake: (id: string) =>
    request(`/api/v2/intake/${id}/resolve`, { method: 'POST' }),

  approveIntake: (id: string) =>
    request(`/api/v2/intake/${id}/approve`, { method: 'POST' }),

  promoteIntake: (id: string) =>
    request(`/api/v2/intake/${id}/promote`, { method: 'POST' }),

  customers: () => request<MasterRecord[]>('/api/v2/master/customers'),
  sites: () => request<MasterRecord[]>('/api/v2/master/sites'),
  markets: () => request<MasterRecord[]>('/api/v2/master/markets'),
  drivers: () => request<MasterRecord[]>('/api/v2/master/drivers'),
  vehicles: () => request<MasterRecord[]>('/api/v2/master/vehicles'),
  fuelCards: () => request<MasterRecord[]>('/api/v2/master/fuel-cards'),
  trailers: () => request<MasterRecord[]>('/api/v2/master/trailers'),
  customerContacts: () => request<MasterRecord[]>('/api/v2/master/customer-contacts'),
  marketContacts: () => request<MasterRecord[]>('/api/v2/master/market-contacts'),
  siteCutoffs: () => request<MasterRecord[]>('/api/v2/master/site-cutoffs'),
  routeTimes: () => request<MasterRecord[]>('/api/v2/master/route-times'),
  fuelPrices: () => request<MasterRecord[]>('/api/v2/master/fuel-prices'),
  aliasCandidates: () => request<MasterRecord[]>('/api/v2/master/alias-candidates'),
  masterReview: () => request<MasterReviewItem[]>('/api/v2/master/review'),
  reviewAllocations: () => request<ReviewAllocation[]>('/api/v2/master/review/allocations'),
  allocateReviewToSite: (kind: string, id: string, siteId: string) =>
    request('/api/v2/master/review/allocate-site', {
      method: 'POST',
      body: JSON.stringify({ kind, id, siteId }),
    }),
  siteCrm: (id: string) => request<SiteCrmProfile>(`/api/v2/master/sites/${id}/crm`),
  masterCounts: () => request<MasterCounts>('/api/v2/master/summary'),

  updateMasterRecord: (entity: string, id: string, payload: Record<string, unknown>) =>
    request<MasterRecord>(`/api/v2/master/${entity}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteMasterRecord: async (entity: string, id: string) => {
    const response = await fetch(`${API_BASE}/api/v2/master/${entity}/${id}`, {
      method: 'DELETE',
    });
    if (response.ok) return;

    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep HTTP status when the response has no JSON body.
    }
    throw new Error(message);
  },

  uploadMasterWorkbook(file: File, commit: boolean) {
    const form = new FormData();
    form.append('file', file);
    return request<MasterWorkbookImportResult>(
      `/api/v2/master/import/workbook?commit=${commit ? 'true' : 'false'}`,
      { method: 'POST', body: form },
    );
  },
};
