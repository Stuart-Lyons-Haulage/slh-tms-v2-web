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

type State = { runCreated: boolean; allocatedPallets: number; driverAssigned: boolean; vehicleAssigned: boolean; trailerAssigned: boolean; samsaraStage: number; planningDate: string };

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function runPayload(state: State) {
  return {
    id: runId,
    reference: runReference(state.planningDate),
    rawReference: runReference(state.planningDate),
    planningDate: state.planningDate,
    status: state.samsaraStage >= 4 ? 'Completed' : state.samsaraStage > 0 ? 'InProgress' : 'Planned',
    palletSpacesUsed: state.allocatedPallets,
    totalPalletSpaces: 26,
    capacityType: 'Standard pallets',
    driverId: state.driverAssigned ? driverId : undefined,
    vehicleId: state.vehicleAssigned ? vehicleId : undefined,
    trailerId: state.trailerAssigned ? trailerId : undefined,
    stops: state.allocatedPallets > 0 ? [
      { id: collectionStopId, loadId: runId, sequence: 1, name: 'Collect · Hall Hunter', address: 'Hall Hunter', plannedArrivalUtc: atOffset(30) },
      { id: deliveryStopId, loadId: runId, orderId, sequence: 2, name: 'Deliver · Leyland', address: 'Leyland', plannedArrivalUtc: atOffset(80), plannerNote: 'Ref: HH-E2E-001 · X No: X-E2E-01' }
    ] : []
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
          lineNote: 'Ref: HH-E2E-001 · X No: X-E2E-01',
          customerCode: 'Hall Hunter',
          collectionDate: state.planningDate,
          deliveryDate: state.planningDate,
          orderedPallets: 4,
          plannedPallets: planned,
          outstandingPallets: outstanding,
          overplannedPallets: 0,
          collection: 'Hall Hunter',
          destination: 'Leyland',
          planningGroup: 'Hall Hunter',
          planningSection: 'AM',
          source: 'E2E',
          receivedAtUtc: new Date().toISOString(),
          lateAddition: false,
          allocations: planned > 0 ? [{ loadId: runId, loadReference: runReference(state.planningDate), pallets: planned, updatedAtUtc: new Date().toISOString() }] : []
        }],
        runs: state.runCreated ? [{
          id: runId,
          reference: runReference(state.planningDate),
          status: 'Planned',
          palletSpacesUsed: planned,
          totalPalletSpaces: 26,
          capacityType: 'Standard pallets',
          stopCount: planned > 0 ? 2 : 0
        }] : [],
        planningGroups: ['Hall Hunter'],
        destinations: ['Leyland'],
        cells: [{
          planningGroup: 'Hall Hunter',
          destination: 'Leyland',
          ordered: 4,
          planned,
          outstanding,
          overplanned: 0,
          orderIds: [orderId]
        }],
        summary: { ordered: 4, planned, outstanding, overplanned: 0, lateAdditions: 0, orders: 1, runs: state.runCreated ? 1 : 0 }
      });
    }

    if (path === '/api/v1/driver-availability' && method === 'GET') {
      return json(route, {
        planningDate: state.planningDate,
        generatedAtUtc: new Date().toISOString(),
        classificationMismatchCount: 0,
        summary: {
          employedAvailable: 0,
          agencyConfirmed: 0,
          casualConfirmed: 0,
          driversRequired: state.runCreated ? 1 : 0,
          surplusShortfall: state.runCreated ? -1 : 0
        },
        drivers: []
      });
    }
    if (path === '/api/v1/planning-control/regions' && method === 'GET') {
      return json(route, {
        date: state.planningDate,
        destinations: ['Leyland'],
        destinationRegions: { Leyland: 'North' },
        destinationLabels: { Leyland: 'Leyland' },
        destinationSiteCodes: { Leyland: 'SITE002' },
        unmatchedDestinations: 0
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
      operationalStatus: state.samsaraStage >= 4 ? 'Completed' : state.samsaraStage > 0 ? 'Working' : state.driverAssigned ? 'Awaiting Dispatch' : 'No Run',
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
    if (path === '/api/v1/tracking/dot/fleet-status' && method === 'GET') return json(route, {
      vehicleCount: 1,
      readyCount: state.driverAssigned ? 1 : 0,
      attentionCount: 0,
      vehicles: [{
        vehicleId,
        registration: 'AB12 CDE',
        loadId: state.runCreated ? runId : undefined,
        condition: state.samsaraStage === 2 ? 'Moving' : state.samsaraStage > 0 ? 'Stationary' : 'Started',
        speedKph: state.samsaraStage === 2 ? 30 : 0,
        lastEventTimeUtc: new Date().toISOString(),
        driverName: state.driverAssigned ? 'Test Driver' : undefined,
        driverSource: state.driverAssigned ? 'TachoMaster' : undefined
      }]
    });
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
    // driver-assignments; live Samsara progress enrich those rows rather than creating them.
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
    if (path === '/api/v1/operations/delivery-etas' && method === 'GET') return json(route, { planningDate: state.planningDate, calculatedAtUtc: new Date().toISOString(), records: [] });

    if (path === '/api/v1/run-progress' && method === 'GET') {
      const completedStops = state.samsaraStage < 2 ? 0 : state.samsaraStage < 4 ? 1 : 2;
      const runState = state.samsaraStage >= 4 ? 'Completed' : state.samsaraStage === 1 || state.samsaraStage === 3 ? 'OnSiteConfirmed' : state.samsaraStage > 1 ? 'InProgress' : 'Planned';
      const currentVisit = state.samsaraStage === 1
        ? { siteName: 'Hall Hunter', loadStopId: collectionStopId, enteredAtUtc: atOffset(25), siteArrivalUtc: atOffset(25), confirmedAtUtc: atOffset(25), dwellMinutes: 5, isDelayed: false, status: 'OnSite' }
        : state.samsaraStage === 3
          ? { siteName: 'Leyland', loadStopId: deliveryStopId, enteredAtUtc: atOffset(75), siteArrivalUtc: atOffset(75), confirmedAtUtc: atOffset(75), dwellMinutes: 5, isDelayed: false, status: 'OnSite' }
          : undefined;
      return json(route, {
        planningDate: state.planningDate,
        calculatedAtUtc: new Date().toISOString(),
        samsaraProgressAvailable: true,
        records: state.runCreated ? [{
          loadId: runId,
          loadReference: runReference(state.planningDate),
          loadStatus: state.samsaraStage >= 4 ? 'Completed' : state.samsaraStage > 0 ? 'InProgress' : 'Planned',
          runState,
          progressPercent: state.samsaraStage === 0 ? 0 : state.samsaraStage === 1 ? 25 : state.samsaraStage === 2 ? 50 : state.samsaraStage === 3 ? 75 : 100,
          completedStops,
          totalStops: 2,
          nextStop: state.samsaraStage < 2
            ? { id: collectionStopId, sequence: 1, name: 'Hall Hunter', plannedArrivalUtc: atOffset(30) }
            : state.samsaraStage < 4
              ? { id: deliveryStopId, sequence: 2, name: 'Leyland', plannedArrivalUtc: atOffset(80) }
              : undefined,
          currentVisit,
          stopDwell: [
            { stopId: collectionStopId, sequence: 1, stopName: 'Hall Hunter', state: state.samsaraStage >= 2 ? 'Departed' : state.samsaraStage === 1 ? 'OnSite' : 'EnRoute', siteArrivalUtc: state.samsaraStage >= 1 ? atOffset(25) : undefined, siteDepartureUtc: state.samsaraStage >= 2 ? atOffset(35) : undefined },
            { stopId: deliveryStopId, sequence: 2, stopName: 'Leyland', state: state.samsaraStage >= 4 ? 'Departed' : state.samsaraStage === 3 ? 'OnSite' : 'EnRoute', siteArrivalUtc: state.samsaraStage >= 3 ? atOffset(75) : undefined, siteDepartureUtc: state.samsaraStage >= 4 ? atOffset(85) : undefined }
          ]
        }] : []
      });
    }
    return json(route, {});
  });
}

test('planner → dispatch → Samsara stop arrival/departure → completion stays coherent', async ({ page }) => {
  const state: State = { runCreated: false, allocatedPallets: 0, driverAssigned: false, vehicleAssigned: false, trailerAssigned: false, samsaraStage: 0, planningDate: isoDate() };
  await installApi(page, state);

  await page.goto('/');
  await expect(page.getByText('Run builder', { exact: true })).toBeVisible();
  await page.locator('input[type="date"]').first().fill(state.planningDate);
  await page.getByPlaceholder('Start typing live collection…').fill('Hall');
  await page.getByRole('button', { name: 'Hall Hunter', exact: true }).click();
  await page.getByPlaceholder('Choose delivery from this collection…').fill('Ley');
  await page.getByRole('button', { name: /Leyland\s+4 pallets/i }).click();
  await expect(page.getByText(/created\. It is now available in Pallet Order for allocation\./i)).toBeVisible();
  expect(state.runCreated).toBe(true);
  expect(state.allocatedPallets).toBe(0);

  await page.goto('/pallet-control');
  await expect(page.getByRole('heading', { name: 'Pallet Control' })).toBeVisible();
  await page.getByTitle('Hall Hunter → Leyland: 4 ordered, 0 planned, 4 to plan').first().click();
  await expect(page.getByRole('heading', { name: 'Collect: Hall Hunter · Deliver: Leyland' })).toBeVisible();
  await page.locator('.pallet-control-allocation select').selectOption(runId);
  await page.getByRole('spinbutton', { name: 'Allocated load units' }).fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/HH-E2E-001: 4 allocated · 0 remaining/i)).toBeVisible();
  expect(state.allocatedPallets).toBe(4);

  // The second-screen allocation must hydrate back into Planner with source references in Line note.
  await page.goto('/');
  await expect(page.getByText('Run builder', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Facility / load-line note').first()).toHaveValue(/X No: X-E2E-01/);

  await page.goto('/driver-dispatch');
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

  const readProgress = () => page.evaluate(async (date) => {
    const response = await fetch(`/api/v1/run-progress?date=${encodeURIComponent(date)}`);
    return response.json();
  }, state.planningDate);
  state.samsaraStage = 1;
  let progress = await readProgress();
  expect(progress.records[0].runState).toBe('OnSiteConfirmed');
  expect(progress.records[0].currentVisit.siteName).toBe('Hall Hunter');

  state.samsaraStage = 2;
  progress = await readProgress();
  expect(progress.records[0].completedStops).toBe(1);

  state.samsaraStage = 3;
  progress = await readProgress();
  expect(progress.records[0].currentVisit.siteName).toBe('Leyland');

  state.samsaraStage = 4;
  progress = await readProgress();
  expect(progress.records[0].runState).toBe('Completed');
  expect(progress.records[0].completedStops).toBe(2);
});
