import { z, type ZodType } from 'zod';
import { trackApiRequest } from '../lib/performanceTelemetry';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/tms-api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly endpoint?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export class DataIntegrityError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly issues: z.core.$ZodIssue[],
  ) {
    super(`The TMS API returned data that does not match the contract for ${endpoint}.`);
    this.name = 'DataIntegrityError';
  }

  get summary() {
    return this.issues.slice(0, 5).map(issue => {
      const path = issue.path.length ? issue.path.join('.') : 'response';
      return `${path}: ${issue.message}`;
    }).join('; ');
  }
}

let recentPlanChangeReason: { value: string; at: number } | undefined;

function headersFor(token: string | undefined, init: RequestInit | undefined) {
  return new Headers({
    Accept: 'application/json',
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers || {}),
  });
}

function isPlanMutation(path: string, method: string) {
  return method !== 'GET' && (/\/api\/v1\/(?:runs|loads)(?:\/|$)/.test(path) || path.includes('/api/v1/planning-control/runs/'));
}

async function tryPlanLockRetry(path: string, token: string | undefined, init: RequestInit | undefined, response: Response) {
  if (response.status !== 409) return response;
  const method = String(init?.method || 'GET').toUpperCase();
  if (!isPlanMutation(path, method)) return response;

  const payload = await response.clone().json().catch(() => null) as { detail?: string } | null;
  if (!payload?.detail?.startsWith('PLAN_LOCKED:')) return response;

  const now = Date.now();
  const cached = recentPlanChangeReason && now - recentPlanChangeReason.at < 30_000
    ? recentPlanChangeReason.value
    : undefined;
  const reason = cached || window.prompt('This planning day is locked. Enter the reason for this change:')?.trim();
  if (!reason) return response;

  recentPlanChangeReason = { value: reason, at: now };
  const retryHeaders = headersFor(token, init);
  retryHeaders.set('X-Plan-Change-Reason', reason);
  return fetch(`${apiBaseUrl}${path}`, { ...init, headers: retryHeaders });
}

async function throwApiError(path: string, response: Response): Promise<never> {
  const payload = await response.clone().json().catch(() => null) as { detail?: string; message?: string } | null;
  const message = response.status === 403
    ? 'Microsoft sign-in worked, but your account has not been granted TMS API access yet.'
    : payload?.detail || payload?.message || `Request failed (${response.status}).`;
  throw new ApiError(response.status, message, path);
}

export async function apiRequest<TSchema extends ZodType>(
  path: string,
  schema: TSchema,
  token?: string,
  init?: RequestInit,
): Promise<z.output<TSchema>> {
  if (!apiBaseUrl) throw new ApiError(0, 'Set VITE_API_BASE_URL to connect the TMS API.', path);

  const startedAt = performance.now();
  const method = String(init?.method || 'GET').toUpperCase();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: headersFor(token, init) });
  } catch (error) {
    trackApiRequest(path, method, performance.now() - startedAt, 0, true);
    throw error;
  }
  trackApiRequest(path, method, performance.now() - startedAt, response.status, !response.ok);
  const finalResponse = await tryPlanLockRetry(path, token, init, response);
  if (!finalResponse.ok) await throwApiError(path, finalResponse);

  if (finalResponse.status === 204) {
    const result = schema.safeParse(undefined);
    if (!result.success) throw new DataIntegrityError(path, result.error.issues);
    return result.data;
  }

  const payload: unknown = await finalResponse.json();
  const result = schema.safeParse(payload);
  if (!result.success) throw new DataIntegrityError(path, result.error.issues);
  return result.data;
}

export const unknownObjectSchema = z.record(z.string(), z.unknown());
