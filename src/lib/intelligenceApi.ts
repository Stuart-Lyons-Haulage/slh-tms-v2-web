import { request } from './api';

export type AttentionItem = { id: string; severity: 'High' | 'Medium' | 'Low'; type: string; title: string; detail: string; entityId?: string; entityType?: string; href: string };
export type AttentionResponse = { planningDate: string; generatedAtUtc: string; source?: string; count: number; items: AttentionItem[] };
export type SearchResult = { type: string; id: string; label: string; detail: string; href: string };
export type FreshnessSource = { name: string; lastUpdatedUtc?: string; ageMinutes?: number; state: 'green' | 'amber' | 'red'; detail?: string; cadence?: string };
export type FreshnessResponse = { generatedAtUtc: string; sources: FreshnessSource[] };
export type TimelineEvent = { atUtc: string; title: string; detail: string; source: string; by?: string };
export type TimelineResponse = { entityType: 'Run' | 'Order'; id: string; reference: string; planningDate?: string; status: string; events: TimelineEvent[] };
export type PlanLockInfo = { planningDate: string; lockedAtUtc: string; lockedBy?: string; baselineRuns: number };
export type ReadinessResponse = { planningDate: string; generatedAtUtc: string; source?: string; ready: boolean; runs: number; assignedDrivers: number; activeDrivers: number; assignedVehicles: number; assignedVehicleIds?: string[]; activeVehicles: number; missingAllocations: number; vorConflicts: number; tachoConcerns: number; geofenceGaps: number; unreviewedOrders: number; planLock?: PlanLockInfo };
export type PlanStabilityResponse = { from: string; to: string; lockedDays: number; baselineRuns: number; changedRuns: number; stabilityPercent?: number; driverSwaps: number; vehicleSwaps: number; routeAmendments: number; runChanges: number };

type ConfidenceResponse = {
  generatedAtUtc: string;
  sageHr: { lastSyncUtc?: string };
  tachoMaster: { lastSyncUtc?: string };
  dotTracking: { latestEventUtc?: string };
  emailIntake: { lastReceivedUtc?: string };
};

type SystemSyncState = {
  status: string;
  generatedAtUtc: string;
  lastPlatformUpdateUtc?: string;
  schedules: { dot: string; tachoMaster: string; sageHr: string; fleetio: string };
  providers: Array<{ name: string; configured: boolean; state: string; lastUpdatedUtc?: string; ageMinutes?: number }>;
};

function colourForProviderState(state: string): FreshnessSource['state'] {
  if (state === 'current') return 'green';
  if (state === 'pending') return 'amber';
  return 'red';
}

function providerDisplayName(name: string) {
  return name === 'DOT / Falcon' ? 'Tracking' : name;
}

function providerCadence(name: string, schedules: SystemSyncState['schedules']) {
  if (name === 'DOT / Falcon') return schedules.dot;
  if (name === 'TachoMaster') return schedules.tachoMaster;
  if (name === 'Sage HR') return schedules.sageHr;
  if (name === 'Fleetio') return schedules.fleetio;
  return undefined;
}

function mailboxSource(lastReceivedUtc: string | undefined, now: number): FreshnessSource {
  const ageMinutes = lastReceivedUtc ? Math.max(0, (now - new Date(lastReceivedUtc).getTime()) / 60000) : undefined;
  return {
    name: 'Info mailbox',
    lastUpdatedUtc: lastReceivedUtc,
    ageMinutes: ageMinutes == null ? undefined : Math.round(ageMinutes * 10) / 10,
    state: ageMinutes == null || ageMinutes > 36 * 60 ? 'amber' : 'green',
    cadence: 'event-driven',
    detail: lastReceivedUtc
      ? 'Info mailbox is event-driven · this timestamp is the last transport email received, not a connectivity heartbeat.'
      : 'Info mailbox is event-driven · no mailbox order receipt has been recorded yet, so connectivity is unconfirmed rather than failed.',
  };
}

async function freshness(token?: string): Promise<FreshnessResponse> {
  const [systemState, confidence] = await Promise.all([
    request<SystemSyncState>('/api/v1/system-sync/state', token),
    request<ConfidenceResponse>('/api/v1/operations/confidence', token).catch(() => null),
  ]);
  const now = Date.now();
  const providers = systemState.providers.map<FreshnessSource>((provider) => {
    const cadence = providerCadence(provider.name, systemState.schedules);
    return {
      name: providerDisplayName(provider.name),
      lastUpdatedUtc: provider.lastUpdatedUtc,
      ageMinutes: provider.ageMinutes,
      state: colourForProviderState(provider.state),
      cadence,
      detail: provider.state === 'current'
        ? `Receiving on expected cadence${cadence ? ` · ${cadence}` : ''}.`
        : provider.state === 'pending'
          ? `Configured but no completed receipt is recorded yet${cadence ? ` · expected ${cadence}` : ''}.`
          : provider.state === 'not-configured'
            ? 'Integration is not configured.'
            : `No data has been received within the expected cadence${cadence ? ` · expected ${cadence}` : ''}.`,
    };
  });

  const mailbox = confidence
    ? mailboxSource(confidence.emailIntake.lastReceivedUtc, now)
    : { name: 'Info mailbox', state: 'red' as const, cadence: 'event-driven', detail: 'Mailbox receipt evidence could not be checked.' };

  return {
    generatedAtUtc: systemState.generatedAtUtc,
    sources: [...providers, mailbox],
  };
}

export const intelligenceApi = {
  attention: (date: string, token?: string) => request<AttentionResponse>(`/api/v1/operations/attention-snapshot?date=${encodeURIComponent(date)}`, token, undefined, 40000),
  search: (q: string, token?: string) => request<SearchResult[]>(`/api/v1/intelligence/search?q=${encodeURIComponent(q)}`, token),
  freshness,
  runTimeline: (id: string, token?: string) => request<TimelineResponse>(`/api/v1/intelligence/run-timeline/${encodeURIComponent(id)}`, token, undefined, 40000),
  orderTimeline: (id: string, token?: string) => request<TimelineResponse>(`/api/v1/intelligence/timeline/order/${encodeURIComponent(id)}`, token, undefined, 40000),
  planLock: (date: string, token?: string) => request<PlanLockInfo | null>(`/api/v1/intelligence/plan-lock/${encodeURIComponent(date)}`, token),
  lockPlan: (date: string, token?: string) => request<PlanLockInfo>(`/api/v1/intelligence/plan-lock/${encodeURIComponent(date)}`, token, { method: 'POST' }),
  readiness: (date: string, token?: string) => request<ReadinessResponse>(`/api/v1/runs/readiness?date=${encodeURIComponent(date)}`, token, undefined, 40000),
  stability: (from: string, to: string, token?: string) => request<PlanStabilityResponse>(`/api/v1/intelligence/plan-stability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token, undefined, 40000),
};
