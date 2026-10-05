import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useAccessToken } from "../../lib/auth";
import { updateRunRelay } from "../../api/runs";
import "../../smart-dispatch.css";
import { ComplianceWarningBanner } from "./ComplianceWarningBanner";
import { DriverAvailabilityPanel } from "../DriverAvailabilityPanel";
import { DispatchDriverRow } from "./DispatchDriverRow";
import { DispatchFilters } from "./DispatchFilters";
import { rankDriversForRun } from "./dispatchRunRanking";
import { allocateDispatchRun, downloadSamsaraCsv, getAvailableTimes, getSmartDispatch, sendRunToSamsara, syncDispatchDrivers, syncSamsaraMappings, unassignDispatchRun } from "./dispatchApi";
import {
  applyAvailableTimes,
  applyAvailableTime,
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
import type { DispatchAllocationSelection, DispatchDriverDto, DispatchEmploymentFilter, DispatchFilter, DispatchLockFailure, DispatchRunDto } from "./types";

type Props = {
  planningDate: string;
  onPlanningDateChange?: (date: string) => void;
  extraActions?: ReactNode;
  onLocked?: () => void;
};

type SmartDispatchSnapshot = Awaited<ReturnType<typeof getSmartDispatch>>;
type ActionState = "refresh" | "samsara" | undefined;
const filterValues: DispatchFilter[] = ["all", "unallocated", "backloads", "warnings", "skills-mismatch"];
const employmentFilterValues: DispatchEmploymentFilter[] = ["all", "employed", "agency", "casual", "subcontractor", "unmatched"];

function fleetioWarning(status?: string): string | undefined {
  const value = status?.trim();
  return value && /(out\s*of\s*service|inactive|vor|off\s*road|maintenance)/i.test(value) ? `Fleetio: ${value}` : undefined;
}

function runTime(value?: string): string {
  if (!value) return "Time not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not set" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function RouteSidebar({ runs, owners, drivers }: {
  runs: DispatchRunDto[];
  owners: Record<string, string | undefined>;
  drivers: DispatchDriverDto[];
}) {
  return <aside className="smart-run-sidebar" aria-label="Routes ready for driver allocation">
    <div className="smart-run-sidebar-head">
      <strong>Routes</strong>
      <span>{runs.length}</span>
    </div>
    <p>First collection → final delivery. Best-fit suggestions use the driver’s last known position plus first collection proximity, skills and continuity.</p>
    <div className="smart-run-card-list">
      {runs.map(run => {
        const ownerId = owners[run.runId];
        const owner = ownerId ? drivers.find(driver => driver.driverId === ownerId) : undefined;
        const suggestedDrivers = drivers.filter(driver => driver.suggestedRunId === run.runId);
        const rankedDrivers = rankDriversForRun(run, drivers, owners)
          .sort((left, right) => Number(suggestedDrivers.includes(right.driver)) - Number(suggestedDrivers.includes(left.driver)) || right.score - left.score);
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
          {!owner && rankedDrivers.length > 0 && <details className="smart-run-fit">
            <summary>Best driver matches</summary>
            <ol>{rankedDrivers.slice(0, 3).map(match => <li key={match.driver.driverId}><strong>{match.driver.name} · {match.score}/100</strong><small>{match.reasons.join(" · ")}</small></li>)}</ol>
          </details>}
          {!owner && rankedDrivers.length === 0 && <small className="smart-run-warning">No eligible driver currently matches this route</small>}
          {run.relay?.enabled && <small className="smart-run-warning">Relay: collect → {run.relay.handoverSite || "handover site required"} → delivery</small>}
          {!run.relay?.enabled && run.trailerSwapRequested && <small className="smart-run-warning">Planner note: trailer swap requested</small>}
        </article>;
      })}
    </div>
  </aside>;
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
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [relayBusyId, setRelayBusyId] = useState<string>();

  const refresh = useCallback(async () => {
    setAction(current => current || "refresh");
    setError(undefined);
    try {
      const access = await token();
      const data = await getSmartDispatch(planningDate, access);
      const initialSelections = buildInitialSelections(data.drivers, data.runs, data.equipment);
      const rows = await getAvailableTimes(
        planningDate,
        data.drivers.map(driver => driver.driverId),
        access,
        reducedRestDriverIds(initialSelections)
      );
      setSnapshot(data);
      setSelections(applyAvailableTimes(initialSelections, rows));
      setAvailableTimes(availableTimesByDriver(rows));
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
    const restChanged = Object.prototype.hasOwnProperty.call(patch, "useReducedDailyRest");
    const runChanged = Object.prototype.hasOwnProperty.call(patch, "runId");
    setSelections(current => ({
      ...current,
      [driverId]: {
        ...(current[driverId] || emptyDispatchSelection()),
        ...patch,
        ...(restChanged || runChanged ? { plannedStartTime: undefined } : {})
      }
    }));
    setFailures(current => current.filter(failure => failure.driverId !== driverId));
    if (restChanged || runChanged) {
      setAvailableTimes(current => {
        const next = { ...current };
        delete next[driverId];
        return next;
      });
      void (async () => {
        try {
          const access = await token();
          const reduced = patch.useReducedDailyRest === true ||
            (patch.useReducedDailyRest === undefined && selections[driverId]?.useReducedDailyRest === true);
          const [time] = await getAvailableTimes(planningDate, [driverId], access, reduced ? [driverId] : []);
          setAvailableTimes(current => ({ ...current, [driverId]: time }));
          setSelections(current => applyAvailableTime(current, driverId, time));
        } catch (exception) {
          setFailures(current => [...current.filter(failure => failure.driverId !== driverId), {
            driverId,
            runId: selections[driverId]?.runId,
            reason: exception instanceof Error ? exception.message : "Tacho legal start could not be recalculated."
          }]);
        }
      })();
    }
    setNotice(undefined);
  }

  async function handleRefreshStaff() {
    setAction("refresh");
    setError(undefined);
    setNotice(undefined);
    setFailures([]);
    try {
      const access = await token();
      await syncDispatchDrivers(access);
      const nextSnapshot = await getSmartDispatch(planningDate, access);
      const nextSelections = buildInitialSelections(nextSnapshot.drivers, nextSnapshot.runs, nextSnapshot.equipment);
      const rows = await getAvailableTimes(
        planningDate,
        nextSnapshot.drivers.map(driver => driver.driverId),
        access,
        reducedRestDriverIds(nextSelections)
      );
      setSnapshot(nextSnapshot);
      setSelections(applyAvailableTimes(nextSelections, rows));
      setAvailableTimes(availableTimesByDriver(rows));
      const warnings = rows.filter(row => Boolean(row.breachDetail)).length;
      setNotice(warnings > 0
        ? `Staff refreshed from Driver Master/Sage and Tacho times recalculated for ${rows.length} staff · ${warnings} require planner attention.`
        : `Staff refreshed from Driver Master/Sage and Tacho times recalculated for ${rows.length} staff.`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Driver sync and Tacho refresh failed.");
    } finally {
      setAction(undefined);
    }
  }

  async function saveRelayAllocation(runId: string, patch: { deliveryDriverId?: string; deliveryVehicleId?: string; deliveryTrailerId?: string }) {
    const run = snapshot?.runs.find(item => item.runId === runId);
    if (!run?.relay?.enabled) return;
    setRelayBusyId(runId);
    setNotice(undefined);
    try {
      await updateRunRelay(runId, {
        enabled: true,
        handoverSite: run.relay.handoverSite,
        handoverSiteId: run.relay.handoverSiteId,
        handoverAfterStopSequence: run.relay.handoverAfterStopSequence,
        plannedHandoverUtc: run.relay.plannedHandoverUtc,
        deliveryDriverId: patch.deliveryDriverId ?? run.relay.deliveryDriverId,
        deliveryVehicleId: patch.deliveryVehicleId ?? run.relay.deliveryVehicleId,
        deliveryTrailerId: patch.deliveryTrailerId ?? run.relay.deliveryTrailerId,
      }, await token());
      await refresh();
      setNotice(`${run.reference} relay allocation saved. Check both legs before exporting to Samsara.`);
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : "Relay allocation could not be saved.");
    } finally {
      setRelayBusyId(undefined);
    }
  }

  async function prepareDispatch(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    if (!snapshot || !selection.runId) return;
    setBusyDriverId(driver.driverId);
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
        setNotice(`${snapshot.runs.find(run => run.runId === effectiveSelection.runId)?.reference || "Route"} allocated to ${driver.name}. Tacho, Sage and Fleetio checks passed; allocation secured in SLH TMS.`);
        onLocked?.();
      }

      await refresh();
      setNotice(`${snapshot.runs.find(run => run.runId === effectiveSelection.runId)?.reference || "Route"} allocation secured for ${driver.name}. Use Export to Samsara when the route is ready to send.`);
    } catch (exception) {
      const reason = exception instanceof Error ? exception.message : "Dispatch could not be prepared.";
      setNotice(`Dispatch failed for ${driver.name}: ${reason}`);
      setFailures(current => current.some(failure => failure.driverId === driver.driverId && failure.reason === reason)
        ? current
        : [...current.filter(failure => failure.driverId !== driver.driverId), { driverId: driver.driverId, runId: selection.runId, reason }]);
    } finally {
      setBusyDriverId(undefined);
    }
  }

  async function handleSamsaraBatch() {
    if (!snapshot?.samsaraConfigured || samsaraExportCandidates.length === 0) return;
    const count = samsaraExportCandidates.length;
    if (count > 1 && !window.confirm(`Export ${count} allocated route${count === 1 ? '' : 's'} to Samsara? Existing Samsara routes are not duplicated.`)) return;

    setAction("samsara");
    setNotice(undefined);
    setError(undefined);
    try {
      const access = await token();
      const batchFailures: DispatchLockFailure[] = [];
      let exported = 0;

      await syncSamsaraMappings(planningDate, access);

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
         setNotice(`${exported} route${exported === 1 ? '' : 's'} exported to Samsara${batchFailures.length ? `; ${batchFailures.length} need attention` : '.'}`);
      else if (batchFailures.length > 0)
         setError(`No routes were exported to Samsara. ${batchFailures.length} route${batchFailures.length === 1 ? '' : 's'} need attention.`);
    } finally {
      setAction(undefined);
    }
  }

  async function handleSamsaraSingle(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    const existingSamsaraRoute = selection.runId ? Boolean(snapshot?.samsaraDispatch[selection.runId]) : false;
    if (!selection.runId || (!snapshot?.samsaraConfigured && !existingSamsaraRoute)) return;
    setBusyDriverId(driver.driverId);
    setNotice(undefined);
    setFailures(current => current.filter(failure => failure.driverId !== driver.driverId));
    try {
      const access = await token();
      await syncSamsaraMappings(planningDate, access);
      const result = await sendRunToSamsara(selection.runId, access);
      await refresh();
      setNotice(result.message);
    } catch (exception) {
       const reason = exception instanceof Error ? exception.message : "The route could not be sent to Samsara.";
      setFailures(current => [...current.filter(failure => failure.driverId !== driver.driverId), {
        driverId: driver.driverId,
        runId: selection.runId,
        reason
      }]);
    } finally {
      setBusyDriverId(undefined);
    }
  }

  async function handleSamsaraCsv(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    if (!selection.runId) return;
    const reference = snapshot?.runs.find(run => run.runId === selection.runId)?.reference || selection.runId;
    setBusyDriverId(driver.driverId);
    setNotice(undefined);
    setFailures(current => current.filter(failure => failure.driverId !== driver.driverId));
    try {
      await downloadSamsaraCsv(selection.runId, reference, await token());
      setNotice(`${reference} Samsara CSV downloaded.`);
    } catch (exception) {
      const reason = exception instanceof Error ? exception.message : "The Samsara CSV could not be generated.";
      setFailures(current => [...current.filter(failure => failure.driverId !== driver.driverId), {
        driverId: driver.driverId,
        runId: selection.runId,
        reason
      }]);
    } finally {
      setBusyDriverId(undefined);
    }
  }

  async function handleUnassign(driver: DispatchDriverDto, selection: DispatchAllocationSelection) {
    if (!selection.runId || lockedRunId(driver.driverId) !== selection.runId) return;
     const reference = snapshot?.runs.find(run => run.runId === selection.runId)?.reference || "this route";
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
         reason: exception instanceof Error ? exception.message : "Route could not be unassigned."
      }]);
    } finally {
      setBusyDriverId(undefined);
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
        <p>One screen for Tacho/live driver selection, allocation, compliance and Samsara route dispatch.</p>
      </div>
      <div className="smart-dispatch-actions">
        {onPlanningDateChange && <label className="smart-date-control">Planning date<input type="date" value={planningDate} onChange={event => onPlanningDateChange(event.target.value)} /></label>}
        {extraActions}
        <button
          className="smart-action primary"
          type="button"
          disabled={Boolean(action) || !snapshot.samsaraConfigured || samsaraExportCandidates.length === 0}
          onClick={() => void handleSamsaraBatch()}
           title={!snapshot.samsaraConfigured ? "Configure Samsara in Admin before exporting routes." : samsaraExportCandidates.length === 0 ? "No allocated unsent routes are ready for Samsara." : "Export all allocated routes not already sent to Samsara."}
        >
          {action === "samsara" ? "Exporting to Samsara…" : `Export to Samsara${samsaraExportCandidates.length ? ` (${samsaraExportCandidates.length})` : ''}`}
        </button>
        <button className="smart-action secondary" type="button" disabled={Boolean(action)} onClick={() => void handleRefreshStaff()}>{action === "refresh" ? "Refreshing staff…" : "Refresh Staff & Get Times"}</button>
      </div>
    </header>

    <div className="samsara-dispatch-strip" role="region" aria-label="Samsara dispatch export">
      <div>
        <strong>Samsara route export</strong>
        <span>{snapshot.samsaraConfigured
           ? `${samsaraExportCandidates.length} allocated unsent route${samsaraExportCandidates.length === 1 ? '' : 's'} ready · ${Object.keys(snapshot.samsaraDispatch).length} verified in Samsara${snapshot.samsaraStaleRouteCount ? ` · ${snapshot.samsaraStaleRouteCount} stale mapping${snapshot.samsaraStaleRouteCount === 1 ? '' : 's'} available for retry` : ''}`
          : snapshot.samsaraConnectionMessage || 'Samsara API is unavailable. CSV fallback remains available on each allocated route.'}</span>
      </div>
      <button
        className="smart-action primary"
        type="button"
        disabled={Boolean(action) || !snapshot.samsaraConfigured || samsaraExportCandidates.length === 0}
        onClick={() => void handleSamsaraBatch()}
      >
        {action === "samsara" ? "Exporting…" : "Export to Samsara"}
      </button>
    </div>

    <ComplianceWarningBanner drivers={snapshot.drivers} availableTimes={availableTimes} failures={failures} />
    <DriverAvailabilityPanel planningDate={planningDate} onChanged={() => void refresh()} />
    {notice && <div className="smart-dispatch-notice" role="status">{notice}</div>}
    {error && <div className="smart-dispatch-error inline" role="alert">{error}</div>}
    {globalLockFailures.map((failure, index) => <div className="smart-dispatch-error inline" role="alert" key={`${failure.reason}-${index}`}>{failure.reason}</div>)}

    {snapshot.runs.filter(run => run.relay?.enabled).map(run => {
      const relay = run.relay!;
      const deliveryDriver = snapshot.drivers.find(driver => driver.driverId === relay.deliveryDriverId);
      const load = snapshot.equipment.loads.find(item => item.id === run.runId);
      const collectionDriver = snapshot.drivers.find(driver => driver.driverId === load?.driverId);
      return <section className="relay-dispatch-panel" key={run.runId} aria-label={`Relay allocation for ${run.reference}`}>
        <div><strong>{run.reference} · Relay / trailer swap</strong><span>{collectionDriver?.name || "Collection driver not allocated"} collects → {relay.handoverSite || "handover site required"} → delivery driver</span></div>
        <label>Delivery driver<select value={relay.deliveryDriverId || ""} onChange={event => void saveRelayAllocation(run.runId, { deliveryDriverId: event.target.value || undefined })} disabled={relayBusyId === run.runId}><option value="">Select delivery driver…</option>{snapshot.drivers.filter(driver => !driver.onLeave && !driver.isBlocked).map(driver => <option key={driver.driverId} value={driver.driverId}>{driver.name} · {driver.driverCode}</option>)}</select></label>
        <label>Delivery vehicle<select value={relay.deliveryVehicleId || ""} onChange={event => void saveRelayAllocation(run.runId, { deliveryVehicleId: event.target.value || undefined })} disabled={relayBusyId === run.runId}><option value="">Select delivery vehicle…</option>{snapshot.equipment.vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration}{vehicle.fleetNumber ? ` · ${vehicle.fleetNumber}` : ""}</option>)}</select></label>
        <label>Delivery trailer<select value={relay.deliveryTrailerId || ""} onChange={event => void saveRelayAllocation(run.runId, { deliveryTrailerId: event.target.value || undefined })} disabled={relayBusyId === run.runId}><option value="">Select replacement trailer…</option>{snapshot.equipment.trailers.map(trailer => <option key={trailer.id} value={trailer.id}>{trailer.trailerNumber}{trailer.type ? ` · ${trailer.type}` : ""}</option>)}</select></label>
        <small>{deliveryDriver ? `Delivery leg: ${deliveryDriver.name}` : "Samsara export will remain blocked until the delivery leg is assigned."}</small>
      </section>;
    })}

    <div className="smart-dispatch-summary">
      <span><strong>{snapshot.drivers.length}</strong> recent/operational drivers</span>
      <span><strong>{snapshot.visibility.windowDays}</strong> day rolling window</span>
      <span><strong>{snapshot.runs.length}</strong> routes</span>
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
      <RouteSidebar runs={snapshot.runs} owners={runOwnerById} drivers={snapshot.drivers} />
      <div className="smart-dispatch-table-wrap">
        <table className="smart-dispatch-table authoritative">
          <thead>
            <tr>
              <th>Driver</th><th>Duty</th><th>Last location / fit</th><th>Skills</th><th>Route</th><th>Vehicle</th><th>Trailer</th><th>Available / WTD</th><th>Status</th><th>Dispatch</th>
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
               onSamsaraAndDispatch={(row, selection) => void handleSamsaraSingle(row, selection)}
              onDownloadSamsaraCsv={(row, selection) => void handleSamsaraCsv(row, selection)}
              onUnassign={(row, selection) => void handleUnassign(row, selection)}
            />)}
          </tbody>
        </table>
        {visibleDrivers.length === 0 && <div className="smart-dispatch-empty">No drivers match this filter.</div>}
      </div>
    </div>

    <p className="smart-dispatch-footnote">Select a route and press Dispatch to secure the driver, vehicle and trailer allocation in SLH TMS. Tacho supplies duty day, legal start and available hours; Sage leave and Fleetio vehicle/trailer status are checked at allocation. Export to Samsara is a separate deliberate action after the route is ready. Regular 11h daily rest is the default; choose Reduced rest (9h) only when the planner intends to use that concession. Trailer continuity follows the driver's last-used trailer unless the selected route contains a planner trailer-swap instruction. Unassign remains audited after the plan is locked.</p>
  </section>;
}
