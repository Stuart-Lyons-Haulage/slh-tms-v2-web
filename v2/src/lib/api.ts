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
  suggestedEntityId?: string | null;
  suggestedConfidence?: number | null;
  decision?: string | null;
  resolvedEntityId?: string | null;
  resolvedBy?: string | null;
  resolvedAtUtc?: string | null;
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
  knowledge: MasterRecord[];
  equipment: MasterRecord[];
  bookingRules: MasterRecord[];
  documents: MasterRecord[];
  history: MasterAuditEntry[];
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

export type MasterAuditEntry = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changesJson?: string | null;
  sourceSystem?: string | null;
  updatedBy?: string | null;
  createdAtUtc: string;
};

export type FieldGovernance = {
  id: string;
  entityType: string;
  fieldName: string;
  owner: string;
  sourceSystem?: string | null;
  locked: boolean;
  requiresReview: boolean;
  confidence?: number | null;
  updatedAtUtc: string;
  notes?: string | null;
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
  siteKnowledge: number;
  siteBookingRules: number;
  siteDocuments: number;
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

  updateVehicleFuelCards: (vehicleId: string, payload: Record<string, unknown>) =>
    request<MasterRecord>(`/api/v2/master/fuel-cards/vehicle/${vehicleId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  clearVehicleFuelCards: async (vehicleId: string) => {
    const response = await fetch(`${API_BASE}/api/v2/master/fuel-cards/vehicle/${vehicleId}`, {
      method: 'DELETE',
    });
    if (response.ok) return;

    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep HTTP status if there is no JSON body.
    }
    throw new Error(message);
  },
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

  queueReviewCandidate: (payload: {
    sourceSystem: string;
    entityType: string;
    externalKey: string;
    displayName: string;
    payloadJson?: string | null;
    suggestedEntityId?: string | null;
    confidence?: number | null;
  }) =>
    request('/api/v2/master/review/candidates', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  decideReview: (id: string, decision: string, existingEntityId?: string | null, resolutionNotes?: string | null) =>
    request(`/api/v2/master/review/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, existingEntityId: existingEntityId || null, resolutionNotes: resolutionNotes || null }),
    }),
  siteCrm: (id: string) => request<SiteCrmProfile>(`/api/v2/master/sites/${id}/crm`),
  masterCounts: () => request<MasterCounts>('/api/v2/master/summary'),

  createMasterRecord: (entity: string, payload: Record<string, unknown>) =>
    request<MasterRecord>(`/api/v2/master/${entity}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateMasterRecord: (entity: string, id: string, payload: Record<string, unknown>) =>
    request<MasterRecord>(`/api/v2/master/${entity}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  masterHistory: (entity: string, id: string) =>
    request<MasterAuditEntry[]>(`/api/v2/master/${entity}/${id}/history`),

  governance: () =>
    request<FieldGovernance[]>('/api/v2/master/governance'),

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
