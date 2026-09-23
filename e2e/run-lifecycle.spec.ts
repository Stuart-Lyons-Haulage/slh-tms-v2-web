import { expect, test, type Page, type Route } from '@playwright/test';

const driverId = '11111111-1111-1111-1111-111111111111';
const vehicleId = '22222222-2222-2222-2222-222222222222';
const trailerId = '33333333-3333-3333-3333-333333333333';
const runId = '44444444-4444-4444-4444-444444444444';
const orderId = '55555555-5555-5555-5555-555555555555';
const collectionStopId = '66666666-6666-6666-6666-666666666666';
const deliveryStopId = '77777777-7777-7777-7777-777777777777';

function isoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function atOffset(minutes: number) { return new Date(Date.now() + minutes * 60_000).toISOString(); }
function runReference(date: string) { return `RUN-${date.replaceAll('-', '')}-01`; }

type State = { runCreated: boolean; allocatedPallets: number; driverAssigned: boolean; vehicleAssigned: boolean; trailerAssigned: boolean; geofenceStage: number; planningDate: string };

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function runPayload(state: State) {
  return {
    id: runId,
    reference: runReference(state.planningDate),
    rawReference: runReference(state.planningDate),
    planningDate: state.planningDate,
    status: state.geofenceStage >= 4 ? 'Completed' : state.geofenceStage > 0 ? 'InProgress' : 'Planned',
    palletSpacesUsed: state.allocatedPallets,
    totalPalletSpaces: 26,
    capacityType: 'Standard pallets',
    driverId: state.driverAssigned ? driverId : undefined,
    vehicleId: state.vehicleAssigned ? vehicleId : undefined,
    trailerId: state.trailerAssigned ? trailerId : undefined,
    stops: [
      { id: collectionStopId, loadId: runId, sequence: 1, name: 'Collect · Hall Hunter', address: 'Hall Hunter', plannedArrivalUtc: atOffset(30) },
      { id: deliveryStopId, loadId: runId, orderId, sequence: 2, name: 'Deliver · Leyland', address: 'Leyland', plannedArrivalUtc: atOffset(80) }
    ]
  };
}

async function installApi(page: Page, state: State) {
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.pathname.includes('/api/v1/') && !url.pathname.includes('/api/master/')) return route.continue();
    const path = url.pathname.replace(/^\/tms-api/, '');
    const method = req.method();

    // Current PlannerEnhanced/RunPlannerLive contract.
    if (path === '/api/v1/planning-control/pallets' && method === 'GET') {
      const planned = state.allocatedPallets;
      const outstanding = Math.max(4 - planned, 0);
      return json(route, {
        date: state.planningDate,
        generatedAtUtc: new Date().toISOString(),
        orders: [{
          id: orderId,
          reference: 'HH-E2E-001',
          customerCode: 'Hall Hunter',
          orderedPallets: 4,
          plannedPallets: planned,
          outstandingPallets: outstanding,
          collection: 'Hall Hunter',
          destination: 'Leyland',
          source: 'E2E',
          allocations: planned > 0 ? [{ loadId: runId, loadReference: runReference(state.planningDate), pallets: planned }] : []
        }],
        summary: { ordered: 4, planned, outstanding }
      });
    }
    if (path === '/api/v1/planning-control/allocations' && method === 'POST') {
      const body = req.postDataJSON() as { pallets?: number };
      state.allocatedPallets = Number(body.pallets || 0);
      return json(route, { orderId, loadId: runId, allocatedToRun: state.allocatedPallets, plannedPallets: state.allocatedPallets, orderedPallets: 4, outstandingPallets: Math.max(4 - state.allocatedPallets, 0), overplannedPallets: 0 });
    }
    if (path === '/api/v1/runs' && method === 'GET') return json(route, state.runCreated ? [runPayload(state)] : []);
    if (path === '/api/v1/runs' && method === 'POST') {
      state.runCreated = true;
      return json(route, runPayload(state));
    }
    if (path === `/api/v1/runs/${runId}/stops` && method === 'PUT') return json(route, runPayload(state));
    if (path === `/api/v1/planning-control/runs/${runId}/stops` && method === 'PUT') return json(route, runPayload(state));

    if (path === '/api/v1/driver-dispatch' && method === 'GET') return json(route, {
      planningDate: state.planningDate,
      drivers: [{ driverId, employeeNumber: 'D001', displayName: 'Test Driver', driverType: 'Employed', dayNumber: 1, onLeave: false, assignedLoadId: state.driverAssigned ? runId : undefined, assignedRunCount: state.driverAssigned ? 1 : 0 }],
      vehicles: [{ id: vehicleId, registration: 'AB12 CDE', active: true }],
      trailers: [{ id: trailerId, trailerNumber: 'TRL-101', active: true }],
      loads: state.runCreated ? [{ ...runPayload(state), southbound: false }] : []
    });
    if (path === '/api/v1/driver-dispatch-status' && method === 'GET') return json(route, { planningDate: state.planningDate, drivers: [{
      driverId,
      dispatchStatus: state.driverAssigned ? 'Awaiting Dispatch' : 'No Run',
      operationalStatus: state.geofenceStage >= 4 ? 'Completed' : state.geofenceStage > 0 ? 'Working' : state.driverAssigned ? 'Awaiting Dispatch' : 'No Run',
      driverConfirmed: false,
      weeklyRestStatus: 'Ready', weeklyRestMessage: 'Ready', availabilityStatus: 'Available', availabilityMessage: 'Available', projectedDayNumber: 1
    }] });
    // Driver Dispatch uses the canonical resilient Run allocation endpoint. Return the full
    // saved run so the UI can validate that the selected driver/vehicle/trailer actually stuck.
    if (path === `/api/v1/runs/${runId}/allocation` && method === 'PUT') {
      state.driverAssigned = true; state.vehicleAssigned = true; state.trailerAssigned = true;
      return json(route, runPayload(state));
    }
    // Keep the legacy mock only for older branches; current production code does not use it.
    if (path.includes('/api/v1/driver-dispatch/') && method === 'PUT') {
      state.driverAssigned = true; state.vehicleAssigned = true; state.trailerAssigned = true;
      return json(route, runPayload(state));
    }

    if (path === '/api/v1/drivers' && method === 'GET') return json(route, [{ id: driverId, employeeNumber: 'D001', displayName: 'Test Driver', active: true }]);
    if (path === '/api/v1/vehicles' && method === 'GET') return json(route, [{ id: vehicleId, registration: 'AB12 CDE', active: true }]);
    if (path === '/api/v1/trailers' && method === 'GET') return json(route, [{ id: trailerId, trailerNumber: 'TRL-101', active: true }]);
    // Driver Dispatch also enriches its workbench from the governed master-data
    // projection. Keep this workflow test self-contained by mocking those reads.
    if (path === '/api/master/drivers' && method === 'GET') return json(route, [{ driverId: 'D001', fullName: 'Test Driver', preferredName: 'Test Driver' }]);
    if (path === '/api/master/vehicles' && method === 'GET') return json(route, [{ vehicleId, registration: 'AB12 CDE' }]);
    if (path === '/api/master/trailers' && method === 'GET') return json(route, [{ trailerId, trailerNumber: 'TRL-101' }]);
    if (path === '/api/master/customers' && method === 'GET') return json(route, []);
    if (path === '/api/master/sites' && method === 'GET') return json(route, []);
    if (path.startsWith('/api/master/')) return json(route, []);
    if (path === '/api/v1/sites' && method === 'GET') return json(route, []);
    if (path === '/api/v1/orders' && method === 'GET') return json(route, []);
    if (path === '/api/v1/loads' && method === 'GET') return json(route, []);
    if (path === '/api/v1/master-data/summary' && method === 'GET') return json(route, {});
    if (path === '/api/v1/operations/control' && method === 'GET') return json(route, { date: state.planningDate, rows: [] });
    if (path === '/api/v1/operations/read-model' && method === 'GET') return json(route, { planningDate: state.planningDate, runs: [] });
    if (path === '/api/v1/operations/control/refresh' && method === 'POST') return json(route, { ok: true });
    if (path === '/api/v1/integrations/summary' && method === 'GET') return json(route, []);
    if (path === '/api/v1/integrations/health' && method === 'GET') return json(route, []);
    if (path === '/api/v1/dashboard/summary' && method === 'GET') return json(route, {});
    if (path === '/api/v1/dashboard/attention' && method === 'GET') return json(route, []);
    if (path === '/api/v1/planner/summary' && method === 'GET') return json(route, {});
    if (path === '/api/v1/planner/assistant' && method === 'GET') return json(route, []);
    if (path === '/api/v1/planner/suggestions' && method === 'GET') return json(route, []);
    if (path === '/api/v1/planner-starts' && method === 'GET') return json(route, { planningDate: state.planningDate, rows: [] });

    // Current Operations Wallboard contract: the board is anchored by planned-runs and
    // driver-assignments; live/geofence feeds enrich those rows rather than creating them.
    if (path === '/api/v1/tv-display/planned-runs' && method === 'GET') return json(route, state.runCreated ? [runPayload(state)] : []);
    if (path === '/api/v1/driver-assignments' && method === 'GET') return json(route, state.driverAssigned ? [{
      loadId: runId,
      loadReference: runReference(state.planningDate),
      planningDate: state.planningDate,
      driverId,
      driver: { id: driverId, employeeNumber: 'D001', displayName: 'Test Driver' },
      vehicleId,
      vehicle: { id: vehicleId, registration: 'AB12 CDE' },
      trailerId,
      trailerNumber: 'TRL-101'
    }] : []);
    if (path === '/api/v1/run-geofence-coverage' && method === 'GET') return json(route, { rows: [] });
    if (path === '/api/v1/operations/delivery-etas' && method === 'GET') return json(route, { planningDate: state.planningDate, calculatedAtUtc: new Date().toISOString(), records: [] });

    if (path === '/api/v1/run-progress' && method === 'GET') {
      const completedStops = state.geofenceStage < 2 ? 0 : state.geofenceStage < 4 ? 1 : 2;
      const runState = state.geofenceStage >= 4 ? 'Completed' : state.geofenceStage === 1 || state.geofenceStage === 3 ? 'OnSiteConfirmed' : state.geofenceStage > 1 ? 'InProgress' : 'Planned';
      const currentVisit = state.geofenceStage === 1
        ? { geofenceName: 'Hall Hunter', loadStopId: collectionStopId, enteredAtUtc: atOffset(25), siteArrivalUtc: atOffset(25), dwellMinutes: 5, isDelayed: false, status: 'OnSite' }
        : state.geofenceStage === 3
          ? { geofenceName: 'Leyland', loadStopId: deliveryStopId, enteredAtUtc: atOffset(75), siteArrivalUtc: atOffset(75), dwellMinutes: 5, isDelayed: false, status: 'OnSite' }
          : undefined;
      return json(route, {
        planningDate: state.planningDate,
        calculatedAtUtc: new Date().toISOString(),
        geofenceAvailable: true,
        geofenceConfiguredRuns: state.runCreated ? 1 : 0,
        geofenceLinkedRuns: state.runCreated ? 1 : 0,
        geofenceLinkedStops: state.runCreated ? 2 : 0,
        geofenceTotalStops: state.runCreated ? 2 : 0,
        geofenceHitRuns: state.geofenceStage > 0 ? 1 : 0,
        geofenceHitStops: completedStops,
        records: state.runCreated ? [{
          loadId: runId,
          loadReference: runReference(state.planningDate),
          loadStatus: state.geofenceStage >= 4 ? 'Completed' : state.geofenceStage > 0 ? 'InProgress' : 'Planned',
          runState,
          progressPercent: state.geofenceStage === 0 ? 0 : state.geofenceStage === 1 ? 25 : state.geofenceStage === 2 ? 50 : state.geofenceStage === 3 ? 75 : 100,
          completedStops,
          totalStops: 2,
          nextStop: state.geofenceStage < 2
            ? { id: collectionStopId, sequence: 1, name: 'Hall Hunter', plannedArrivalUtc: atOffset(30) }
            : state.geofenceStage < 4
              ? { id: deliveryStopId, sequence: 2, name: 'Leyland', plannedArrivalUtc: atOffset(80) }
              : undefined,
          currentVisit,
          geofenceOnSite: state.geofenceStage === 1 || state.geofenceStage === 3,
          trackingFresh: true,
          trackingMoving: state.geofenceStage === 2,
          speedKph: state.geofenceStage === 2 ? 30 : 0,
          stopDwell: [
            { stopId: collectionStopId, sequence: 1, stopName: 'Hall Hunter', state: state.geofenceStage >= 2 ? 'Departed' : state.geofenceStage === 1 ? 'OnSite' : 'EnRoute', siteArrivalUtc: state.geofenceStage >= 1 ? atOffset(25) : undefined, siteDepartureUtc: state.geofenceStage >= 2 ? atOffset(35) : undefined },
            { stopId: deliveryStopId, sequence: 2, stopName: 'Leyland', state: state.geofenceStage >= 4 ? 'Departed' : state.geofenceStage === 3 ? 'OnSite' : 'EnRoute', siteArrivalUtc: state.geofenceStage >= 3 ? atOffset(75) : undefined, siteDepartureUtc: state.geofenceStage >= 4 ? atOffset(85) : undefined }
          ]
        }] : []
      });
    }
    if (path === '/api/v1/tv-display/route-progress' && method === 'GET') return json(route, { planningDate: state.planningDate, runs: [] });
    if (path === '/api/v1/tv-display/live-runs' && method === 'GET') return json(route, { planningDate: state.planningDate, generatedAtUtc: new Date().toISOString(), refreshSeconds: 20, runCount: state.geofenceStage >= 3 ? 0 : state.runCreated ? 1 : 0, runs: state.geofenceStage >= 3 ? [] : state.runCreated ? [{
      id: runId,
      reference: runReference(state.planningDate),
      status: state.geofenceStage > 0 ? 'InProgress' : 'Planned',
      nextStop: state.geofenceStage === 1 ? 'Hall Hunter' : 'Leyland',
      finalStop: 'Leyland',
      etaTarget: 'Leyland',
      etaUtc: atOffset(80),
      etaSource: 'Estimated',
      tracking: 'Moving · now',
      trackingUpdatedAtUtc: new Date().toISOString(),
      speedKph: 30,
      state: state.geofenceStage === 1 ? 'ON SITE' : 'MOVING',
      stateDetail: 'Live'
    }] : [] });
    if (path === '/api/v1/run-timing' && method === 'GET') return json(route, {
      planningDate: state.planningDate, records: state.runCreated ? [{
        loadId: runId, loadReference: runReference(state.planningDate), completed: state.geofenceStage >= 4,
        finalEtaUtc: state.geofenceStage >= 3 ? atOffset(75) : atOffset(80), finalEtaSource: state.geofenceStage >= 3 ? 'Geofence' : 'GeofenceEstimated', finalDestinationStopId: deliveryStopId, finalDestinationName: 'Leyland',
      }] : [],
    });

    return json(route, {});
  });
}

test('planner → dispatch → geofence arrival/departure → completion stays coherent', async ({ page }) => {
  const state: State = { runCreated: false, allocatedPallets: 0, driverAssigned: false, vehicleAssigned: false, trailerAssigned: false, geofenceStage: 0, planningDate: isoDate() };
  await installApi(page, state);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Available now' })).toBeVisible();
  await page.getByRole('button', { name: /Hall Hunter.*4.*Leyland/i }).click();
  await expect(page.getByText(/4 pallets added\./i)).toBeVisible();
  expect(state.runCreated).toBe(true);
  expect(state.allocatedPallets).toBe(4);

  await page.getByRole('link', { name: 'Driver Dispatch' }).first().click();
  await expect(page.getByRole('heading', { name: 'Driver Dispatch' })).toBeVisible();
  const runInput = page.getByPlaceholder('Run…');
  await runInput.fill('RUN-');
  await page.getByRole('button', { name: new RegExp(runReference(state.planningDate), 'i') }).click();

  const vehicleInput = page.getByRole('combobox', { name: 'Vehicle…' });
  await vehicleInput.fill('AB12');
  await page.getByRole('button', { name: /AB12 CDE/ }).click();
  const trailerInput = page.getByRole('combobox', { name: 'Trailer…' });
  await trailerInput.fill('TRL');
  await page.getByRole('button', { name: /TRL-101/ }).click();
  await page.getByRole('button', { name: 'Allocate', exact: true }).click();
  await expect(page.getByText('Allocation saved. Run remains against this driver and is ready to dispatch.', { exact: true })).toBeVisible();
  expect(state.driverAssigned && state.vehicleAssigned && state.trailerAssigned).toBe(true);

  await page.getByRole('link', { name: 'Operations Wallboard' }).click();
  await expect(page.getByRole('heading', { name: 'Arrivals & Departures' })).toBeVisible();
  await expect(page.getByText(/AB12 CDE/).first()).toBeVisible();

  state.geofenceStage = 1;
  await page.reload();
  await expect(page.getByText('ON SITE').first()).toBeVisible();
  await expect(page.getByText(/Hall Hunter/).first()).toBeVisible();

  state.geofenceStage = 2;
  await page.reload();
  await expect(page.getByText(/1 of 2 geofences exited/i)).toBeVisible();

  state.geofenceStage = 3;
  await page.reload();
  await expect(page.getByText(/Final destination arrived/i).first()).toBeVisible();

  state.geofenceStage = 4;
  await page.reload();
  console.log('LIFECYCLE_STAGE4_URL', page.url());
  console.log('LIFECYCLE_STAGE4_ROWS', await page.locator('.ops-board-row').count());
  console.log('LIFECYCLE_STAGE4_BODY_START\n' + await page.locator('body').innerText() + '\nLIFECYCLE_STAGE4_BODY_END');
  await expect(page.getByText(/Final destination arrived/i).first()).toBeVisible();
  await expect(page.getByText('AVAILABLE').first()).toBeVisible();
});
