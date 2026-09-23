import { z } from 'zod';
import type { RunAllocationDto } from '../types/dto/allocation';
import type { RunDispatchDto } from '../types/dto/dispatch';
import type { CreateRunDto, RunDto, RunOperationalUpdateDto, RunStopDto } from '../types/dto/run';
import { apiRequest, unknownObjectSchema } from './apiClient';

export const runStopSchema: z.ZodType<RunStopDto> = z.object({
  id: z.string().min(1),
  loadId: z.string().optional(),
  orderId: z.string().optional().nullable().transform(value => value ?? undefined),
  sequence: z.number().int(),
  name: z.string().min(1),
  address: z.string().optional().nullable().transform(value => value ?? undefined),
  siteId: z.string().optional(),
  stopType: z.string().optional(),
  status: z.string().optional(),
  latitude: z.number().optional().nullable().transform(value => value ?? undefined),
  longitude: z.number().optional().nullable().transform(value => value ?? undefined),
  plannedArrivalUtc: z.string().optional().nullable().transform(value => value ?? undefined),
  plannedDepartureUtc: z.string().optional(),
  actualArrivalUtc: z.string().optional(),
  actualDepartureUtc: z.string().optional(),
  pallets: z.number().optional(),
  cases: z.number().optional(),
  trays: z.number().optional(),
  trolleys: z.number().optional(),
  plannerNote: z.string().optional().nullable().transform(value => value ?? undefined),
  notes: z.string().optional(),
});

export const runSchema: z.ZodType<RunDto> = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  rawReference: z.string().optional(),
  planningDate: z.string().min(1),
  status: z.string().min(1),
  vehicleId: z.string().optional().nullable().transform(value => value ?? undefined),
  driverId: z.string().optional().nullable().transform(value => value ?? undefined),
  trailerId: z.string().optional().nullable().transform(value => value ?? undefined),
  routeName: z.string().optional(),
  wave: z.string().optional(),
  startTime: z.string().optional(),
  signOnTime: z.string().optional(),
  overnight: z.boolean().optional(),
  nightOutRequired: z.boolean().optional(),
  palletSpacesUsed: z.number().optional().nullable().transform(value => value ?? undefined),
  totalPalletSpaces: z.number().optional().nullable().transform(value => value ?? undefined),
  capacityType: z.string().optional().nullable().transform(value => value ?? undefined),
  depotSplits: z.string().optional().nullable().transform(value => value ?? undefined),
  temperatureC: z.number().optional().nullable().transform(value => value ?? undefined),
  plannerNotes: z.string().optional().nullable().transform(value => value ?? undefined),
  utilisationPercent: z.number().optional().nullable().transform(value => value ?? undefined),
  notes: z.string().optional(),
  createdAtUtc: z.string().optional(),
  stops: z.array(runStopSchema),
});

const dispatchSchema: z.ZodType<RunDispatchDto> = z.object({
  reference: z.string().min(1),
  planningDate: z.string().min(1),
  status: z.string().min(1),
  driver: z.object({ displayName: z.string(), employeeNumber: z.string(), mobileNumber: z.string().optional().nullable().transform(value => value ?? undefined) }).optional().nullable().transform(value => value ?? undefined),
  vehicle: z.object({ registration: z.string(), fleetNumber: z.string().optional().nullable().transform(value => value ?? undefined) }).optional().nullable().transform(value => value ?? undefined),
  trailer: z.object({ trailerNumber: z.string(), type: z.string().optional().nullable().transform(value => value ?? undefined) }).optional().nullable().transform(value => value ?? undefined),
  stops: z.array(z.object({
    sequence: z.number().int(),
    name: z.string().min(1),
    address: z.string().optional().nullable().transform(value => value ?? undefined),
    order: z.object({
      reference: z.string(), customerCode: z.string(), sellerName: z.string().optional().nullable().transform(value => value ?? undefined), marketName: z.string().optional().nullable().transform(value => value ?? undefined), stallNumber: z.string().optional().nullable().transform(value => value ?? undefined), driverInstructions: z.string().optional().nullable().transform(value => value ?? undefined), mapLink: z.string().optional().nullable().transform(value => value ?? undefined),
    }).optional().nullable().transform(value => value ?? undefined),
  })),
});

const allocationCheckSchema = z.object({ warning: z.boolean(), protectedVehicle: z.boolean(), driverName: z.string().optional().nullable().transform(value => value ?? undefined), vehicleRegistration: z.string().optional().nullable().transform(value => value ?? undefined), confidencePercent: z.number().optional().nullable().transform(value => value ?? undefined), observedDays: z.number().optional().nullable().transform(value => value ?? undefined), nextPlannedDate: z.string().optional().nullable().transform(value => value ?? undefined), prompt: z.string().optional().nullable().transform(value => value ?? undefined) });

export type Run = RunDto;
export type RunStop = RunStopDto;
export type RunDispatch = RunDispatchDto;
export type CreateRun = CreateRunDto;
export type RunAllocation = RunAllocationDto;

function naturalRunNumber(reference: string) {
  const patterns = [/^PLAN-\d{8}-(\d+)$/i, /^RUN-\d{8}-(\d+)$/i, /^L0*(\d+)$/i, /(?:^|[-_\s])RUN[-_\s]*0*(\d+)(?:$|[-_\s])/i, /(?:^|[-_\s])0*(\d+)$/];
  for (const pattern of patterns) { const match = reference.trim().match(pattern); if (match) return Number(match[1]); }
  return Number.MAX_SAFE_INTEGER;
}

export function compareRuns(left: Pick<Run, 'planningDate' | 'reference'>, right: Pick<Run, 'planningDate' | 'reference'>) {
  const date = left.planningDate.localeCompare(right.planningDate); if (date) return date;
  const number = naturalRunNumber(left.reference) - naturalRunNumber(right.reference); if (number) return number;
  return left.reference.localeCompare(right.reference, undefined, { numeric: true, sensitivity: 'base' });
}

export async function listRuns(date?: string, token?: string): Promise<Run[]> {
  const path = `/api/v1/runs${date ? `?date=${encodeURIComponent(date)}` : ''}`;
  const runs = await apiRequest(path, z.array(runSchema), token);
  return [...runs].sort(compareRuns);
}

export function createRun(payload: CreateRun, token?: string): Promise<Run> { return apiRequest('/api/v1/runs', runSchema, token, { method: 'POST', body: JSON.stringify(payload) }); }

async function confirmPreferredVehicle(runId: string, payload: RunAllocation, token?: string) {
  if (!payload.vehicleId || !payload.driverId) return;
  try {
    const run = (await listRuns(undefined, token)).find(item => item.id === runId); if (!run?.planningDate) return;
    const query = new URLSearchParams({ vehicleId: payload.vehicleId, driverId: payload.driverId, date: run.planningDate });
    const check = await apiRequest(`/api/v1/driver-vehicle-preferences/allocation-check?${query}`, allocationCheckSchema, token);
    if (!check.warning || !check.prompt) return;
    const heading = check.protectedVehicle ? 'Protected regular vehicle' : 'Regular vehicle warning';
    if (!window.confirm(`${heading}\n\n${check.prompt}\n\nContinue with this allocation anyway?`)) throw new Error('Allocation cancelled. Choose another vehicle or keep the regular vehicle with its usual driver.');
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Allocation cancelled')) throw error;
    console.warn('Preferred vehicle allocation check was unavailable; allocation will continue.', error);
  }
}

export async function allocateRun(id: string, payload: RunAllocation, token?: string): Promise<Run> { await confirmPreferredVehicle(id, payload, token); return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/allocation`, runSchema, token, { method: 'PUT', body: JSON.stringify(payload) }); }
export function updateRunOperational(id: string, payload: RunOperationalUpdateDto, token?: string): Promise<Run> { return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/operational`, runSchema, token, { method: 'PUT', body: JSON.stringify(payload) }); }
export function updateRunStops(id: string, stops: CreateRun['stops'], token?: string): Promise<Run> { const path = stops.length === 0 ? `/api/v1/planning-control/runs/${encodeURIComponent(id)}/stops` : `/api/v1/runs/${encodeURIComponent(id)}/stops`; return apiRequest(path, runSchema, token, { method: 'PUT', body: JSON.stringify(stops) }); }
export function getRunRoute(id: string, token?: string): Promise<Record<string, unknown>> { return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/route`, unknownObjectSchema, token); }
export function getDriverDispatchRoute(id: string, token?: string): Promise<Record<string, unknown>> { return apiRequest(`/api/v1/driver-dispatch-routes/${encodeURIComponent(id)}`, unknownObjectSchema, token); }
export function getRunDispatch(id: string, token?: string): Promise<RunDispatch> { return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/dispatch`, dispatchSchema, token); }
export function updateRunStatus(id: string, status: string, token?: string): Promise<Run> { return apiRequest(`/api/v1/runs/${encodeURIComponent(id)}/status`, runSchema, token, { method: 'PUT', body: JSON.stringify({ status }) }); }

export const runsApi = { list: listRuns, create: createRun, allocate: allocateRun, updateOperational: updateRunOperational, updateStops: updateRunStops, route: getRunRoute, dispatch: getRunDispatch, updateStatus: updateRunStatus };
