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

export type MasterCounts = {
  customers: number;
  sites: number;
  markets: number;
  drivers: number;
};

const configuredBase = import.meta.env.VITE_API_BASE?.trim();
const API_BASE = configuredBase
  ? configuredBase.replace(/\/$/, '')
  : '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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

  customers: () => request<unknown[]>('/api/v2/master/customers'),
  sites: () => request<unknown[]>('/api/v2/master/sites'),
  markets: () => request<unknown[]>('/api/v2/master/markets'),
  drivers: () => request<unknown[]>('/api/v2/master/drivers'),

  async masterCounts(): Promise<MasterCounts> {
    const [customers, sites, markets, drivers] = await Promise.all([
      this.customers(),
      this.sites(),
      this.markets(),
      this.drivers(),
    ]);

    return {
      customers: customers.length,
      sites: sites.length,
      markets: markets.length,
      drivers: drivers.length,
    };
  },
};
