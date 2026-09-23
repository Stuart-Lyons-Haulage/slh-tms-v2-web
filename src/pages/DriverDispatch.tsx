import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { request, type LoadDispatch, type Trailer, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { getDriverDispatchRoute, getRunDispatch } from "../api/runs";
import { firstCollectionStop, runDirection, sortDispatchDrivers, suggestionRunLabel } from "./DriverDispatchPlanning";
import { dispatchStartsCalculatedEvent, type StartSuggestion } from "./DispatchCalculatedStarts";
import { getMasterDispatchData, type MasterVehicle } from "../api/master";
import "../driver-dispatch.css";
import "../driver-dispatch-compact.css";

type DispatchStop = {
  id: string;
  sequence: number;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  plannedArrivalUtc?: string;
  plannerNote?: string;
};

type DispatchLoad = {
  id: string;
  reference: string;
  rawReference: string;
  planningDate: string;
  status: string;
  driverId?: string;
  vehicleId?: string;
  trailerId?: string;
  palletSpacesUsed?: number;
  totalPalletSpaces?: number;
  capacityType?: string;
  plannerNotes?: string;
  southbound: boolean;
  plannedStartUtc?: string;
  stops: DispatchStop[];
};

type DispatchDriver = {
  driverId: string;
  employeeNumber: string;
  displayName: string;
  driverType: "Employed" | "Casual" | "Agency" | "Subcontractor";
  driverGroup?: string;
  skills?: string;
  coding?: string;
  agencyName?: string;
  tachoMasterDriverId?: string;
  tachoCardNumber?: string;
  dayNumber: number;
  onLeave: boolean;
  leaveType?: string;
  partDayLeave: boolean;
  previousRunReference?: string;
  previousVehicleId?: string;
  previousVehicleRegistration?: string;
  previousFinalStop?: string;
  previousRoute?: string;
  assignedLoadId?: string;
  assignedRunCount: number;
  suggestedRunId?: string;
  suggestedRunReference?: string;
  suggestedVehicleId?: string;
  suggestedVehicleRegistration?: string;
  assistantScore?: number;
  suggestion?: string;
  agencyBookedFrom?: string;
  agencyBookedThrough?: string;
  masterDriverId?: string;
  licenceExpiry?: string;
  cpcExpiry?: string;
  digitalTachoCardExpiry?: string;
  medicalExpiry?: string;
};

type DispatchVehicle = Vehicle & { masterCompliance?: MasterVehicle };
type Workbench = {
  planningDate: string;
  weekStart?: string;
  weekEnd?: string;
  leaveSource: string;
  assistantSource?: string;
  drivers: DispatchDriver[];
  vehicles: DispatchVehicle[];
  trailers: Trailer[];
  loads: DispatchLoad[];
};

type DriverType = DispatchDriver["driverType"];
type DriverForm = { displayName: string; employeeNumber: string; driverType: DriverType; agencyName: string; startDate: string; days: number };
type DispatchStatus = "No Run" | "Awaiting Dispatch" | "Sent Awaiting Response" | "Confirmed";
type DriverDispatchStatus = {
  driverId: string;
  dispatchStatus: DispatchStatus;
  lastDriverReply?: string;
  lastDriverReplyAtUtc?: string;
  lastDispatchSentAtUtc?: string;
  weeklyRestStatus: "Ready" | "DueSoon" | "Overdue" | "Unverified" | "Unknown";
  weeklyRestMessage: string;
  weeklyRestDueUtc?: string;
  lastWeeklyRestEndUtc?: string;
  availabilityStatus?: "Available" | "Unavailable" | "Unverified";
  availabilityMessage?: string;
  driveAvailablePlanningDayMinutes?: number;
  workAvailableWeekMinutes?: number;
  projectedDayNumber?: number;
  earliestStartUtc?: string;
  earliestStartSource?: string;
  earliestStartIsAssumption?: boolean;
};
type MessageMode = "initial" | "amendment" | "update";
type MessageState = { load: DispatchLoad; text: string; routeMinutes: number; acknowledgeUnverified: boolean; mode: MessageMode };
type DispatchReadiness = {
  canDispatch: boolean;
  explanation?: string;
  structuralReadiness?: {
    classification: "Recommended" | "Unverified" | "Blocked";
    requiresAcknowledgement: boolean;
    checks: Array<{ passed: boolean; message: string }>;
  };
};
type FilterKey = "driver" | "typeSkills" | "code" | "day" | "previous" | "vehicle" | "trailer" | "run" | "assistant" | "dispatch";
type Filters = Record<FilterKey, string>;
type SearchOption = { id: string; label: string; search?: string };

const filterKeys: FilterKey[] = ["driver", "typeSkills", "code", "day", "previous", "vehicle", "trailer", "run", "assistant", "dispatch"];
const filterPlaceholders: Record<FilterKey, string> = {
  driver: "Driver…",
  typeSkills: "Type / skill…",
  code: "Code…",
  day: "Day…",
  previous: "Previous…",
  vehicle: "Vehicle…",
  trailer: "Trailer…",
  run: "Filter",
  assistant: "Assistant…",
  dispatch: "Status…"
};

function emptyFilters(): Filters {
  return Object.fromEntries(filterKeys.map(key => [key, ""])) as Filters;
}
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function today() {
  return isoDate(new Date());
}
function localTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
function orderedStops(load?: DispatchLoad) {
  return [...(load?.stops || [])].sort((a, b) => a.sequence - b.sequence);
}
function compactRun(load?: DispatchLoad) {
  if (!load) return "—";
  const match = `${load.reference} ${load.rawReference}`.match(/\b(?:run\s*)?(\d{1,3})\b/i);
  return `${load.southbound ? "SB " : ""}${match?.[1] || load.reference}`;
}
function cleanStopName(value?: string) {
  return (value || "").replace(/^(?:Collect|Deliver)\s*[·:-]\s*/i, "").replace(/-/g, " ").trim();
}
function dayClass(day: number) {
  return day >= 5 ? "red" : day === 4 ? "amber" : "green";
}
function codeTitle(code?: string) {
  return code === "1"
    ? "Code 1 · can do anything"
    : code === "2"
      ? "Code 2 · established driver"
      : code === "3"
        ? "Code 3 · newer driver / straightforward work"
        : code === "4"
          ? "Code 4 · agency"
          : "Allocation code not set";
}
function routeMinutes(route: Record<string, unknown>) {
  const routes = route.routes as Array<{ summary?: { travelTimeInSeconds?: number } }> | undefined;
  const seconds = routes?.[0]?.summary?.travelTimeInSeconds;
  return typeof seconds === "number" && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : undefined;
}
function buildDriverText(load: DispatchLoad, dispatch: LoadDispatch, startTime?: string) {
  const lines = [
    `SLH ${load.southbound ? "Southbound " : ""}${load.reference}`,
    dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "",
    startTime ? `Planned start: ${startTime}` : "",
    dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : "",
    dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : "",
    "",
    ...dispatch.stops.flatMap(stop => [
      `${stop.sequence}. ${stop.name}`,
      stop.address ? `Address: ${stop.address}` : "",
      stop.order?.reference ? `Ref: ${stop.order.reference}` : "",
      stop.order?.marketName ? `Market: ${stop.order.marketName}${stop.order.stallNumber ? ` · Stall ${stop.order.stallNumber}` : ""}` : "",
      stop.order?.driverInstructions ? `Notes: ${stop.order.driverInstructions}` : "",
      stop.order?.mapLink ? `Map: ${stop.order.mapLink}` : "",
      ""
    ]),
    "Please reply to confirm receipt."
  ];
  return lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n").trim();
}
function buildAmendmentText(load: DispatchLoad, dispatch: LoadDispatch, startTime?: string) {
  const lines = [
    `SLH AMENDMENT · ${load.southbound ? "Southbound " : ""}${load.reference}`,
    dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "",
    startTime ? `Revised planned start: ${startTime}` : "",
    dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : "",
    dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : "",
    "",
    ...dispatch.stops.flatMap(stop => [
      `${stop.sequence}. ${stop.name}`,
      stop.address ? `Address: ${stop.address}` : "",
      stop.order?.reference ? `Ref: ${stop.order.reference}` : "",
      stop.order?.marketName ? `Market: ${stop.order.marketName}${stop.order.stallNumber ? ` · Stall ${stop.order.stallNumber}` : ""}` : "",
      stop.order?.driverInstructions ? `Notes: ${stop.order.driverInstructions}` : "",
      stop.order?.mapLink ? `Map: ${stop.order.mapLink}` : "",
      ""
    ]),
    "Please reply to confirm the amendment."
  ];
  return lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== "")).join("\n").trim();
}
function buildUpdateText(load: DispatchLoad) {
  return `SLH UPDATE · ${load.reference}\n\n`;
}
function statusClass(status?: DispatchStatus) {
  return status === "Confirmed" ? "confirmed" : status === "Sent Awaiting Response" ? "awaiting" : status === "Awaiting Dispatch" ? "ready" : "empty";
}
function knownUnavailable(driver: DispatchDriver, status?: DriverDispatchStatus) {
  return driver.onLeave || status?.availabilityStatus === "Unavailable";
}
function complianceDates(driver: DispatchDriver, vehicle?: DispatchVehicle) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + 30);
  const warnings: string[] = [];
  const errors: string[] = [];
  const check = (value: string | undefined, label: string) => {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    date.setHours(0, 0, 0, 0);
    if (date < today) errors.push(`${label} expired ${date.toLocaleDateString("en-GB")}`);
    else if (date <= threshold) warnings.push(`${label} expires ${date.toLocaleDateString("en-GB")}`);
  };
  check(driver.licenceExpiry, "Licence");
  check(driver.cpcExpiry, "CPC");
  check(driver.digitalTachoCardExpiry, "Digital tacho card");
  check(driver.medicalExpiry, "Medical");
  check(vehicle?.masterCompliance?.motExpiry, "Vehicle MOT");
  check(vehicle?.masterCompliance?.tachoCalibrationExpiry, "Tacho calibration");
  return { warnings, errors };
}

function fleetioWarning(vehicle?: Vehicle) {
  const value = vehicle?.fleetioStatus?.trim();
  if (!value) return undefined;
  return /(out\s*of\s*service|inactive|vor|off\s*road|maintenance)/i.test(value) ? `Fleetio: ${value}` : undefined;
}

function TypeaheadSelect({ value, options, placeholder, onChange, disabled, listId }: {
  value: string;
  options: SearchOption[];
  placeholder: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  listId: string;
}) {
  const selected = options.find(option => option.id === value);
  const [text, setText] = useState(selected?.label || "");
  const [open, setOpen] = useState(false);
  useEffect(() => setText(selected?.label || ""), [selected?.label, value]);
  const matches = useMemo(() => {
    const query = text.trim().toLowerCase();
    return (query ? options.filter(option => `${option.label} ${option.search || ""}`.toLowerCase().includes(query)) : options).slice(0, 18);
  }, [options, text]);
  const choose = (option: SearchOption) => {
    setText(option.label);
    onChange(option.id);
    setOpen(false);
  };
  return <div className="dispatch-typeahead">
    <input
      id={listId}
      role="combobox"
      aria-expanded={open}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      onFocus={() => setOpen(true)}
      onChange={event => {
        const next = event.target.value;
        setText(next);
        setOpen(true);
        if (!next.trim()) onChange("");
      }}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      onKeyDown={event => {
        if (event.key === "Enter" && matches[0]) {
          event.preventDefault();
          choose(matches[0]);
        }
        if (event.key === "Escape") {
          setOpen(false);
          setText(selected?.label || "");
        }
      }}
    />
    {open && !disabled && <div className="dispatch-typeahead-menu">
      {matches.length === 0
        ? <span className="dispatch-typeahead-empty">No matching option</span>
        : matches.map(option => <button
            type="button"
            key={option.id}
            className={option.id === value ? "selected" : ""}
            onMouseDown={event => event.preventDefault()}
            onClick={() => choose(option)}
          >{option.label}</button>)}
    </div>}
  </div>;
}

export function DriverDispatch() {
  const token = useAccessToken();
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [date, setDate] = useState(initialParams.get("date") || today());
  const [data, setData] = useState<Workbench>();
  const [statuses, setStatuses] = useState<Record<string, DriverDispatchStatus>>({});
  const [calculatedStarts, setCalculatedStarts] = useState<Record<string, StartSuggestion>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [statusError, setStatusError] = useState<string>();
  const [filters, setFilters] = useState<Filters>(() => emptyFilters());
  const [message, setMessage] = useState<MessageState>();
  const [showDriverTools, setShowDriverTools] = useState(false);
  const [driverToolBusy, setDriverToolBusy] = useState(false);
  const [driverToolNotice, setDriverToolNotice] = useState<string>();
  const [driverForm, setDriverForm] = useState<DriverForm>({ displayName: "", employeeNumber: "", driverType: "Agency", agencyName: "", startDate: date, days: 7 });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setStatusError(undefined);
    try {
      const access = await token();
      const [workbench, master] = await Promise.all([
        request<Workbench>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, access, undefined, 90000),
        getMasterDispatchData(access)
      ]);
      const masterDriver = (driver: DispatchDriver) => master.drivers.find(item =>
        item.driverId === driver.employeeNumber ||
        item.fullName.localeCompare(driver.displayName, undefined, { sensitivity: "base" }) === 0 ||
        (item.preferredName && item.preferredName.localeCompare(driver.displayName, undefined, { sensitivity: "base" }) === 0));
      const masterVehicle = (vehicle: Vehicle) => master.vehicles.find(item =>
        item.registration.localeCompare(vehicle.registration, undefined, { sensitivity: "base" }) === 0 ||
        item.vehicleId === vehicle.id);
      setData({
        ...workbench,
        drivers: workbench.drivers.map(driver => {
          const item = masterDriver(driver);
          return item ? {
            ...driver,
            masterDriverId: item.driverId,
            displayName: item.preferredName || item.fullName || driver.displayName,
            licenceExpiry: item.licenceExpiry,
            cpcExpiry: item.cpcExpiry,
            digitalTachoCardExpiry: item.digitalTachoCardExpiry,
            medicalExpiry: item.medicalExpiry
          } : driver;
        }),
        vehicles: workbench.vehicles.map(vehicle => ({ ...vehicle, masterCompliance: masterVehicle(vehicle) }))
      });
      try {
        const statusResponse = await request<{ planningDate: string; drivers: DriverDispatchStatus[] }>(`/api/v1/driver-dispatch-status?date=${encodeURIComponent(date)}`, access, undefined, 90000);
        setStatuses(Object.fromEntries(statusResponse.drivers.map(item => [item.driverId, item])));
      } catch (statusException) {
        setStatuses({});
        setStatusError(statusException instanceof Error ? statusException.message : "Driver message status and Tacho availability could not be loaded.");
      }
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Driver Dispatch could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [date, token]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("date", date);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [date]);
  useEffect(() => setDriverForm(current => ({ ...current, startDate: date })), [date]);
  useEffect(() => setCalculatedStarts({}), [date]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ date?: string; rows?: StartSuggestion[]; statuses?: DriverDispatchStatus[] }>).detail;
      if (!detail || detail.date !== date) return;
      if (Array.isArray(detail.rows)) setCalculatedStarts(Object.fromEntries(detail.rows.map(row => [row.loadId, row])));
      if (Array.isArray(detail.statuses)) setStatuses(Object.fromEntries(detail.statuses.map(row => [row.driverId, row])));
    };
    window.addEventListener(dispatchStartsCalculatedEvent, receive);
    return () => window.removeEventListener(dispatchStartsCalculatedEvent, receive);
  }, [date]);

  const filteredDrivers = useMemo(() => {
    if (!data) return [];
    return sortDispatchDrivers(data.drivers.filter(driver => {
      const status = statuses[driver.driverId];
      const assigned = data.loads.find(load => load.id === driver.assignedLoadId);
      const vehicle = assigned?.vehicleId ? data.vehicles.find(item => item.id === assigned.vehicleId) : undefined;
      const trailer = assigned?.trailerId ? data.trailers.find(item => item.id === assigned.trailerId) : undefined;
      const dispatchStatus = status?.dispatchStatus || (assigned ? "Awaiting Dispatch" : "No Run");
      const values: Filters = {
        driver: `${driver.displayName} ${driver.employeeNumber}`,
        typeSkills: `${driver.driverType} ${driver.driverGroup || ""} ${driver.skills || ""} ${driver.agencyName || ""}`,
        code: driver.coding || "",
        day: String(status?.projectedDayNumber || driver.dayNumber),
        previous: `${driver.previousRunReference || ""} ${driver.previousFinalStop || ""} ${driver.previousRoute || ""}`,
        vehicle: `${vehicle?.registration || ""} ${driver.previousVehicleRegistration || ""} ${driver.suggestedVehicleRegistration || ""}`,
        trailer: `${trailer?.trailerNumber || ""} ${trailer?.type || ""}`,
        run: assigned ? `${suggestionRunLabel(assigned)} ${assigned.reference} ${assigned.rawReference}` : `${driver.suggestedRunReference || ""} unallocated`,
        assistant: `${driver.suggestion || ""} ${driver.previousFinalStop || ""} ${driver.assistantScore || ""}`,
        dispatch: `${dispatchStatus} ${knownUnavailable(driver, status) ? "warning unavailable" : "available"}`
      };
      return filterKeys.every(key => !filters[key].trim() || values[key].toLowerCase().includes(filters[key].trim().toLowerCase()));
    }));
  }, [data, filters, statuses]);

  const warningDrivers = useMemo(() => {
    if (!data) return 0;
    return data.drivers.filter(driver => knownUnavailable(driver, statuses[driver.driverId])).length;
  }, [data, statuses]);

  const applySavedAllocation = useCallback((saved: DispatchLoad, driverId: string, previousLoadId?: string) => {
    setData(current => {
      if (!current) return current;
      const loads = current.loads.map(load => {
        if (previousLoadId && previousLoadId !== saved.id && load.id === previousLoadId) return { ...load, driverId: undefined, vehicleId: undefined, trailerId: undefined, status: "Draft" };
        if (load.id !== saved.id) return load;
        return { ...load, driverId, vehicleId: saved.vehicleId, trailerId: saved.trailerId, status: saved.status || "Planned" };
      });
      const drivers = current.drivers.map(item => item.driverId === driverId
        ? { ...item, assignedLoadId: saved.id, assignedRunCount: Math.max(1, item.assignedRunCount || 0) }
        : item.assignedLoadId === saved.id
          ? { ...item, assignedLoadId: undefined, assignedRunCount: Math.max(0, (item.assignedRunCount || 1) - 1) }
          : item);
      return { ...current, loads, drivers };
    });
    setStatuses(current => ({
      ...current,
      [driverId]: current[driverId]
        ? { ...current[driverId], dispatchStatus: "Awaiting Dispatch" }
        : { driverId, dispatchStatus: "Awaiting Dispatch", weeklyRestStatus: "Unknown", weeklyRestMessage: "" }
    }));
  }, []);

  const applyUnassignedAllocation = useCallback((loadId: string, driverId: string) => {
    setData(current => {
      if (!current) return current;
      return {
        ...current,
        loads: current.loads.map(load => load.id === loadId
          ? { ...load, driverId: undefined, vehicleId: undefined, trailerId: undefined, status: "Draft" }
          : load),
        drivers: current.drivers.map(item => item.driverId === driverId
          ? { ...item, assignedLoadId: undefined, assignedRunCount: Math.max(0, (item.assignedRunCount || 1) - 1) }
          : item)
      };
    });
    setStatuses(current => ({
      ...current,
      [driverId]: current[driverId]
        ? { ...current[driverId], dispatchStatus: "No Run" }
        : { driverId, dispatchStatus: "No Run", weeklyRestStatus: "Unknown", weeklyRestMessage: "" }
    }));
  }, []);

  async function syncDrivers() {
    setDriverToolBusy(true);
    setDriverToolNotice(undefined);
    try {
      await request(`/api/v1/driver-master/tachomaster/sync`, await token(), { method: "POST" }, 180000);
      setDriverToolNotice("Driver Master sync completed.");
      await refresh();
    } catch (exception) {
      setDriverToolNotice(exception instanceof Error ? exception.message : "Driver Master sync failed.");
    } finally {
      setDriverToolBusy(false);
    }
  }

  async function addDriver() {
    if (!driverForm.displayName.trim()) {
      setDriverToolNotice("Enter the driver's name.");
      return;
    }
    if (driverForm.driverType === "Agency" && !driverForm.agencyName.trim()) {
      setDriverToolNotice("Enter the agency name.");
      return;
    }
    if (driverForm.driverType !== "Agency" && !driverForm.employeeNumber.trim()) {
      setDriverToolNotice("Enter the employee number, or use Sync Drivers first.");
      return;
    }
    setDriverToolBusy(true);
    setDriverToolNotice(undefined);
    try {
      const result = await request<{ message?: string }>(`/api/v1/driver-dispatch/drivers`, await token(), {
        method: "POST",
        body: JSON.stringify({
          displayName: driverForm.displayName.trim(),
          employeeNumber: driverForm.employeeNumber.trim() || null,
          driverType: driverForm.driverType,
          agencyName: driverForm.driverType === "Agency" ? driverForm.agencyName.trim() : null,
          startDate: driverForm.startDate,
          days: driverForm.driverType === "Agency" ? driverForm.days : null
        })
      }, 90000);
      setDriverToolNotice(result.message || "Driver saved.");
      setDriverForm(current => ({ ...current, displayName: "", employeeNumber: "" }));
      await refresh();
    } catch (exception) {
      setDriverToolNotice(exception instanceof Error ? exception.message : "Driver could not be added.");
    } finally {
      setDriverToolBusy(false);
    }
  }

  return <section className="driver-dispatch-page">
    <div className="title-row dispatch-title">
      <div>
        <p className="eyebrow">Planning → allocation → route → driver text</p>
        <h1>Driver Dispatch</h1>
        <p className="hint">All active drivers stay visible. Sage HR/TachoMaster warnings identify drivers who should not be allocated; assistant suggestions keep live-linked vehicles first, then learned/yesterday vehicle continuity.</p>
      </div>
      <div className="title-actions dispatch-actions">
        <label>Planning date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
        <button type="button" onClick={() => void syncDrivers()} disabled={driverToolBusy}>{driverToolBusy ? "Syncing…" : "Sync Drivers"}</button>
        <button type="button" onClick={() => setShowDriverTools(value => !value)}>{showDriverTools ? "Close" : "Add Driver"}</button>
        <button type="button" onClick={() => void refresh()} disabled={loading}>Refresh</button>
      </div>
    </div>

    {showDriverTools && <div className="dispatch-driver-tools">
      <div><strong>Add or roster a driver</strong><p className="hint">Agency drivers can be added directly; employed/casual drivers should normally come from TachoMaster/Sage HR. Subcontractors are maintained through the subcontractor resource master.</p></div>
      <label>Driver name<input value={driverForm.displayName} onChange={event => setDriverForm(current => ({ ...current, displayName: event.target.value }))} /></label>
      <label>Type<select value={driverForm.driverType} onChange={event => setDriverForm(current => ({ ...current, driverType: event.target.value as DriverType }))}><option>Agency</option><option>Employed</option><option>Casual</option></select></label>
      {driverForm.driverType !== "Agency" && <label>Employee number<input value={driverForm.employeeNumber} onChange={event => setDriverForm(current => ({ ...current, employeeNumber: event.target.value }))} /></label>}
      {driverForm.driverType === "Agency" && <label>Agency<input value={driverForm.agencyName} onChange={event => setDriverForm(current => ({ ...current, agencyName: event.target.value }))} /></label>}
      <button className="primary" type="button" onClick={() => void addDriver()} disabled={driverToolBusy}>Save driver</button>
    </div>}

    {driverToolNotice && <p className="notice inline-notice">{driverToolNotice}</p>}
    {error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}
    {statusError && <p className="notice inline-notice" style={{ borderColor: "#b7791f" }}>{statusError}</p>}
    {loading && !data && <div className="state">Building Driver Dispatch…</div>}

    {data && <>
      <BuiltRunsQueue loads={data.loads} />
      <div className="dispatch-summary">
        <span><strong>{filteredDrivers.length}</strong> drivers shown</span>
        <span><strong>{data.loads.length}</strong> planned runs</span>
        <span><strong>{data.drivers.filter(driver => driver.suggestedRunId && !driver.assignedLoadId).length}</strong> assistant matches</span>
        <span><strong>{warningDrivers}</strong> availability warnings shown</span>
        {filterKeys.some(key => filters[key]) && <button type="button" className="text-button clear-dispatch-filters" onClick={() => setFilters(emptyFilters())}>Clear filters</button>}
      </div>
      <div className="dispatch-table-wrap">
        <table className="dispatch-table">
          <thead>
            <tr><th>Driver</th><th>Start</th><th>Type / skills</th><th>Code</th><th>Day</th><th>Vehicle</th><th>Trailer</th><th>Run</th><th>Assistant</th><th>Status</th><th>Dispatch</th></tr>
            <tr className="dispatch-filter-row">
              <th><input aria-label="Filter driver" placeholder={filterPlaceholders.driver} value={filters.driver} onChange={event => setFilters(current => ({ ...current, driver: event.target.value }))} /></th>
              <th />
              {filterKeys.filter(key => key !== "driver").map(key => <th key={key}><input aria-label={`Filter ${key}`} placeholder={filterPlaceholders[key]} value={filters[key]} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))} /></th>)}
            </tr>
          </thead>
          <tbody>{filteredDrivers.map((driver, index) => <DispatchRow
            key={driver.driverId}
            driver={driver}
            data={data}
            status={statuses[driver.driverId]}
            calculatedStart={driver.assignedLoadId ? calculatedStarts[driver.assignedLoadId] : undefined}
            showGroup={index === 0 || filteredDrivers[index - 1].driverType !== driver.driverType}
            token={token}
            applySavedAllocation={applySavedAllocation}
            applyUnassignedAllocation={applyUnassignedAllocation}
            openMessage={setMessage}
          />)}</tbody>
        </table>
      </div>
      <p className="hint dispatch-footer-note">Planned/allocated drivers stay at the top so the planner can work down through the remaining list. Active subcontractors remain visible as external resources. Warning rows stay visible for planning awareness but only proven current unavailability blocks allocation/dispatch. Final Dispatch still performs the authoritative live route-and-hours check.</p>
    </>}

    {message && <MessageDialog
      state={message}
      token={token}
      close={() => setMessage(undefined)}
      sent={async () => {
        setMessage(undefined);
        await refresh();
      }}
    />}
    <p className="hint"><Link to="/planner">Back to Planner</Link></p>
  </section>;
}

function BuiltRunsQueue({ loads }: { loads: DispatchLoad[] }) {
  const unallocated = [...loads].filter(load => !load.driverId).sort((left, right) => compactRun(left).localeCompare(compactRun(right), undefined, { numeric: true }));
  return <div data-testid="built-runs-queue" style={{ marginBottom: 14, padding: 14, border: "1px solid var(--border, #d0d5dd)", borderRadius: 10, background: "var(--surface, #fff)" }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
      <div><strong>Built runs ready to allocate</strong><div className="hint">These are the runs already built in Planning for {loads[0]?.planningDate || "this date"}. Allocate them to a driver, vehicle and trailer below.</div></div>
      <span><strong>{unallocated.length}</strong> unallocated · {loads.length} built</span>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {unallocated.length === 0
        ? <span className="hint">No unallocated built runs for this planning date.</span>
        : unallocated.map(load => {
            const first = firstCollectionStop(load);
            return <span key={load.id} title={orderedStops(load).map(stop => `${stop.sequence}. ${cleanStopName(stop.name)}`).join("\n")} style={{ display: "inline-flex", flexDirection: "column", minWidth: 150, padding: "8px 10px", border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}>
              <strong>{compactRun(load)} · {load.reference}</strong>
              <small>{runDirection(load)}{first?.name ? ` · ${cleanStopName(first.name)}` : ""}</small>
              <small>{load.palletSpacesUsed ?? "—"}{load.totalPalletSpaces ? ` / ${load.totalPalletSpaces}` : ""} {load.capacityType || "load units"}</small>
            </span>;
          })}
    </div>
  </div>;
}

function DispatchRow({ driver, data, status, calculatedStart, showGroup, token, applySavedAllocation, applyUnassignedAllocation, openMessage }: {
  driver: DispatchDriver;
  data: Workbench;
  status?: DriverDispatchStatus;
  calculatedStart?: StartSuggestion;
  showGroup: boolean;
  token: () => Promise<string>;
  applySavedAllocation: (saved: DispatchLoad, driverId: string, previousLoadId?: string) => void;
  applyUnassignedAllocation: (loadId: string, driverId: string) => void;
  openMessage: (state: MessageState) => void;
}) {
  const initial = data.loads.find(load => load.id === driver.assignedLoadId);
  const suggestedLoad = driver.suggestedRunId ? data.loads.find(load => load.id === driver.suggestedRunId) : undefined;
  const suggestedTrailerId = suggestedLoad?.trailerId;
  const [loadId, setLoadId] = useState(initial?.id || "");
  const [vehicleId, setVehicleId] = useState(initial?.vehicleId || driver.suggestedVehicleId || driver.previousVehicleId || "");
  const [trailerId, setTrailerId] = useState(initial?.trailerId || suggestedTrailerId || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const selected = data.loads.find(load => load.id === loadId);
  const tachoUnavailable = status?.availabilityStatus === "Unavailable";
  const selectedVehicle = vehicleId ? data.vehicles.find(vehicle => vehicle.id === vehicleId) : undefined;
  const fleetWarning = fleetioWarning(selectedVehicle);
  const compliance = complianceDates(driver, selectedVehicle as DispatchVehicle);
  const complianceBlocked = compliance.errors.length > 0;
  const availabilityWarning = knownUnavailable(driver, status);
  const displayDay = status?.projectedDayNumber || driver.dayNumber;
  const couldStartUtc = calculatedStart?.suggestedStartUtc || status?.earliestStartUtc || initial?.plannedStartUtc;
  const couldStartAssumption = !calculatedStart?.suggestedStartUtc && Boolean(status?.earliestStartIsAssumption);
  const couldStartTitle = [
    calculatedStart?.explanation || status?.earliestStartSource,
    calculatedStart?.restType ? `Rest: ${calculatedStart.restType}` : undefined,
    calculatedStart?.origin ? `Origin: ${calculatedStart.origin}` : undefined,
    calculatedStart?.travelMinutes != null ? `Travel to first collection: ${calculatedStart.travelMinutes} min` : undefined,
    `Projected duty day: Day ${displayDay}`,
    fleetWarning
  ].filter(Boolean).join("\n");

  const vehicleOptions: SearchOption[] = [...data.vehicles]
    .sort((left, right) => {
      const rank = (id: string) => id === driver.suggestedVehicleId ? 0 : id === driver.previousVehicleId ? 1 : 2;
      return rank(left.id) - rank(right.id) || left.registration.localeCompare(right.registration);
    })
    .map(vehicle => {
      const assistant = vehicle.id === driver.suggestedVehicleId;
      const yesterday = vehicle.id === driver.previousVehicleId;
      const evidence = assistant && yesterday ? " · Assistant · in yesterday" : assistant ? " · Assistant" : yesterday ? " · in yesterday" : "";
      const fleet = fleetioWarning(vehicle) ? ` · ⚠ ${vehicle.fleetioStatus}` : "";
      return { id: vehicle.id, label: `${vehicle.registration}${evidence}${fleet}`, search: `${vehicle.registration} ${vehicle.fleetNumber || ""} ${vehicle.fleetioStatus || ""}` };
    });

  const trailerOptions: SearchOption[] = [...data.trailers]
    .sort((left, right) => {
      const rank = (id: string) => id === suggestedTrailerId ? 0 : 1;
      return rank(left.id) - rank(right.id) || left.trailerNumber.localeCompare(right.trailerNumber);
    })
    .map(trailer => ({
      id: trailer.id,
      label: `${trailer.trailerNumber}${trailer.id === suggestedTrailerId ? " · Assistant" : trailer.type ? ` · ${trailer.type}` : ""}`,
      search: `${trailer.trailerNumber} ${trailer.type || ""}`
    }));

  const runOptions: SearchOption[] = [...data.loads]
    .filter(load => !load.driverId || load.id === driver.assignedLoadId)
    .sort((left, right) => {
      const leftFree = left.driverId ? 1 : 0;
      const rightFree = right.driverId ? 1 : 0;
      if (leftFree !== rightFree) return leftFree - rightFree;
      if (left.id === driver.suggestedRunId && !left.driverId) return -1;
      if (right.id === driver.suggestedRunId && !right.driverId) return 1;
      return compactRun(left).localeCompare(compactRun(right), undefined, { numeric: true });
    })
    .map(load => ({
      id: load.id,
      label: `${suggestionRunLabel(load)} · ${load.reference}${load.id === driver.assignedLoadId ? " · allocated to me" : " · unallocated"}`,
      search: `${load.reference} ${load.rawReference} ${load.stops.map(stop => stop.name).join(" ")}`
    }));

  useEffect(() => {
    const load = data.loads.find(item => item.id === driver.assignedLoadId);
    if (!load) return;
    setLoadId(load.id);
    setVehicleId(load.vehicleId || "");
    setTrailerId(load.trailerId || "");
  }, [data.loads, driver.assignedLoadId]);

  function useSuggestion() {
    if (driver.onLeave || tachoUnavailable) return;
    if (driver.suggestedRunId) setLoadId(driver.suggestedRunId);
    if (driver.suggestedVehicleId) setVehicleId(driver.suggestedVehicleId);
    if (suggestedTrailerId) setTrailerId(suggestedTrailerId);
    setNotice("Assistant suggestion loaded. Review it, then Allocate.");
  }

  async function save() {
    if (driver.onLeave || tachoUnavailable) {
      setNotice(status?.availabilityMessage || status?.weeklyRestMessage || "This driver is visible for planning but is not currently available for allocation.");
      return;
    }
    if (complianceBlocked) {
      setNotice(`Allocation blocked: ${compliance.errors.join("; ")}.`);
      return;
    }
    if (!loadId) {
      setNotice("Choose a run first.");
      return;
    }
    if (!vehicleId) {
      setNotice("Choose a vehicle before allocating the run.");
      return;
    }
    if (fleetWarning && !window.confirm(`${fleetWarning}. Keep this vehicle selected and continue with the allocation?`)) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const access = await token();
      const previous = data.loads.find(load => load.id === driver.assignedLoadId);
      if (previous && previous.id !== loadId) {
        await request(`/api/v1/runs/${encodeURIComponent(previous.id)}/allocation`, access, {
          method: "PUT",
          body: JSON.stringify({ driverId: null, vehicleId: null, trailerId: null })
        });
      }
      const saved = await request<DispatchLoad>(`/api/v1/runs/${encodeURIComponent(loadId)}/allocation`, access, {
        method: "PUT",
        body: JSON.stringify({ driverId: driver.driverId, vehicleId, trailerId: trailerId || null })
      });
      if (saved.driverId !== driver.driverId || saved.vehicleId !== vehicleId || (saved.trailerId || "") !== trailerId) {
        throw new Error("The allocation write returned without the selected driver, vehicle or trailer. Refresh and try again.");
      }
      applySavedAllocation(saved, driver.driverId, previous?.id);
      setNotice("Allocation saved. Run remains against this driver and is ready to dispatch.");
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : "Allocation could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function unassign() {
    const assigned = data.loads.find(load => load.id === driver.assignedLoadId);
    if (!assigned) {
      setNotice("This driver has no allocated run to remove.");
      return;
    }
    if (!window.confirm(`Unassign ${assigned.reference} from ${driver.displayName}? This will also release the vehicle and trailer.`)) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const saved = await request<DispatchLoad>(`/api/v1/runs/${encodeURIComponent(assigned.id)}/allocation`, await token(), {
        method: "PUT",
        body: JSON.stringify({ driverId: null, vehicleId: null, trailerId: null })
      });
      if (saved.driverId || saved.vehicleId || saved.trailerId) {
        throw new Error("The run was not fully unassigned. Refresh and try again.");
      }
      applyUnassignedAllocation(assigned.id, driver.driverId);
      setLoadId("");
      setVehicleId("");
      setTrailerId("");
      setNotice("Run unassigned. Driver, vehicle and trailer are free to reallocate.");
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : "Run could not be unassigned.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareDispatch() {
    if (complianceBlocked) {
      setNotice(`Dispatch blocked: ${compliance.errors.join("; ")}.`);
      return;
    }
    if (!loadId || !vehicleId) {
      setNotice("Choose a run and vehicle first.");
      return;
    }
    if (driver.onLeave) {
      setNotice("Driver is marked away in Sage HR.");
      return;
    }
    if (tachoUnavailable) {
      setNotice(status?.availabilityMessage || status?.weeklyRestMessage || "TachoMaster shows this driver as unavailable.");
      return;
    }
    if (fleetWarning) {
      setNotice(`${fleetWarning}. Resolve or change the vehicle before dispatch.`);
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const access = await token();
      await request(`/api/v1/runs/${encodeURIComponent(loadId)}/allocation`, access, {
        method: "PUT",
        body: JSON.stringify({ driverId: driver.driverId, vehicleId, trailerId: trailerId || null })
      });
      const route = await getDriverDispatchRoute(loadId, access);
      const minutes = routeMinutes(route);
      if (!minutes) throw new Error("The run could not be routed. The response did not contain a driving time.");

      let readiness = await request<DispatchReadiness>(`/api/v1/loads/${encodeURIComponent(loadId)}/dispatch-readiness`, access, {
        method: "POST",
        body: JSON.stringify({ routeDrivingMinutes: minutes, acknowledgeUnverified: false })
      }, 90000);
      let acknowledged = false;
      if (!readiness.canDispatch && readiness.structuralReadiness?.classification === "Unverified" && readiness.structuralReadiness.requiresAcknowledgement) {
        const warnings = readiness.structuralReadiness.checks.filter(check => !check.passed).map(check => `• ${check.message}`).join("\n");
        if (!window.confirm(`Pre-dispatch warnings:\n\n${warnings}\n\nAcknowledge and continue?`)) throw new Error("Dispatch cancelled; warnings were not acknowledged.");
        acknowledged = true;
        readiness = await request<DispatchReadiness>(`/api/v1/loads/${encodeURIComponent(loadId)}/dispatch-readiness`, access, {
          method: "POST",
          body: JSON.stringify({ routeDrivingMinutes: minutes, acknowledgeUnverified: true })
        }, 90000);
      }
      if (!readiness.canDispatch) throw new Error(readiness.explanation || "Dispatch readiness did not pass.");

      const dispatch = await getRunDispatch(loadId, access);
      const latest = data.loads.find(load => load.id === loadId) || selected;
      if (!latest) throw new Error("Run details could not be loaded for the text preview.");
      const plannedStart = firstCollectionStop(latest)?.plannedArrivalUtc || latest.plannedStartUtc;
      openMessage({
        load: latest,
        text: buildDriverText(latest, dispatch, localTime(plannedStart)),
        routeMinutes: minutes,
        acknowledgeUnverified: acknowledged,
        mode: "initial"
      });
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : "Dispatch could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareAmendment() {
    if (!selected) {
      setNotice("Choose the allocated run before sending an amendment.");
      return;
    }
    if (driver.onLeave) {
      setNotice("Driver is marked away in Sage HR.");
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const access = await token();
      const dispatch = await getRunDispatch(selected.id, access);
      const plannedStart = firstCollectionStop(selected)?.plannedArrivalUtc || selected.plannedStartUtc;
      openMessage({ load: selected, text: buildAmendmentText(selected, dispatch, localTime(plannedStart)), routeMinutes: 0, acknowledgeUnverified: false, mode: "amendment" });
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : "Amendment preview could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  function prepareUpdate() {
    if (!selected) {
      setNotice("Choose the allocated run before sending an update.");
      return;
    }
    openMessage({ load: selected, text: buildUpdateText(selected), routeMinutes: 0, acknowledgeUnverified: false, mode: "update" });
  }

  const persistedStatus = status?.dispatchStatus;
  const effectiveStatus: DispatchStatus = selected && persistedStatus === "No Run" ? "Awaiting Dispatch" : persistedStatus || (selected ? "Awaiting Dispatch" : "No Run");
  const unavailableAssigned = Boolean(driver.assignedLoadId && availabilityWarning);
  const groupLabel = driver.driverType === "Subcontractor" ? "SUBCONTRACTOR" : driver.driverType === "Agency" ? "AGENCY" : driver.driverType === "Casual" ? "CASUAL" : "EMPLOYED";
  const typeBadge = driver.driverType === "Subcontractor" ? "S" : driver.driverType === "Agency" ? "A" : driver.driverType === "Casual" ? "C" : "E";

  return <>
    {showGroup && <tr className="dispatch-group"><td colSpan={11}>{groupLabel}</td></tr>}
    <tr className={availabilityWarning ? "weekly-rest-blocked" : ""}>
      <td><strong>{driver.displayName}</strong><small>{driver.employeeNumber}</small>{driver.onLeave && <em>{driver.leaveType || "Sage HR leave"}</em>}{compliance.warnings.map(item => <small key={item} className="dispatch-compliance-warning">⚠ {item}</small>)}{compliance.errors.map(item => <small key={item} className="dispatch-compliance-error">⛔ {item}</small>)}</td>
      <td className="dispatch-start-cell" title={couldStartTitle || "Click Calculate Starts or refresh Tacho status."}>
        <strong>{couldStartUtc ? `${couldStartAssumption ? "~" : ""}${localTime(couldStartUtc)}` : "—"}</strong>
        {calculatedStart?.restType
          ? <small>{calculatedStart.restType}</small>
          : status?.earliestStartSource
            ? <small>{couldStartAssumption ? "Assumption" : "Tacho rest"}</small>
            : null}
        {!couldStartUtc && calculatedStart?.explanation && <small>Hover for reason</small>}
        {fleetWarning && <small>⚠ Fleetio</small>}
      </td>
      <td><div className="badge-line"><span className={`driver-type type-${driver.driverType.toLowerCase()}`} title={driver.driverGroup || driver.agencyName || driver.driverType}>{typeBadge}</span>{(driver.skills || "").split(/[,;|/]+/).map(skill => skill.trim()).filter(Boolean).slice(0, 3).map(skill => <span className="skill-badge" key={skill}>{skill}</span>)}</div><small>{driver.driverType === "Agency" ? driver.agencyName || "Agency" : driver.driverGroup || ""}</small></td>
      <td><span className={`code-badge code-${driver.coding || "x"}`} title={codeTitle(driver.coding)}>{driver.coding || "—"}</span></td>
      <td><span className={`day-bubble ${dayClass(displayDay)}`} title={`Projected Day ${displayDay}`}>{displayDay}</span></td>
      <td>
        <TypeaheadSelect disabled={driver.onLeave || tachoUnavailable} value={vehicleId} onChange={setVehicleId} options={vehicleOptions} placeholder="Vehicle…" listId={`vehicle-${driver.driverId}`} />
        {driver.previousVehicleRegistration && <small title={`Driver was in ${driver.previousVehicleRegistration} yesterday`}>In yesterday · {driver.previousVehicleRegistration}</small>}
        {fleetWarning && <small title={fleetWarning}>⚠ {fleetWarning}</small>}{compliance.warnings.filter(item => /Vehicle|Tacho calibration/.test(item)).map(item => <small key={item} className="dispatch-compliance-warning">⚠ {item}</small>)}{compliance.errors.filter(item => /Vehicle|Tacho calibration/.test(item)).map(item => <small key={item} className="dispatch-compliance-error">⛔ {item}</small>)}
      </td>
      <td><TypeaheadSelect disabled={driver.onLeave || tachoUnavailable} value={trailerId} onChange={setTrailerId} options={trailerOptions} placeholder="Trailer…" listId={`trailer-${driver.driverId}`} /></td>
      <td><div className="run-cell"><TypeaheadSelect disabled={driver.onLeave || tachoUnavailable} value={loadId} onChange={setLoadId} options={runOptions} placeholder="Run…" listId={`run-${driver.driverId}`} />{selected && <RunHover load={selected} />}</div></td>
      <td className="assistant-cell">
        <span>{driver.suggestion || (driver.previousFinalStop ? `Yesterday finished ${driver.previousFinalStop}.` : "Available for allocation.")}</span>
        {driver.assistantScore != null && driver.assistantScore > 0 && <small>Match {driver.assistantScore}</small>}
        {!driver.onLeave && !tachoUnavailable && (driver.suggestedRunId || driver.suggestedVehicleId) && <button className="assistant-use" type="button" onClick={useSuggestion}>Use suggestion{driver.suggestedRunReference ? ` · ${driver.suggestedRunReference}` : ""}</button>}
      </td>
      <td className="dispatch-status-cell">
        <span className={`dispatch-status-pill ${statusClass(effectiveStatus)}`}>{effectiveStatus}</span>
        {initial && <small title={`Allocated run ${initial.reference}`}>Allocated · {compactRun(initial)}</small>}
        {selected && persistedStatus === "No Run" && <small>Selection ready to allocate</small>}
        {status?.availabilityStatus === "Unavailable" && <small title={status.availabilityMessage}>⚠ Tacho: Unavailable</small>}
        {status?.availabilityStatus === "Unverified" && <small title={status.availabilityMessage}>{driver.driverType === "Subcontractor" ? "External compliance: Check before dispatch" : "Tacho: Check before dispatch"}</small>}
        {status?.weeklyRestStatus === "Overdue" && status?.availabilityStatus === "Unavailable" && <small title={status.weeklyRestMessage}>⚠ Weekly rest overdue</small>}
        {status?.availabilityStatus === "Available" && status.weeklyRestStatus === "DueSoon" && <small title={status.weeklyRestMessage}>Tacho: Rest due soon</small>}
        {status?.driveAvailablePlanningDayMinutes != null && <small title="TachoMaster planning-day driving availability">Drive left: {Math.max(0, Math.round(status.driveAvailablePlanningDayMinutes / 60 * 10) / 10)}h</small>}
        {status?.lastDriverReply && effectiveStatus === "Confirmed" && <small title={status.lastDriverReply}>{status.lastDriverReply.length > 72 ? `${status.lastDriverReply.slice(0, 72)}…` : status.lastDriverReply}</small>}
      </td>
      <td>
        {compliance.warnings.length > 0 && <div className="dispatch-compliance-banner warning" role="status">Compliance warning: {compliance.warnings.join(" · ")}</div>}
        {compliance.errors.length > 0 && <div className="dispatch-compliance-banner error" role="alert">Assignment blocked: {compliance.errors.join(" · ")}</div>}
        <div className="dispatch-buttons">
          {selected && (effectiveStatus === "Sent Awaiting Response" || effectiveStatus === "Confirmed")
            ? <>
                <button type="button" onClick={() => void prepareAmendment()} disabled={busy || driver.onLeave}>{busy ? "Working…" : "Amendment"}</button>
                <button type="button" onClick={prepareUpdate} disabled={busy}>Update text</button>
              </>
            : selected && driver.assignedLoadId === selected.id && effectiveStatus === "Awaiting Dispatch"
              ? <button className="primary" type="button" onClick={() => void prepareDispatch()} disabled={busy || driver.onLeave || tachoUnavailable || complianceBlocked || Boolean(fleetWarning)}>{busy ? "Preparing…" : "Dispatch"}</button>
              : null}
          {selected && <button className={driver.assignedLoadId === selected.id ? undefined : "primary"} type="button" onClick={() => void save()} disabled={busy || driver.onLeave || tachoUnavailable || complianceBlocked || !vehicleId}>{busy ? "Working…" : driver.assignedLoadId === selected.id ? "Save allocation" : "Allocate"}</button>}
          {driver.assignedLoadId && <button type="button" onClick={() => void unassign()} disabled={busy}>Unassign run</button>}
          {unavailableAssigned && <span className="dispatch-blocked-note">Allocated but unavailable · reassign this run</span>}
          {!driver.assignedLoadId && availabilityWarning && <span className="dispatch-blocked-note">Visible for planning · allocation currently blocked</span>}
        </div>
        {notice && <small className="row-notice">{notice}</small>}
      </td>
    </tr>
  </>;
}

function RunHover({ load }: { load: DispatchLoad }) {
  const first = firstCollectionStop(load);
  const direction = runDirection(load);
  return <span className="run-hover" tabIndex={0}>
    <b>{compactRun(load)}</b>
    <span className="run-popover">
      <strong>{load.southbound ? "Southbound · " : ""}{load.reference}</strong>
      <small>{direction}{first?.name ? ` · First collection: ${cleanStopName(first.name)}` : ""}</small>
      <small>{load.palletSpacesUsed ?? "—"}{load.totalPalletSpaces ? ` / ${load.totalPalletSpaces}` : ""} {load.capacityType || "load units"}</small>
      {orderedStops(load).map(stop => <span key={stop.id}>{stop.sequence}. {cleanStopName(stop.name)}{stop.plannedArrivalUtc ? ` · ${localTime(stop.plannedArrivalUtc)}` : ""}{stop.address ? ` · ${stop.address}` : ""}</span>)}
      {load.plannerNotes && <em>{load.plannerNotes}</em>}
    </span>
  </span>;
}

function MessageDialog({ state, token, close, sent }: { state: MessageState; token: () => Promise<string>; close: () => void; sent: () => Promise<void> }) {
  const [text, setText] = useState(state.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      await request(`/api/v1/loads/${encodeURIComponent(state.load.id)}/driver-message/sms`, await token(), {
        method: "POST",
        body: JSON.stringify({
          message: text,
          dispatch: state.mode === "initial",
          routeDrivingMinutes: state.mode === "initial" ? state.routeMinutes : null,
          acknowledgeUnverified: state.mode === "initial" ? state.acknowledgeUnverified : false
        })
      }, 90000);
      await sent();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Driver text could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const title = state.mode === "initial" ? "Dispatch text preview" : state.mode === "amendment" ? "Amendment text preview" : "Free-form update text";
  const hint = state.mode === "update" ? "Write any update you need to send to the driver. This is free-form and editable." : "Review the exact SMS below before sending. You can edit it.";
  const sendLabel = state.mode === "initial" ? "SEND DISPATCH" : state.mode === "amendment" ? "SEND AMENDMENT" : "SEND UPDATE";

  return <div className="dispatch-modal-backdrop" role="dialog" aria-modal="true">
    <div className="dispatch-modal">
      <div className="title-row">
        <div><p className="eyebrow">{title}</p><h2>{state.load.reference}</h2><p className="hint">{hint}</p></div>
        <button type="button" onClick={close} disabled={busy}>Close</button>
      </div>
      <textarea rows={16} value={text} onChange={event => setText(event.target.value)} autoFocus={state.mode === "update"} />
      {error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}
      <div className="dispatch-modal-actions">
        <button type="button" onClick={close} disabled={busy}>Cancel</button>
        <button className="primary" type="button" onClick={() => void send()} disabled={busy || !text.trim()}>{busy ? "Sending…" : sendLabel}</button>
      </div>
    </div>
  </div>;
}