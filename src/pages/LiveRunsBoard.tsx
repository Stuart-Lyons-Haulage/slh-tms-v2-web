import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, request, type DeliveryEta, type FleetStatus, type Load } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { parseApiDateTime, todayIsoDate } from "../lib/dateUtils";
import { subscribePlanningChanges } from "../lib/planningEvents";
import { displayRunReference } from "../lib/runDisplay";
import { useApi } from "../lib/useApi";
import "../live-runs.css";
import { listRuns } from '../api/runs';

type RunColour = "upcoming" | "stationary" | "on-time" | "at-risk";
type RunProgressStop = { id: string; sequence: number; name: string; plannedArrivalUtc?: string };
type RunProgressVisit = { geofenceName?: string; enteredAtUtc: string; siteArrivalUtc?: string; siteDepartureUtc?: string; confirmedAtUtc?: string; dwellMinutes?: number; liveDwellMinutes?: number; liveDwellSeconds?: number; finalDwellMinutes?: number; finalDwellSeconds?: number; waitLimitMinutes?: number; isDelayed: boolean; status: string; statusReason?: string };
type RunStopDwell = { stopId: string; sequence: number; stopName: string; state: "EnRoute" | "OnSite" | "Departed"; siteArrivalUtc?: string; siteDepartureUtc?: string; liveDwellSeconds?: number; liveDwellMinutes?: number; finalDwellSeconds?: number; finalDwellMinutes?: number };
type RunTachoEvidence = { status: "Matched" | "CardConfirmed" | "Mismatch" | "NoTachoDuty" | "NoPlannedDriver" | "NoPlannedVehicle" | "Unavailable" | string; driverName?: string; vehicleCode?: string; signOnUtc?: string; dutyEndUtc?: string; driveAvailableTodayMinutes?: number; driveAvailableWeekMinutes?: number; workAvailableWeekMinutes?: number; cardConfirmed?: boolean; legalHoursAvailable?: boolean; evidenceSource?: string; explanation?: string };
type RunProgressRecord = { loadId: string; loadReference: string; loadStatus: string; runState: string; totalStops: number; completedStops: number; progressPercent: number; nextStop?: RunProgressStop | null; currentVisit?: RunProgressVisit | null; lastDeparture?: { exitedAtUtc: string; dwellMinutes: number; finalDwellSeconds?: number; finalDwellMinutes?: number } | null; stopDwell?: RunStopDwell[]; linkageException?: { state: string; geofenceName: string; message: string } | null; tacho?: RunTachoEvidence | null };
type RunProgressResponse = { planningDate: string; calculatedAtUtc: string; source?: string; geofenceAvailable?: boolean; geofenceCount?: number; geofenceVisitCount?: number; geofenceLinkedRuns?: number; warning?: string; records: RunProgressRecord[] };

type LiveRunRow = {
  load: Load;
  progress?: RunProgressRecord;
  vehicle?: FleetStatus["vehicles"][number];
  registration: string;
  driver: string;
  trailer?: string;
  firstPlannedUtc?: string;
  nextEta?: DeliveryEta;
  finalEta?: DeliveryEta;
  etas: DeliveryEta[];
  status: RunColour;
  statusLabel: string;
  statusDetail: string;
  carryOver: boolean;
};

const UK_TIME_ZONE = "Europe/London";
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: UK_TIME_ZONE, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
function apiTimeMs(value?: string) {
  return parseApiDateTime(value)?.getTime() ?? Number.NaN;
}

function formatTime(value?: string) {
  const parsed = parseApiDateTime(value);
  return parsed ? timeFormatter.format(parsed) : "—";
}

function formatAge(value?: string | Date, now = new Date()) {
  if (!value) return "No live update";
  const parsed = parseApiDateTime(value);
  if (!parsed) return "No live update";
  const seconds = Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function formatDuration(seconds?: number, minutes?: number) {
  const totalMinutes = seconds != null ? Math.max(0, Math.floor(seconds / 60)) : Math.max(0, minutes ?? 0);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function dwellLine(progress?: RunProgressRecord) {
  if (progress?.currentVisit) return `Time on site: ${formatDuration(progress.currentVisit.liveDwellSeconds, progress.currentVisit.liveDwellMinutes ?? progress.currentVisit.dwellMinutes)}`;
  const departed = progress?.lastDeparture || [...(progress?.stopDwell || [])].reverse().find(stop => stop.state === "Departed");
  if (departed) return `Dwell time: ${formatDuration(departed.finalDwellSeconds, departed.finalDwellMinutes ?? ("dwellMinutes" in departed ? departed.dwellMinutes : undefined))}`;
  return progress?.linkageException ? "Geofence link needs review" : undefined;
}

function tachoLine(progress: RunProgressRecord | undefined, vehicle: LiveRunRow["vehicle"]) {
  const tacho = progress?.tacho;
  if (tacho?.status === "Matched") return `Signed on ${formatTime(tacho.signOnUtc)}${tacho.vehicleCode ? ` · ${tacho.vehicleCode}` : ""}`;
  if (tacho?.status === "CardConfirmed") return `Card confirmed ${formatTime(tacho.signOnUtc)}${tacho.legalHoursAvailable ? " · hours attached" : " · hours missing"}`;
  if (tacho?.status === "Mismatch") return `Tacho mismatch${tacho.driverName ? ` · ${tacho.driverName}` : ""}`;
  if (tacho?.status === "NoTachoDuty") return "Not signed on in TachoMaster";
  if (tacho?.status === "NoPlannedDriver") return "No planned driver";
  if (tacho?.status === "NoPlannedVehicle") return "No planned vehicle";
  if (tacho?.status === "Unavailable") return "TachoMaster unavailable";
  if (vehicle?.tacho?.dutyStartUtc) return `Signed on ${formatTime(vehicle.tacho.dutyStartUtc)}${vehicle.tacho.vehicleCode ? ` · ${vehicle.tacho.vehicleCode}` : ""}`;
  return "TachoMaster evidence missing";
}

function statusFor(progress: RunProgressRecord | undefined, vehicle: LiveRunRow["vehicle"], etas: DeliveryEta[]) {
  if (progress?.runState === "Completed") {
    return { status: "upcoming" as const, label: "COMPLETED", detail: "All geofence-confirmed stops completed" };
  }

  if (progress?.currentVisit?.isDelayed) {
    return {
      status: "at-risk" as const,
      label: "SITE DELAY",
      detail: `${progress.currentVisit.geofenceName || "Site"} · ${progress.currentVisit.dwellMinutes ?? 0} min dwell`,
    };
  }

  if (progress?.currentVisit) {
    const confirmed = Boolean(progress.currentVisit.confirmedAtUtc);
    return {
      status: "stationary" as const,
      label: confirmed ? "ON SITE" : "AT SITE · VERIFYING",
      detail: `${progress.currentVisit.geofenceName || "Matched geofence"} · ${progress.currentVisit.dwellMinutes ?? 0} min dwell`,
    };
  }

  const risk = etas.find((eta) => eta.risk === "Late" || eta.risk === "AtRisk" || eta.tachoStatus === "InsufficientDriveTime");
  if (risk) {
    return {
      status: "at-risk" as const,
      label: "AT RISK",
      detail: risk.tachoStatus === "InsufficientDriveTime" ? "Driver hours affect ETA" : `${risk.stopName} ${risk.risk.toLowerCase()}`,
    };
  }

  if (!vehicle || ["Parked", "Stale", "NotSignedOn"].includes(vehicle.condition)) {
    return {
      status: "upcoming" as const,
      label: vehicle?.condition === "Stale" ? "TRACKING STALE" : "UPCOMING",
      detail: progress?.runState === "BetweenStops" ? `Between stops · next ${progress.nextStop?.name || "stop"}` : vehicle?.condition === "Stale" ? "Waiting for fresh tracking" : "Awaiting start / movement",
    };
  }

  if (["Stationary", "Started", "SignedOn"].includes(vehicle.condition) && !(vehicle.speedKph && vehicle.speedKph > 2)) {
    return {
      status: "stationary" as const,
      label: progress?.runState === "BetweenStops" ? "BETWEEN STOPS" : "STATIONARY",
      detail: progress?.runState === "BetweenStops" ? `Stopped between sites · next ${progress.nextStop?.name || "stop"}` : vehicle.condition === "Stationary" ? "Vehicle stationary" : "Signed on / awaiting movement",
    };
  }

  const hasUsableEta = etas.some((eta) => Boolean(eta.etaUtc) && eta.source !== "Unavailable");
  if (vehicle.condition === "Moving" && hasUsableEta) {
    return {
      status: "on-time" as const,
      label: progress?.runState === "BetweenStops" ? "BETWEEN STOPS" : "ON TIME",
      detail: progress?.nextStop ? `Next ${progress.nextStop.name} · live ETA active` : "Live ETA inside planned window",
    };
  }

  return {
    status: "upcoming" as const,
    label: vehicle.condition === "Moving" ? "ETA PENDING" : "UPCOMING",
    detail: vehicle.condition === "Moving" ? "Vehicle moving; ETA still calculating" : "Awaiting live movement",
  };
}

function pickNextEta(etas: DeliveryEta[], now: Date, progress?: RunProgressRecord) {
  const sorted = [...etas].sort((left, right) => left.sequence - right.sequence);
  const nextSequence = progress?.nextStop?.sequence;
  if (nextSequence != null) return sorted.find((eta) => eta.sequence >= nextSequence) || sorted.at(-1);
  const cutoff = now.getTime() - 15 * 60 * 1000;
  return sorted.find((eta) => !eta.etaUtc || apiTimeMs(eta.etaUtc) >= cutoff) || sorted.at(-1);
}

function averageWindowBuffer(rows: LiveRunRow[]) {
  const minutes = rows.flatMap((row) => {
    if (row.progress?.runState === "Completed") return [];
    const eta = row.nextEta;
    if (!eta?.etaUtc || !eta.deliveryWindowEndUtc) return [];
    const value = Math.round((apiTimeMs(eta.deliveryWindowEndUtc) - apiTimeMs(eta.etaUtc)) / 60000);
    return Number.isFinite(value) ? [value] : [];
  });
  if (!minutes.length) return "—";
  const average = Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length);
  const sign = average >= 0 ? "+" : "−";
  const absolute = Math.abs(average);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function currentTracking(progress: RunProgressRecord | undefined, vehicle: LiveRunRow["vehicle"], now: Date) {
  if (progress?.currentVisit) {
    return {
      primary: `${progress.currentVisit.confirmedAtUtc ? "On site" : "Inside geofence"} · ${progress.currentVisit.geofenceName || "matched site"}`,
      secondary: `${progress.currentVisit.dwellMinutes ?? 0} min dwell · ${progress.currentVisit.confirmedAtUtc ? "visit confirmed" : "confirmation pending"}`,
    };
  }
  if (!vehicle) return { primary: progress?.runState === "Completed" ? "Run complete" : "No live vehicle match", secondary: progress?.runState === "Completed" ? "Geofence progression complete" : "Awaiting DOT/Falcon link" };
  const liveDriver = vehicle.driverName
    ? `${vehicle.driverSource === "TachoMaster" ? "Tacho card" : vehicle.driverSource === "DOT/Falcon" ? "DOT driver" : "Planned driver"} · ${vehicle.driverName}`
    : undefined;
  const mismatch = vehicle.driverMismatch && vehicle.allocatedDriverName ? ` · allocated ${vehicle.allocatedDriverName}` : "";
  if (vehicle.condition === "Moving") {
    return { primary: `Moving · ${Math.round(vehicle.speedKph || 0)} km/h`, secondary: `${liveDriver || "No live driver card"} · DOT update ${formatAge(vehicle.lastEventTimeUtc, now)}${mismatch}` };
  }
  return { primary: vehicle.condition.replace(/([A-Z])/g, " $1").trim(), secondary: `${liveDriver || "No live driver card"} · DOT update ${formatAge(vehicle.lastEventTimeUtc, now)}${mismatch}` };
}

function progressPriority(progress: RunProgressRecord | undefined, load: Load) {
  if (progress?.currentVisit) return 100;
  if (progress?.runState === "BetweenStops" || progress?.runState === "InProgress" || progress?.runState === "OnSiteConfirmed" || progress?.runState === "SiteDelay") return 90;
  if ((progress?.completedStops || 0) > 0 && progress?.runState !== "Completed") return 80;
  if (load.status === "InProgress") return 70;
  if (load.status === "Dispatched") return 60;
  if (load.status === "Planned") return 40;
  return 10;
}

function firstPlanned(load: Load) {
  return [...(load.stops || [])].sort((a, b) => a.sequence - b.sequence)[0]?.plannedArrivalUtc;
}

export function LiveRunsBoard({ tvMode = false }: { tvMode?: boolean }) {
  const token = useAccessToken();
  const date = todayIsoDate();
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState(() => new Date());

  const { data: loadData, error: loadError, loading: loadLoading, refresh: refreshLoads } = useApi(useCallback(async () => {
    const access = await token();
    return (await listRuns(date, access)).filter((load) => load.planningDate === date);
  }, [date, token]));

  const { data: fleetData, error: fleetError, refresh: refreshFleet } = useApi(useCallback(async () => api.fleetStatus(await token()), [token]));

  const { data: etaData, error: etaError, refresh: refreshEtas } = useApi(useCallback(async () => {
    const access = await token();
    return api.deliveryEtas(date, access);
  }, [date, token]));

  const { data: assignmentData, error: assignmentError, refresh: refreshAssignments } = useApi(useCallback(async () =>
    api.driverAssignments(date, date, await token()), [date, token]));

  const { data: progressData, error: progressError, refresh: refreshProgress } = useApi(useCallback(async () => {
    const access = await token();
    const current = await request<RunProgressResponse>(`/api/v1/run-progress?date=${encodeURIComponent(date)}`, access);
    return { ...current, records: current.records.filter((progress) => loadData?.some((load) => load.id === progress.loadId) ?? true) };
  }, [date, loadData, token]));

  useEffect(() => {
    const refreshAll = () => {
      void Promise.all([refreshLoads(), refreshFleet(), refreshEtas(), refreshAssignments(), refreshProgress()]).then(() => setLastRefresh(new Date()));
    };
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    const refreshTimer = window.setInterval(refreshAll, 20000);
    const unsubscribe = subscribePlanningChanges(refreshAll);
    window.addEventListener("focus", refreshAll);
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(refreshTimer);
      unsubscribe();
      window.removeEventListener("focus", refreshAll);
    };
  }, [refreshAssignments, refreshEtas, refreshFleet, refreshLoads, refreshProgress]);

  const rows = useMemo<LiveRunRow[]>(() => {
    const now = clock;
    const fleetById = new Map((fleetData?.vehicles || []).map((vehicle) => [vehicle.vehicleId, vehicle]));
    const fleetByLoad = new Map((fleetData?.vehicles || []).filter((vehicle) => vehicle.loadId).map((vehicle) => [vehicle.loadId!, vehicle]));
    const assignmentByLoad = new Map((assignmentData || []).map((assignment) => [assignment.loadId, assignment]));
    const progressByLoad = new Map((progressData?.records || []).map((progress) => [progress.loadId, progress]));
    const etaByLoad = new Map<string, DeliveryEta[]>();
    for (const eta of etaData?.records || []) {
      const existing = etaByLoad.get(eta.loadId) || [];
      existing.push(eta);
      etaByLoad.set(eta.loadId, existing);
    }

    const vehicleCandidates = new Map<string, Array<{ load: Load; progress?: RunProgressRecord; planned?: string }>>();
    for (const load of loadData || []) {
      const assignment = assignmentByLoad.get(load.id);
      const progress = progressByLoad.get(load.id);
      if (progress?.runState === "Completed" || load.status === "Completed" || load.status === "Cancelled") continue;
      const vehicleId = load.vehicleId || assignment?.vehicle?.id;
      if (!vehicleId) continue;
      const candidates = vehicleCandidates.get(vehicleId) || [];
      candidates.push({ load, progress, planned: firstPlanned(load) });
      vehicleCandidates.set(vehicleId, candidates);
    }

    const activeLoadByVehicle = new Map<string, string>();
    for (const [vehicleId, candidates] of vehicleCandidates) {
      const ordered = [...candidates].sort((a, b) => {
        const priority = progressPriority(b.progress, b.load) - progressPriority(a.progress, a.load);
        if (priority) return priority;
        const aTime = a.planned ? apiTimeMs(a.planned) : Number.MAX_SAFE_INTEGER;
        const bTime = b.planned ? apiTimeMs(b.planned) : Number.MAX_SAFE_INTEGER;
        const nowMs = now.getTime();
        const aPast = aTime <= nowMs;
        const bPast = bTime <= nowMs;
        if (aPast !== bPast) return aPast ? -1 : 1;
        if (aPast && bPast) return bTime - aTime;
        return aTime - bTime;
      });
      if (ordered[0]) activeLoadByVehicle.set(vehicleId, ordered[0].load.id);
    }

    return (loadData || []).map((load) => {
      const assignment = assignmentByLoad.get(load.id);
      const progress = progressByLoad.get(load.id);
      const resolvedVehicleId = load.vehicleId || assignment?.vehicle?.id;
      const sharedVehicle = resolvedVehicleId ? fleetById.get(resolvedVehicleId) : undefined;
      const directVehicle = fleetByLoad.get(load.id);
      const activeLoadId = resolvedVehicleId ? activeLoadByVehicle.get(resolvedVehicleId) : undefined;
      const vehicle = progress?.runState === "Completed" ? undefined : activeLoadId === load.id ? (sharedVehicle || directVehicle) : !activeLoadId && directVehicle ? directVehicle : undefined;
      const runEtas = [...(etaByLoad.get(load.id) || [])].sort((left, right) => left.sequence - right.sequence);
      const nextEta = pickNextEta(runEtas, now, progress);
      const relevantEtas = nextEta ? runEtas.filter((eta) => eta.sequence >= nextEta.sequence) : runEtas;
      const finalEta = runEtas.at(-1);
      const firstPlannedUtc = firstPlanned(load) || vehicle?.plannedDutyUtc;
      const state = statusFor(progress, vehicle, relevantEtas);
      const carryOver = false;
      return {
        load,
        progress,
        vehicle,
        registration: assignment?.vehicle?.registration || sharedVehicle?.registration || "Vehicle TBC",
        driver: sharedVehicle?.driverSource === "TachoMaster" ? sharedVehicle.driverName || assignment?.driver?.displayName || "Driver TBC" : assignment?.driver?.displayName || sharedVehicle?.driverName || "Driver TBC",
        trailer: assignment?.trailerNumber,
        firstPlannedUtc,
        nextEta,
        finalEta,
        etas: runEtas,
        status: state.status,
        statusLabel: state.label,
        statusDetail: carryOver ? `Previous-night carry-over · ${state.detail}` : state.detail,
        carryOver,
      };
    }).filter((row) => {
      if (row.load.planningDate === date) return true;
      return false;
    }).sort((left, right) => {
      if (left.carryOver !== right.carryOver) return left.carryOver ? -1 : 1;
      const leftCompleted = left.progress?.runState === "Completed" ? 1 : 0;
      const rightCompleted = right.progress?.runState === "Completed" ? 1 : 0;
      if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
      const leftTime = left.firstPlannedUtc ? apiTimeMs(left.firstPlannedUtc) : Number.MAX_SAFE_INTEGER;
      const rightTime = right.firstPlannedUtc ? apiTimeMs(right.firstPlannedUtc) : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.load.reference.localeCompare(right.load.reference);
    });
  }, [assignmentData, clock, date, etaData, fleetData, loadData, progressData]);

  const onTime = rows.filter((row) => row.status === "on-time").length;
  const onSite = rows.filter((row) => Boolean(row.progress?.currentVisit)).length;
  const atRisk = rows.filter((row) => row.status === "at-risk").length;
  const vehiclesOut = new Set(rows.filter((row) => row.vehicle && ["Moving", "Started", "SignedOn", "Stationary"].includes(row.vehicle.condition)).map((row) => row.vehicle!.vehicleId)).size;
  const onTimePercent = vehiclesOut ? Math.round((onTime / vehiclesOut) * 100) : 0;
  const refreshError = loadError || fleetError || etaError || assignmentError || progressError;

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  return <section className={`live-runs-board ${tvMode ? "tv-board" : "dashboard-board"}`}>
    <div className="live-runs-topbar">
      <div className="live-runs-title"><div className="live-runs-mark">SLH</div><div><p>LIVE OPERATIONS</p><h1>Live Runs</h1></div></div>
      <div className="live-runs-actions">
        {!tvMode && <Link className="live-runs-tv-link" to="/live-runs/tv" target="_blank" rel="noopener noreferrer">Open office TV view ↗</Link>}
        {tvMode && <><Link className="live-runs-tv-link subtle" to="/live-runs">Back to Live Runs</Link><button type="button" onClick={() => void toggleFullscreen()}>Full screen</button></>}
        <div className="live-runs-clock"><strong>{timeFormatter.format(clock)}</strong><span>{dateFormatter.format(clock)}</span></div>
      </div>
    </div>

    <div className="live-runs-kpis">
      <article><span className="kpi-icon">▣</span><div><small>Vehicles out</small><strong>{vehiclesOut}<em> / {rows.length}</em></strong></div></article>
      <article className="good"><span className="kpi-icon">✓</span><div><small>On time</small><strong>{onTime}<em> {onTimePercent}%</em></strong></div></article>
      <article className="watch"><span className="kpi-icon">⌖</span><div><small>On site</small><strong>{onSite}</strong></div></article>
      <article className="bad"><span className="kpi-icon">!</span><div><small>At risk</small><strong>{atRisk}</strong></div></article>
      <article><span className="kpi-icon">◎</span><div><small>Avg window buffer</small><strong>{averageWindowBuffer(rows)}</strong></div></article>
    </div>

    <div className="live-runs-meta">
      <span>↕ Previous-night runs remain live until complete; active carry-overs remain visible after the AM handover</span>
      <div className="live-runs-legend"><span><i className="dot upcoming" />Upcoming / complete</span><span><i className="dot stationary" />On site / stationary</span><span><i className="dot on-time" />On route</span><span><i className="dot at-risk" />At risk / delay</span></div>
    </div>

    {progressData?.geofenceAvailable === false && <div className="live-runs-warning">Geofence progression is unavailable. Live Runs is temporarily using tracking, ETA and plan status only.{progressData.warning ? ` ${progressData.warning}` : ""}</div>}
    {progressData?.geofenceAvailable !== false && progressData?.warning && <div className="live-runs-warning">{progressData.warning}</div>}
    {refreshError && <div className="live-runs-warning">Live refresh issue: {refreshError}. Last successful data remains on screen.</div>}

    <div className="live-runs-head" aria-hidden="true"><span>Vehicle / driver / run</span><span>Route / jobs</span><span>First planned</span><span>Window end</span><span>Live ETA / next stop</span><span>Tracking / geofence</span><span>Status</span></div>

    <div className="live-runs-list">
      {!loadData && loadLoading && <div className="live-runs-empty">Loading current and overnight runs…</div>}
      {loadData && rows.length === 0 && <div className="live-runs-empty">No current or carried-over live runs are available.</div>}
      {rows.map((row) => {
        const tracking = currentTracking(row.progress, row.vehicle, clock);
        const sortedStops = [...(row.load.stops || [])].sort((left, right) => left.sequence - right.sequence);
        const currentSequence = row.progress?.nextStop?.sequence ?? row.nextEta?.sequence;
        const completedStops = row.progress?.completedStops ?? 0;
        const completed = row.progress?.runState === "Completed";
        const baseRunLabel = displayRunReference(row.load.reference, row.load.plannerNotes, row.firstPlannedUtc);
        const runLabel = row.carryOver ? `${baseRunLabel} · CARRY-OVER` : baseRunLabel;
        const dwell = dwellLine(row.progress);
        const tacho = tachoLine(row.progress, row.vehicle);
        return <article className={`live-run-row ${row.status}`} key={row.load.id}>
          <div className="run-identity"><span className="run-truck">▰</span><div><strong>{row.registration}</strong>{dwell && <small className="run-dwell-line">{dwell}</small>}<span>{row.driver}</span><small>{tacho}</small><small>{row.trailer ? `${runLabel} · Trailer ${row.trailer}` : runLabel}</small></div></div>
          <div className="run-route">
            <strong>{sortedStops.length ? sortedStops.map((stop) => stop.name).join(" → ") : runLabel}</strong>
            {sortedStops.length > 0 && <div className="run-progress" aria-label={`${completedStops} of ${sortedStops.length} stops completed`}>
              {sortedStops.map((stop) => {
                const sequenceDone = completed || stop.sequence <= completedStops || (currentSequence != null && stop.sequence < currentSequence);
                const sequenceCurrent = !sequenceDone && (currentSequence === stop.sequence || (currentSequence == null && completedStops > 0 && stop.sequence === completedStops + 1));
                return <i key={stop.id} className={sequenceDone ? "done" : sequenceCurrent ? "current" : ""} />;
              })}
            </div>}
          </div>
          <div className="run-time"><strong>{formatTime(row.firstPlannedUtc)}</strong><small>{sortedStops[0]?.name || "First stop TBC"}</small></div>
          <div className="run-time"><strong>{formatTime(row.finalEta?.deliveryWindowEndUtc)}</strong><small>{row.finalEta?.stopName || "Window TBC"}</small></div>
          <div className="run-eta"><strong>{completed ? "✓" : formatTime(row.nextEta?.etaUtc)}</strong><small>{completed ? "Run completed" : row.progress?.currentVisit?.geofenceName || row.nextEta?.stopName || row.progress?.nextStop?.name || "ETA calculating"}</small></div>
          <div className="run-tracking"><strong>{tracking.primary}</strong><small>{row.progress?.linkageException?.message || tracking.secondary}</small></div>
          <div className="run-status"><span>{row.statusLabel}</span><small>{row.statusDetail}</small>{!tvMode && <Link to={`/timeline/run/${row.load.id}`}>Open run →</Link>}</div>
        </article>;
      })}
    </div>

    <footer className="live-runs-footer"><span>UK local time · Europe/London</span><span>Tracking, ETA & geofence refresh every 20 seconds</span><span>{progressData?.geofenceCount ?? 0} active geofences · {progressData?.geofenceLinkedRuns ?? 0} runs linked</span><span>Refreshed {formatAge(lastRefresh, clock)}</span></footer>
  </section>;
}
