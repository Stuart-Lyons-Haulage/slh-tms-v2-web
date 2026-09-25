import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { getDriverDispatchRoute, getRunDispatch } from "../../api/runs";
import { useAccessToken } from "../../lib/auth";
import "../../smart-dispatch.css";
import { ComplianceWarningBanner } from "./ComplianceWarningBanner";
import { DispatchDriverRow } from "./DispatchDriverRow";
import { DispatchFilters } from "./DispatchFilters";
import { DispatchMessageDialog } from "./DispatchMessageDialog";
import { allocateDispatchRun, checkDispatchReadiness, getAvailableTimes, getSmartDispatch, sendDriverMessage, sendRunToSamsara, syncDispatchDrivers, unassignDispatchRun } from "./dispatchApi";
import {
  applyAvailableTimes,
  availableTimesByDriver,
  buildInitialSelections,
  buildRunOwnerById,
  emptyDispatchSelection,
  filterDriversByDriverSearch,
  filterDispatchDrivers,
  filterDriversByEmploymentType,
  globalFailures,
  reducedRestDriverIds,
  rowFailures,
  selectedAllocations,
  type DispatchAvailableTimeMap,
  type DispatchSelectionMap
} from "./dispatchBoardState";
import {
  buildAmendmentText,
  buildDispatchText,
  buildUpdateText,
  plannedStartLocal,
  routeDrivingMinutes,
  type DriverMessageMode
} from "./dispatchMessaging";
import type { DispatchAllocationSelection, DispatchDriverDto, DispatchEmploymentFilter, DispatchFilter, DispatchLockFailure, DispatchRunDto } from "./types";

type Props = {
  planningDate: string;
  onPlanningDateChange?: (date: string) => void;
  extraActions?: ReactNode;
  onLocked?: () => void;
};

type SmartDispatchSnapshot = Awaited<ReturnType<typeof getSmartDispatch>>;
type ActionState = "times" | "lock" | "refresh" | "samsara" | undefined;
type MessageState = {
  runId: string;
  reference: string;
  text: string;
  mode: DriverMessageMode;
  routeMinutes: number;
  acknowledgeUnverified: boolean;
};

const filterValues: DispatchFilter[] = ["all", "unallocated", "backloads", "warnings", "skills-mismatch"];
const employmentFilterValues: DispatchEmploymentFilter[] = ["all", "employed", "agency", "casual", "subcontractor"];

function fleetioWarning(status?: string): string | undefined {
  const value = status?.trim();
  return value && /(out\s*of\s*service|inactive|vor|off\s*road|maintenance)/i.test(value) ? `Fleetio: ${value}` : undefined;
}

function runTime(value?: string): string {
  if (!value) return "Time not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not set" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function RunSidebar({ runs, owners, drivers }: {
  runs: DispatchRunDto[];
  owners: Record<string, string | undefined>;
  drivers: DispatchDriverDto[];
}) {
  return <aside className="smart-run-sidebar" aria-label="Runs ready for driver allocation">
    <div className="smart-run-sidebar-head">
      <strong>Runs</strong>
      <span>{runs.length}</span>
    </div>
    <p>First collection → final delivery. Best-fit suggestions use the driver’s last known position plus first collection proximity, skills and continuity.</p>
    <div className="smart-run-card-list">
      {runs.map(run => {
        const ownerId = owners[run.runId];
        const owner = ownerId ? drivers.find(driver => driver.driverId === ownerId) : undefined;
        const suggested = drivers.filter(driver => driver.suggestedRunId === run.runId).slice(0, 2);
        return <article className={`smart-run-card ${owner ? "allocated" : "available"}`} key={run.runId}>
          <div className="smart-run-card-title">
            <strong>{run.reference}</strong>
            <span>{owner ? "Selected" : run.isBackload ? "Backload" : "Available"}</span>
          </div>
          <div className="smart-run-time">{runTime(run.firstCollectionTimeUtc)}</div>
          <div className="smart-run-route">
            <span><b>Collect</b>{run.collectionPoint.name}</span>
            <span><b>Deliver</b>{run.finalDeliveryPoint?.name || "Final stop not set"}</span>
          </div>
          {owner && <small>Allocated/selected · {owner.name}</small>}
          {!owner && suggested.length > 0 && <small className="smart-run-fit">Suggested · {suggested.map(driver => driver.name).join(" / ")}</small>}
          {run.trailerSwapRequested && <small className="smart-run-warning">Planner note: trailer swap requested</small>}
        </article>;
      })}
    </div>
  </aside>;
}

export function GetTimesButton({ busy, onGetTimes }: { busy: boolean; onGetTimes: () => void }) {
  return <button className="smart-action secondary" type="button" disabled={busy} onClick={onGetTimes}>
    {busy ? "Getting Tacho times…" : "Get Times"}
  </button>;
}

export function DispatchBoard({ planningDate, onPlanningDateChange, extraActions, onLocked }: Props) {
  const token = useAccessToken();
  const [snapshot, setSnapshot] = useState<SmartDispatchSnapshot>();
  const [selections, setSelections] = useState<DispatchSelectionMap>({});
  const [availableTimes, setAvailableTimes] = useState<DispatchAvailableTimeMap>({});
  const [failures, setFailures] = useState<DispatchLockFailure[]>([]);
  const [filter, setFilter] = useState<DispatchFilter>("all");
  const [employmentFilter, setEmploymentFilter] = useState<DispatchEmploymentFilter>("all");
  const [driverSearch, setDriverSearch] = useState("");
  const [action, setAction] = useState<ActionState>();
  const [busyDriverId, setBusyDriverId] = useState<string>();
  const [message, setMessage] = useState<MessageState>();
  const [messageError, setMessageError] = useState<string>();
  const [sendingMessage, setSendingMessage] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async () => {
    setAction(current => current || "refresh");
    setError(undefined);
    try {
      const access = await token();
      const data = await getSmartDispatch(planningDate, access);
      setSnapshot(data);
      setSelections(buildInitialSelections(data.drivers, data.runs, data.equipment));
      setAvailableTimes({});
      setFailures([]);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Driver Dispatch could not be loaded.");
    } finally {
      setAction(undefined);
    }
  }, [planningDate, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const runOwnerById = useMemo(
    () => snapshot ? buildRunOwnerById(selections, snapshot.equipment) : {},
    [selections, snapshot]
  );

  const visibleDrivers = useMemo(() => {
    if (!snapshot) return [];
    const workforce = filterDriversByEmploymentType(snapshot.drivers, employmentFilter);
    const searched = filterDriversByDriverSearch(workforce, driverSearch);
    return filterDispatchDrivers(searched, filter, selections, snapshot.runs, availableTimes, failures);
  }, [availableTimes, driverSearch, employmentFilter, failures, filter, selections, snapshot]);

  const filterCounts = useMemo(() => {
    const workforce = snapshot ? filterDriversByEmploymentType(snapshot.drivers, employmentFilter) : [];
    const searched = filterDriversByDriverSearch(workforce, driverSearch);
    return Object.fromEntries(filterValues.map(value => [
      value,
      snapshot ? filterDispatchDrivers(searched, value, selections, snapshot.runs, availableTimes, failures).length : 0
    ])) as Record<DispatchFilter, number>;
  }, [availableTimes, driverSearch, employmentFilter, failures, selections, snapshot]);

  const employmentCounts = useMemo(() => Object.fromEntries(employmentFilterValues.map(value => [
    value,
    snapshot ? filterDriversByEmploymentType(snapshot.drivers, value).length : 0
  ])) as Record<DispatchEmploymentFilter, number>, [snapshot]);

  const selectedCount = snapshot ? selectedAllocations(snapshot.drivers, selections).length : 0;
  const samsaraExportCandidates = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.equipment.loads.filter(load =>
      Boolean(load.driverId) &&
      Boolean(load.vehicleId) &&
      (load.stops?.length || 0) >= 2 &&
      !snapshot.samsaraDispatch[load.id] &&
      !String(load.status || '').toLowerCase().includes('cancel'));
  }, [snapshot]);
  const globalLockFailures = useMemo(() => {
    const driverIds = new Set(snapshot?.drivers.map(driver => driver.driverId) || []);
    return globalFailures(failures, driverIds);
  }, [failures, snapshot]);

  function lockedRunId(driverId: string): string | undefined {
    return snapshot?.equipment.loads.find(load => load.driverId === driverId)?.id;
  }

  function changeSelection(driverId: string, patch: Partial<DispatchSelectionMap[string]>) {
    setSelections(current => ({
      ...current,
      [driverId]: { ...(current[driverId] || emptyDispatchSelection()), ...patch }
    }));
    setFailures(current => current.filter(failure => failure.driverId !== driverId));
    // Run/equipment changes do not alter legal rest. Only an explicit rest
    // choice change invalidates this driver's Tacho timing result.
    if (Object.prototype.hasOwnProperty.call(patch, "useReducedDailyRest")) {
      setAvailableTimes(current => {
        const next = { ...current };
        delete next[driverId];
        return next;
      });
    }
    setNotice(undefined);
  }

  async function handleSyncDrivers() {
    setAction("refresh");
    setError(undefined);
    setNotice(undefined);
    try {
      await syncDispatchDrivers(await token());
      await refresh();
      setNotice("Driver Master sync completed.");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Driver Master sync failed.");
    } finally {
      setAction(undefined);
    }
  }

  async function handleGetTimes() {
    if (!snapshot || snapshot.drivers.length === 0) return;
    setAction("times");
    setError(undefined);
    setNotice(undefined);
    setFailures([]);
    try {
      const access = await token();
      const rows = await getAvailableTimes(
        planningDate,
        snapshot.drivers.map(driver => driver.driverId),
        access,
        reducedRestDriverIds(selections)
      );
      setAvailableTimes(availableTimesByDriver(rows));
      setSelections(current => applyAvailableTimes(current, rows));
      const warnings = rows.filter(row => Boolean(row.breachDetail)).length;
      setNotice(warnings > 0
        ? `Tacho times refreshed for ${rows.length} drivers · ${warnings} require planner attention.`
        : `Tacho times refreshed for ${rows.length} drivers.`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Tacho available times could not be calculated.");
    } finally {
      setAction(undefined);
    }
  }

  async function prepareDispatch(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    if (!snapshot || !selection.runId) return;
    setBusyDriverId(driver.driverId);
    setMessageError(undefined);
    setNotice(undefined);
    setFailures(current => current.filter(failure => failure.driverId !== driver.driverId));
    try {
      const vehicle = snapshot.equipment.vehicles.find(item => item.id === selection.vehicleId);
      const fleetWarning = fleetioWarning(vehicle?.fleetioStatus);
      if (fleetWarning) throw new Error(`${fleetWarning}. Resolve or change the vehicle before dispatch.`);
      if (!selection.vehicleId) throw new Error("Select a vehicle before Dispatch.");

      const access = await token();
      let effectiveSelection = { ...selection };
      if (!effectiveSelection.plannedStartTime || availableTimes[driver.driverId]?.requiredRestPeriod !== (effectiveSelection.useReducedDailyRest ? 9 : 11)) {
        const [time] = await getAvailableTimes(
          planningDate,
          [driver.driverId],
          access,
          effectiveSelection.useReducedDailyRest ? [driver.driverId] : []
        );
        if (!time?.availableFrom) throw new Error(time?.breachDetail || "A legal Tacho available time could not be calculated for this driver.");
        if (time.breachDetail) throw new Error(time.breachDetail);
        effectiveSelection = { ...effectiveSelection, plannedStartTime: time.availableFrom };
        setAvailableTimes(current => ({ ...current, [driver.driverId]: time }));
        setSelections(current => ({ ...current, [driver.driverId]: effectiveSelection }));
      }

      if (lockedRunId(driver.driverId) !== effectiveSelection.runId) {
        await allocateDispatchRun(effectiveSelection.runId, driver.driverId, effectiveSelection, access);
        setNotice(`${snapshot.runs.find(run => run.runId === effectiveSelection.runId)?.reference || "Run"} allocated to ${driver.name}. Preparing Dispatch text…`);
        onLocked?.();
      }

      const route = await getDriverDispatchRoute(effectiveSelection.runId, access);
      const minutes = routeDrivingMinutes(route);
      if (!minutes) throw new Error("The run could not be routed. No HGV driving time was returned.");

      let readiness = await checkDispatchReadiness(effectiveSelection.runId, minutes, false, access);
      let acknowledged = false;
      if (!readiness.canDispatch && readiness.structuralReadiness?.classification === "Unverified" && readiness.structuralReadiness.requiresAcknowledgement) {
        const warnings = readiness.structuralReadiness.checks.filter(check => !check.passed).map(check => `• ${check.message}`).join("\n");
        if (!window.confirm(`Pre-dispatch warnings:\n\n${warnings}\n\nAcknowledge and continue?`)) return;
        acknowledged = true;
        readiness = await checkDispatchReadiness(effectiveSelection.runId, minutes, true, access);
      }
      if (!readiness.canDispatch) throw new Error(readiness.explanation || "Dispatch readiness did not pass.");

      const dispatch = await getRunDispatch(effectiveSelection.runId, access);
      const reference = snapshot.runs.find(run => run.runId === effectiveSelection.runId)?.reference || dispatch.reference;
      setMessage({
        runId: effectiveSelection.runId,
        reference,
        text: buildDispatchText(reference, dispatch, plannedStartLocal(effectiveSelection.plannedStartTime)),
        mode: "initial",
        routeMinutes: minutes,
        acknowledgeUnverified: acknowledged
      });
    } catch (exception) {
      const reason = exception instanceof Error ? exception.message : "Dispatch could not be prepared.";
      setFailures(current => current.some(failure => failure.driverId === driver.driverId && failure.reason === reason)
        ? current
        : [...current.filter(failure => failure.driverId !== driver.driverId), { driverId: driver.driverId, runId: selection.runId, reason }]);
    } finally {
      setBusyDriverId(undefined);
    }
  }

  async function prepareAmendment(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    if (!snapshot || !selection.runId) return;
    setBusyDriverId(driver.driverId);
    setMessageError(undefined);
    try {
      const access = await token();
      const dispatch = await getRunDispatch(selection.runId, access);
      const reference = snapshot.runs.find(run => run.runId === selection.runId)?.reference || dispatch.reference;
      setMessage({
        runId: selection.runId,
        reference,
        text: buildAmendmentText(reference, dispatch, plannedStartLocal(selection.plannedStartTime)),
        mode: "amendment",
        routeMinutes: 0,
        acknowledgeUnverified: false
      });
    } catch (exception) {
      setFailures(current => [...current.filter(failure => failure.driverId !== driver.driverId), {
        driverId: driver.driverId,
        runId: selection.runId,
        reason: exception instanceof Error ? exception.message : "Amendment preview could not be prepared."
      }]);
    } finally {
      setBusyDriverId(undefined);
    }
  }

  function prepareUpdate(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    if (!snapshot || !selection.runId) return;
    const reference = snapshot.runs.find(run => run.runId === selection.runId)?.reference || "Run";
    setMessage({ runId: selection.runId, reference, text: buildUpdateText(reference), mode: "update", routeMinutes: 0, acknowledgeUnverified: false });
  }

  async function handleSamsara(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    if (!selection.runId) return;
    setBusyDriverId(driver.driverId);
    setNotice(undefined);
    setError(undefined);
    setFailures(current => current.filter(failure => failure.driverId !== driver.driverId));
    try {
      const result = await sendRunToSamsara(selection.runId, await token());
      setNotice(result.message);
    } catch (exception) {
      const reason = exception instanceof Error ? exception.message : "Run could not be sent to Samsara.";
      setFailures(current => [...current.filter(failure => failure.driverId !== driver.driverId), {
        driverId: driver.driverId,
        runId: selection.runId,
        reason
      }]);
    } finally {
      setBusyDriverId(undefined);
    }
  }

  async function handleSamsaraBatch() {
    if (!snapshot?.samsaraConfigured || samsaraExportCandidates.length === 0) return;
    const count = samsaraExportCandidates.length;
    if (count > 1 && !window.confirm(`Export ${count} allocated run${count === 1 ? '' : 's'} to Samsara? Existing Samsara routes are not duplicated.`)) return;

    setAction("samsara");
    setNotice(undefined);
    setError(undefined);
    try {
      const access = await token();
      const batchFailures: DispatchLockFailure[] = [];
      let exported = 0;

      for (const load of samsaraExportCandidates) {
        try {
          await sendRunToSamsara(load.id, access);
          exported++;
        } catch (exception) {
          batchFailures.push({
            driverId: load.driverId || "",
            runId: load.id,
            reason: exception instanceof Error ? exception.message : `${load.reference || load.id} could not be sent to Samsara.`
          });
        }
      }

      await refresh();
      setFailures(batchFailures);
      if (exported > 0)
        setNotice(`${exported} run${exported === 1 ? '' : 's'} exported to Samsara${batchFailures.length ? `; ${batchFailures.length} need attention` : '.'}`);
      else if (batchFailures.length > 0)
        setError(`No runs were exported to Samsara. ${batchFailures.length} run${batchFailures.length === 1 ? '' : 's'} need attention.`);
    } finally {
      setAction(undefined);
    }
  }

  async function handleUnassign(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    if (!selection.runId || lockedRunId(driver.driverId) !== selection.runId) return;
    const reference = snapshot?.runs.find(run => run.runId === selection.runId)?.reference || "this run";
    if (!window.confirm(`Unassign ${reference} from ${driver.name}? This releases the driver, vehicle and trailer.`)) return;
    setBusyDriverId(driver.driverId);
    setNotice(undefined);
    try {
      await unassignDispatchRun(selection.runId, await token());
      await refresh();
      setNotice(`${reference} unassigned. Driver, vehicle and trailer are free to reallocate.`);
    } catch (exception) {
      setFailures(current => [...current.filter(failure => failure.driverId !== driver.driverId), {
        driverId: driver.driverId,
        runId: selection.runId,
        reason: exception instanceof Error ? exception.message : "Run could not be unassigned."
      }]);
    } finally {
      setBusyDriverId(undefined);
    }
  }

  async function handleSendMessage(text: string, reason?: string) {
    if (!message) return;
    setSendingMessage(true);
    setMessageError(undefined);
    try {
      const access = await token();
       await sendDriverMessage(
         message.runId,
         reason ? `${text}\n\nReason for amendment: ${reason}` : text,
        message.mode === "initial",
        message.mode === "initial" ? message.routeMinutes : null,
        message.mode === "initial" ? message.acknowledgeUnverified : false,
        access
      );
      const sentMode = message.mode;
      setMessage(undefined);
      await refresh();
      setNotice(sentMode === "initial" ? "Dispatch sent. Waiting for driver confirmation." : sentMode === "amendment" ? "Amendment sent." : "Driver update sent.");
    } catch (exception) {
      setMessageError(exception instanceof Error ? exception.message : "Driver text could not be sent.");
    } finally {
      setSendingMessage(false);
    }
  }

  if (!snapshot && action === "refresh") {
    return <section className="smart-dispatch-board"><div className="smart-dispatch-loading">Building Driver Dispatch…</div></section>;
  }
  if (!snapshot) {
    return <section className="smart-dispatch-board">
      <div className="smart-dispatch-error">
        <strong>Driver Dispatch unavailable</strong>
        <span>{error || "The planning data could not be loaded."}</span>
        <button type="button" onClick={() => void refresh()}>Retry</button>
      </div>
    </section>;
  }

  return <section className="smart-dispatch-board" aria-label="Driver Dispatch">
    <header className="smart-dispatch-header">
      <div>
        <span className="smart-eyebrow">Authoritative planning & dispatch</span>
        <h2>Driver Dispatch</h2>
        <p>One screen for Tacho/live driver selection, allocation, compliance, driver messaging and Samsara route dispatch.</p>
      </div>
      <div className="smart-dispatch-actions">
        {onPlanningDateChange && <label className="smart-date-control">Planning date<input type="date" value={planningDate} onChange={event => onPlanningDateChange(event.target.value)} /></label>}
        {extraActions}
        <button
          className="smart-action primary"
          type="button"
          disabled={Boolean(action) || !snapshot.samsaraConfigured || samsaraExportCandidates.length === 0}
          onClick={() => void handleSamsaraBatch()}
          title={!snapshot.samsaraConfigured ? "Configure Samsara in Admin before exporting runs." : samsaraExportCandidates.length === 0 ? "No allocated unsent runs are ready for Samsara." : "Export all allocated runs not already sent to Samsara."}
        >
          {action === "samsara" ? "Exporting to Samsara…" : `Export to Samsara${samsaraExportCandidates.length ? ` (${samsaraExportCandidates.length})` : ''}`}
        </button>
        <button className="smart-action secondary" type="button" disabled={Boolean(action)} onClick={() => void handleSyncDrivers()}>{action === "refresh" ? "Syncing…" : "Sync Drivers"}</button>
        <button className="smart-action ghost" type="button" disabled={Boolean(action)} onClick={() => void refresh()}>{action === "refresh" ? "Refreshing…" : "Refresh"}</button>
        <GetTimesButton busy={action === "times"} onGetTimes={() => void handleGetTimes()} />
      </div>
    </header>

    <ComplianceWarningBanner drivers={snapshot.drivers} availableTimes={availableTimes} failures={failures} />
    {notice && <div className="smart-dispatch-notice" role="status">{notice}</div>}
    {error && <div className="smart-dispatch-error inline" role="alert">{error}</div>}
    {globalLockFailures.map((failure, index) => <div className="smart-dispatch-error inline" role="alert" key={`${failure.reason}-${index}`}>{failure.reason}</div>)}

    <div className="smart-dispatch-summary">
      <span><strong>{snapshot.drivers.length}</strong> recent/operational drivers</span>
      <span><strong>{snapshot.visibility.windowDays}</strong> day rolling window</span>
      <span><strong>{snapshot.runs.length}</strong> runs</span>
      <span><strong>{selectedCount}</strong> selected/allocated</span>
      <span><strong>{snapshot.drivers.filter(driver => driver.backloadCandidate).length}</strong> backload candidates</span>
      <span><strong>{Object.keys(snapshot.samsaraDispatch).length}</strong> Samsara sent</span>
    </div>

    <DispatchFilters
      value={filter}
      counts={filterCounts}
      onChange={setFilter}
      employmentValue={employmentFilter}
      employmentCounts={employmentCounts}
      onEmploymentChange={setEmploymentFilter}
      driverSearch={driverSearch}
      onDriverSearchChange={setDriverSearch}
    />

    <div className="smart-dispatch-workspace">
      <RunSidebar runs={snapshot.runs} owners={runOwnerById} drivers={snapshot.drivers} />
      <div className="smart-dispatch-table-wrap">
        <table className="smart-dispatch-table authoritative">
          <thead>
            <tr>
              <th>Driver</th><th>Duty</th><th>Last location / fit</th><th>Skills</th><th>Run</th><th>Vehicle</th><th>Trailer</th><th>Available / WTD</th><th>Status</th><th>Dispatch</th>
            </tr>
          </thead>
          <tbody>
            {visibleDrivers.map(driver => <DispatchDriverRow
              key={driver.driverId}
              driver={driver}
              runs={snapshot.runs}
              vehicles={snapshot.equipment.vehicles}
              trailers={snapshot.equipment.trailers}
              loads={snapshot.equipment.loads}
              runOwnerById={runOwnerById}
              selection={selections[driver.driverId] || emptyDispatchSelection()}
              availableTime={availableTimes[driver.driverId]}
              status={snapshot.statuses[driver.driverId]}
              lockedRunId={lockedRunId(driver.driverId)}
              samsaraState={selections[driver.driverId]?.runId ? snapshot.samsaraDispatch[selections[driver.driverId].runId] : undefined}
              samsaraConfigured={snapshot.samsaraConfigured}
              failures={rowFailures(failures, driver.driverId)}
              busy={busyDriverId === driver.driverId}
              onSelectionChange={changeSelection}
              onDispatch={(row, selection) => void prepareDispatch(row, selection)}
              onAmend={(row, selection) => void prepareAmendment(row, selection)}
              onUpdate={prepareUpdate}
              onSamsara={(row, selection) => void handleSamsara(row, selection)}
              onUnassign={(row, selection) => void handleUnassign(row, selection)}
            />)}
          </tbody>
        </table>
        {visibleDrivers.length === 0 && <div className="smart-dispatch-empty">No drivers match this filter.</div>}
      </div>
    </div>

     <p className="smart-dispatch-footnote">Select work and press Dispatch on the row to validate and allocate it, then open the editable SMS preview. The Planner owns the built-run Lock Plan step. Regular 11h daily rest is the default; choose Reduced rest (9h) only when the planner intends to use that concession. Trailer continuity follows the driver's last-used trailer unless the selected run contains a planner trailer-swap instruction. Send to Samsara updates the same external run rather than creating duplicates. Amendments, free-form updates and Unassign stay on the same row and are audited after the plan is locked.</p>

    {message && <DispatchMessageDialog
      reference={message.reference}
      initialText={message.text}
      mode={message.mode}
      busy={sendingMessage}
      error={messageError}
      onClose={() => { if (!sendingMessage) { setMessage(undefined); setMessageError(undefined); } }}
      onSend={text => void handleSendMessage(text)}
    />}
  </section>;
}
