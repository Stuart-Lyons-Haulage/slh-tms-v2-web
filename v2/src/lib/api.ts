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
  reviewItems: MasterReviewItem[];
};

export type MasterCounts = {
  customers: number;
  sites: number;
  markets: number;
  drivers: number;
  vehicles: number;
  trailers: number;
  customerContacts: number;
  marketContacts: number;
  siteCutoffs: number;
  routeTimes: number;
  fuelPrices: number;
  aliasCandidates: number;
  reviewItems: number;
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
  trailers: () => request<MasterRecord[]>('/api/v2/master/trailers'),
  customerContacts: () => request<MasterRecord[]>('/api/v2/master/customer-contacts'),
  marketContacts: () => request<MasterRecord[]>('/api/v2/master/market-contacts'),
  siteCutoffs: () => request<MasterRecord[]>('/api/v2/master/site-cutoffs'),
  routeTimes: () => request<MasterRecord[]>('/api/v2/master/route-times'),
  fuelPrices: () => request<MasterRecord[]>('/api/v2/master/fuel-prices'),
  aliasCandidates: () => request<MasterRecord[]>('/api/v2/master/alias-candidates'),
  masterReview: () => request<MasterReviewItem[]>('/api/v2/master/review'),
  siteCrm: (id: string) => request<SiteCrmProfile>(`/api/v2/master/sites/${id}/crm`),
  masterCounts: () => request<MasterCounts>('/api/v2/master/summary'),

  uploadMasterWorkbook(file: File, commit: boolean) {
    const form = new FormData();
    form.append('file', file);
    return request<MasterWorkbookImportResult>(
      `/api/v2/master/import/workbook?commit=${commit ? 'true' : 'false'}`,
      { method: 'POST', body: form },
    );
  },
};
