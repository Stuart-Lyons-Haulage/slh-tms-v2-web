import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DriverDispatch.tsx", import.meta.url), "utf8");
const operationalSource = readFileSync(new URL("./DriverDispatchOperational.tsx", import.meta.url), "utf8");
const authoritativeSource = readFileSync(new URL("../components/dispatch/DispatchBoard.tsx", import.meta.url), "utf8");
const rowSource = readFileSync(new URL("../components/dispatch/DispatchDriverRow.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../components/dispatch/dispatchApi.ts", import.meta.url), "utf8");
const stateSource = readFileSync(new URL("../components/dispatch/dispatchBoardState.ts", import.meta.url), "utf8");
const filterSource = readFileSync(new URL("../components/dispatch/DispatchFilters.tsx", import.meta.url), "utf8");
const calculatedStartsSource = readFileSync(new URL("./DispatchCalculatedStarts.tsx", import.meta.url), "utf8");
const authoritativeCss = readFileSync(new URL("../authoritative-dispatch.css", import.meta.url), "utf8");
const loadPlanCss = readFileSync(new URL("../customer-load-plans.css", import.meta.url), "utf8");

describe("Driver Dispatch UI contract", () => {
  it("keeps status visible and puts the calculated Start column beside the driver", () => {
    expect(source).toContain("<th>Status</th>");
    expect(source).toContain("<th>Driver</th><th>Start</th><th>Type / skills</th>");
    expect(source).toContain("No Run");
    expect(source).toContain("Awaiting Dispatch");
    expect(source).toContain("Sent Awaiting Response");
    expect(source).toContain("Confirmed");
    expect(source).not.toContain("<input type=\"time\"");
  });

  it("shows only unallocated runs in the legacy pool above the legacy driver table", () => {
    expect(source).toContain("data-testid=\"built-runs-queue\"");
    expect(source).toContain("Built runs ready to allocate");
    expect(source).toContain("filter(load => !load.driverId)");
    expect(source.indexOf("<BuiltRunsQueue loads={data.loads} />")).toBeLessThan(source.indexOf("dispatch-table-wrap"));
  });

  it("keeps a successful allocation visible against the driver instead of refreshing it away", () => {
    expect(source).toContain("const applySavedAllocation = useCallback");
    expect(source).toContain("assignedLoadId: saved.id");
    expect(source).toContain("applySavedAllocation(saved, driver.driverId, previous?.id)");
    expect(source).toContain("Run remains against this driver and is ready to dispatch");
    const saveStart = source.indexOf("async function save()");
    const dispatchStart = source.indexOf("async function prepareDispatch()", saveStart);
    expect(source.slice(saveStart, dispatchStart)).not.toContain("await refresh()");
  });

  it("renders one authoritative Dispatch surface instead of mounting the legacy table underneath", () => {
    expect(operationalSource).not.toContain("startVisiblePolling");
    expect(operationalSource).not.toContain("60_000");
    expect(operationalSource).not.toContain("refreshKey");
    expect(operationalSource).toContain("<DispatchBoard");
    expect(operationalSource).not.toContain("<DriverDispatch />");
  });

  it("keeps allocation, readiness and SMS dispatch inside the authoritative board without a stale overlay lookup", () => {
    expect(operationalSource).not.toContain("openDispatchPreview");
    expect(operationalSource).not.toContain("does not currently have an allocated run");
    expect(operationalSource).not.toContain("event.preventDefault()");
    expect(operationalSource).not.toContain("event.stopPropagation()");
    expect(authoritativeSource).toContain("getDriverDispatchRoute(effectiveSelection.runId");
    expect(authoritativeSource).toContain("checkDispatchReadiness(effectiveSelection.runId");
    expect(authoritativeSource).toContain("sendDriverMessage(");
    expect(authoritativeSource).toContain("<DispatchMessageDialog");
  });

  it("keeps driver search, sync and customer exports on the routed Driver Dispatch surface", () => {
    expect(operationalSource).toContain("CustomerLoadPlanActions");
    expect(filterSource).toContain('aria-label="Search drivers"');
    expect(authoritativeSource).toContain("Sync Drivers");
    expect(authoritativeSource).toContain("syncDispatchDrivers");
    expect(authoritativeSource).toContain("filterDriversByDriverSearch");
  });

  it("keeps the authoritative Smart Dispatch toolbar visibly rendered in production", () => {
    expect(authoritativeSource).toContain('className="smart-dispatch-header"');
    expect(authoritativeSource).toContain("Planning date");
    expect(authoritativeSource).toContain("Sync Drivers");
    expect(authoritativeSource).toContain("Refresh");
    expect(authoritativeSource).toContain("Get Times");
    expect(authoritativeSource).toContain("Lock Plan");
    expect(authoritativeCss).toContain(".smart-dispatch-board > .smart-dispatch-header");
    expect(authoritativeCss).toContain("display: flex !important");
    expect(authoritativeCss).toContain("visibility: visible !important");
  });

  it("exposes Dispatch immediately for a selected row and allocates it before the SMS preview", () => {
    expect(rowSource).toContain('action === "allocate" && selection.runId');
    expect(rowSource).toContain('{busy ? "Allocating…" : "Dispatch"}');
    expect(authoritativeSource).toContain("allocateDispatchRun(effectiveSelection.runId, driver.driverId, effectiveSelection, access)");
    expect(authoritativeSource).not.toContain("lockDispatchPlan(");
    expect(authoritativeSource.indexOf("lockDispatchPlan(planningDate, [{ driverId: driver.driverId, selection: effectiveSelection }], access)")).toBeLessThan(authoritativeSource.indexOf("getDriverDispatchRoute(effectiveSelection.runId"));
  });

  it("restores the run sidebar with first collection time, first collection, final delivery and fit suggestions", () => {
    expect(authoritativeSource).toContain('className="smart-run-sidebar"');
    expect(authoritativeSource).toContain("run.firstCollectionTimeUtc");
    expect(authoritativeSource).toContain("run.collectionPoint.name");
    expect(authoritativeSource).toContain("run.finalDeliveryPoint?.name");
    expect(authoritativeSource).toContain("drivers.filter(driver => driver.suggestedRunId === run.runId)");
    expect(apiSource).toContain("firstCollectionTimeUtc: collection?.plannedArrivalUtc || load.plannedStartUtc");
    expect(apiSource).toContain("finalDeliveryPoint: delivery ?");
    expect(authoritativeCss).toContain(".smart-dispatch-workspace");
    expect(authoritativeCss).toContain(".smart-run-card-list");
  });

  it("uses previous-trailer continuity unless the run planner notes explicitly request a trailer swap", () => {
    expect(stateSource).toContain("driver.previousTrailerId");
    expect(stateSource).toContain("!assignedRun?.trailerSwapRequested");
    expect(rowSource).toContain("!nextRun?.trailerSwapRequested");
    expect(rowSource).toContain("Last used / continuity");
    expect(rowSource).toContain("Planner note requests a trailer swap");
    expect(apiSource).toContain("trailerSwapRequested");
    expect(apiSource).toContain("swap\\s*trailer");
  });

  it("keeps Customer Load Plans closable above the app header", () => {
    expect(loadPlanCss).toContain(".load-plan-modal-backdrop .load-plan-head-actions button:last-child");
    expect(loadPlanCss).toContain("position: fixed");
    expect(loadPlanCss).toContain("z-index: 1305");
  });

  it("does not clip the complete Smart Dispatch driver payload to the smaller visibility evidence set", () => {
    expect(authoritativeSource).toContain("snapshot.drivers.length");
    expect(apiSource).not.toContain(".filter(driver => visibilityByDriver.has(driver.driverId))");
  });

  it("makes the Dispatch action available from the locally committed legacy allocation", () => {
    expect(source).toContain('dispatchStatus: "Awaiting Dispatch"');
    expect(source).toContain('driver.assignedLoadId === selected.id && effectiveStatus === "Awaiting Dispatch"');
    expect(source).toContain('{busy ? "Preparing…" : "Dispatch"}</button>');
  });

  it("keeps all active drivers visible while only blocking proven current unavailability", () => {
    expect(source).not.toContain("if (!driver.assignedLoadId && knownUnavailable(driver, status)) return false;");
    expect(source).toContain("availability warnings shown");
    expect(source).toContain("Visible for planning · allocation currently blocked");
    expect(source).toContain("Allocated but unavailable · reassign this run");
    expect(source).toContain('const tachoUnavailable = status?.availabilityStatus === "Unavailable";');
    expect(source).not.toContain('status?.availabilityStatus === "Unavailable" || status?.weeklyRestStatus === "Overdue"');
    expect(source).toContain("disabled={busy || driver.onLeave || tachoUnavailable || complianceBlocked || !vehicleId}");
  });

  it("continues to prevent a run already allocated to another driver being offered for duplicate allocation", () => {
    expect(source).toContain(".filter(load => !load.driverId || load.id === driver.assignedLoadId)");
    expect(source).toContain("allocated to me");
    expect(source).toContain("unallocated");
  });

  it("allows an allocated run, vehicle and trailer to be edited after dispatch and explicitly unassigned", () => {
    expect(source).not.toContain('const canEditAllocation = effectiveStatus !== "Sent Awaiting Response" && effectiveStatus !== "Confirmed";');
    expect(source).toContain("async function unassign()");
    expect(source).toContain('body: JSON.stringify({ driverId: null, vehicleId: null, trailerId: null })');
    expect(source).toContain("Unassign run</button>");
    expect(source).toContain("Save allocation");
  });

  it("prefers assistant/live vehicle evidence and marks yesterday continuity clearly", () => {
    expect(source).toContain('initial?.vehicleId || driver.suggestedVehicleId || driver.previousVehicleId || ""');
    expect(source).toContain('" · Assistant · in yesterday"');
    expect(source).toContain("In yesterday · {driver.previousVehicleRegistration}");
  });

  it("uses Fleetio vehicle status as an allocation warning and dispatch guard", () => {
    expect(source).toContain("function fleetioWarning(vehicle?: Vehicle)");
    expect(source).toContain("Keep this vehicle selected and continue with the allocation?");
    expect(source).toContain("Resolve or change the vehicle before dispatch.");
    expect(source).toContain("⚠ Fleetio");
  });

  it("publishes calculated and projected Tacho evidence into the Start and Day columns", () => {
    expect(calculatedStartsSource).toContain('dispatchStartsCalculatedEvent = "slh:dispatch-starts-calculated"');
    expect(calculatedStartsSource).toContain("suggestedStartUtc?: string");
    expect(calculatedStartsSource).toContain("earliestStartUtc?: string");
    expect(calculatedStartsSource).toContain("projectedDayNumber?: number");
    expect(calculatedStartsSource).toContain("earliestStartIsAssumption?: boolean");
    expect(calculatedStartsSource).toContain("publishStarts(date, rows, statusResponse.drivers)");
    expect(source).toContain("status?.projectedDayNumber || driver.dayNumber");
    expect(source).toContain("calculatedStart?.suggestedStartUtc || status?.earliestStartUtc || initial?.plannedStartUtc");
    expect(source).toContain("couldStartAssumption");
    expect(source).toContain("Projected duty day: Day");
  });

  it("opens editable dispatch and free-form update previews", () => {
    expect(source).toContain('type MessageMode = "initial" | "amendment" | "update"');
    expect(source).toContain('mode: "initial"');
    expect(source).toContain('mode: "update"');
    expect(source).toContain("Free-form update text");
    expect(source).toContain("Update text</button>");
    expect(source).toContain("SEND UPDATE");
    expect(source).toContain('dispatch: state.mode === "initial"');
  });

  it("verifies the allocation response contains the selected resources", () => {
    expect(source).toContain("saved.driverId !== driver.driverId");
    expect(source).toContain("saved.vehicleId !== vehicleId");
    expect(source).toContain('(saved.trailerId || "") !== trailerId');
  });

  it("derives the dispatch message start from the first planned collection", () => {
    expect(source).toContain("firstCollectionStop(latest)?.plannedArrivalUtc || latest.plannedStartUtc");
    expect(source).not.toContain("/start-time");
  });
});
