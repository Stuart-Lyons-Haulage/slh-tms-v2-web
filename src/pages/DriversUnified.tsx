import { useCallback, useMemo, useState } from "react";
import { api, request, type Driver } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { driverColumnKeys, emptyDriverColumnFilters, filterDrivers, type DriverColumnKey } from "./driverColumnFilters";

function value(input: unknown) {
  return input == null || input === "" ? "—" : String(input);
}

function minutes(input?: number | null) {
  if (input == null) return "—";
  return `${Math.floor(input / 60)}h ${String(Math.abs(input % 60)).padStart(2, "0")}m`;
}

function dateTime(input?: string | null) {
  if (!input) return "—";
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : parsed.toLocaleString("en-GB");
}

type TachoRefreshResult = {
  provider: string;
  success: boolean;
  completedAtUtc: string;
  changed: number;
  message: string;
};

type TachoProfile = {
  memberCode: number;
  driverName: string;
  cardNumber?: string;
  employeeNumber?: string;
  metricsValidAtUtc?: string;
  dailyDriverPeriodsAvailable?: number;
  driveAvailableTodayMinutes?: number;
  driveAvailableTomorrowMinutes?: number;
  driveAvailableWeekMinutes?: number;
  driveAvailableFortnightMinutes?: number;
  longDaysWorkedThisWeek?: number;
  shortDailyRestTakenThisWeek?: number;
  workAvailableWeekMinutes?: number;
};

type TachoDuty = {
  vehicleCode: string;
  memberCode: number;
  driverName: string;
  cardNumber?: string;
  employeeNumber?: string;
  dutyStartUtc: string;
  dutyEndUtc?: string;
  workMinutes: number;
  restMinutes: number;
  availableMinutes: number;
  driveMinutes: number;
  breakCount: number;
  breakMinutes?: number;
  metricsValidAtUtc?: string;
  dailyDriverPeriodsAvailable?: number;
  driveAvailableTodayMinutes?: number;
  driveAvailableTomorrowMinutes?: number;
  driveAvailableWeekMinutes?: number;
  driveAvailableFortnightMinutes?: number;
  longDaysWorkedThisWeek?: number;
  shortDailyRestTakenThisWeek?: number;
  workAvailableWeekMinutes?: number;
};

type TachoHistory = {
  configured: boolean;
  connected?: boolean;
  checkedAtUtc?: string;
  driverId: string;
  driverName: string;
  employeeNumber: string;
  linkedTachoMemberId?: string;
  linkedTachoCard?: string;
  from: string;
  to: string;
  profile?: TachoProfile;
  live?: {
    status: "Live" | "Delayed" | "Stale" | "Unknown";
    sourceTimestampUtc?: string;
    sourceAgeMinutes?: number;
    stale: boolean;
    delayed: boolean;
    hasCurrentDuty: boolean;
    currentDuty?: TachoDuty;
    explanation: string;
  };
  summary: {
    dutyCount: number;
    daysWithDuty: number;
    driveMinutes: number;
    workMinutes: number;
    availableMinutes: number;
    restMinutes: number;
    breakCount: number;
    breakMinutes: number;
  };
  duties: TachoDuty[];
};

export function DriversUnified() {
  const token = useAccessToken();
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const [filter, setFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState(emptyDriverColumnFilters);
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<Driver>();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<TachoHistory>();
  const [historyError, setHistoryError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [bulkDeletePassword, setBulkDeletePassword] = useState("");
  const [bulkDeleteIds, setBulkDeleteIds] = useState<Set<string>>(() => new Set());

  const visible = useMemo(() => {
    return filterDrivers(drivers.data || [], filter, columnFilters);
  }, [columnFilters, drivers.data, filter]);

  function setColumnFilter(key: DriverColumnKey, next: string) {
    setColumnFilters((current) => ({ ...current, [key]: next }));
  }

  function startEdit(driver: Driver) {
    setEditingId(driver.id);
    setDraft({ ...driver });
    setMessage(undefined);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const { id, lastTachoSyncUtc: _lastSync, agencyName: _agency, ...payload } = draft;
      void _lastSync;
      void _agency;
      await api.updateDriver(id, payload, await token());
      setEditingId(undefined);
      setDraft(undefined);
      setMessage(`${draft.displayName} updated.`);
      await drivers.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Driver update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function syncTacho() {
    setSyncing(true);
    setMessage(undefined);
    try {
      const result = await request<TachoRefreshResult>(
        "/api/v1/system-sync/force/tacho",
        await token(),
        { method: "POST" },
        60000,
      );
      setMessage(result.message);
      await drivers.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TachoMaster sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  function startBulkDelete() {
    const password = window.prompt("Admin delete password");
    if (!password) return;
    setBulkDeletePassword(password);
    setBulkDeleteMode(true);
    setBulkDeleteIds(new Set());
    setMessage(undefined);
  }

  function toggleBulkDeleteRow(id: string, checked: boolean) {
    setBulkDeleteIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function toggleBulkDeleteAll(checked: boolean) {
    setBulkDeleteIds(checked ? new Set(visible.map((driver) => driver.id)) : new Set());
  }

  async function bulkDeleteSelected() {
    const ids = [...bulkDeleteIds];
    if (!ids.length) { setMessage("Tick at least one driver to delete."); return; }
    if (!window.confirm(`Permanently delete ${ids.length} selected driver${ids.length === 1 ? "" : "s"}?\n\nDrivers linked to live TMS history will be blocked and kept.`)) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await request<{ deleted: number; blocked: number; notFound: number; message?: string }>(
        "/api/v1/master-data-cleanup/drivers/bulk-delete",
        await token(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, adminPassword: bulkDeletePassword }),
        },
      );
      setMessage(result.message || `${result.deleted} deleted. ${result.blocked} blocked. ${result.notFound} already removed.`);
      setBulkDeleteIds(new Set());
      await drivers.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bulk delete failed.");
    } finally {
      setSaving(false);
    }
  }

  async function loadHistory(driver: Driver) {
    setHistoryLoading(true);
    setHistoryError(undefined);
    setHistory(undefined);
    try {
      const result = await request<TachoHistory>(
        `/api/v1/tachomaster/drivers/${driver.id}/history`,
        await token(),
        undefined,
        60000,
      );
      setHistory(result);
      window.setTimeout(() => document.getElementById("tacho-history")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "TachoMaster history could not be loaded.");
    } finally {
      setHistoryLoading(false);
    }
  }

  const edit = <K extends keyof Driver>(key: K, next: Driver[K]) => setDraft((current) => current ? { ...current, [key]: next } : current);

  return (
    <section className="drivers-unified-page">
      <div className="title-row">
        <div>
          <p className="eyebrow">Master data + live TachoMaster</p>
          <h1>Drivers</h1>
          <p className="hint">One driver, one row. History now overlays the live TachoMaster duty for today and keeps completed duty history separately.</p>
        </div>
        <div className="title-actions">
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search driver…" />
          {bulkDeleteMode
            ? <><button disabled={saving || bulkDeleteIds.size === 0} onClick={() => void bulkDeleteSelected()} style={{ borderColor: "#b42318", color: "#b42318", fontWeight: 800 }}>Delete selected ({bulkDeleteIds.size})</button><button disabled={saving} onClick={() => { setBulkDeleteMode(false); setBulkDeletePassword(""); setBulkDeleteIds(new Set()); }}>Exit delete</button></>
            : <button disabled={saving} onClick={startBulkDelete}>Mass delete</button>}
          <button onClick={() => void drivers.refresh()} disabled={drivers.loading}>Refresh</button>
          <button className="primary" onClick={() => void syncTacho()} disabled={syncing}>{syncing ? "Syncing…" : "Sync TachoMaster"}</button>
        </div>
      </div>
      {message && <p className="notice inline-notice">{message}</p>}
      {historyError && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{historyError}</p>}
      {drivers.error ? <div className="state error"><p>{drivers.error}</p></div> : (
        <div className="master-table-wrap" style={{ overflowX: "auto" }}>
          <table className="master-table driver-unified-table" style={{ minWidth: bulkDeleteMode ? 2420 : 2360 }}>
            <thead>
              <tr>
                {bulkDeleteMode && <th><input type="checkbox" aria-label="Select all visible drivers" checked={visible.length > 0 && visible.every((driver) => bulkDeleteIds.has(driver.id))} onChange={(event) => toggleBulkDeleteAll(event.target.checked)} /></th>}
                <th>Employee</th><th>Driver</th><th>Mobile</th><th>Type</th><th>Group</th><th>Skills</th><th>Coding</th>
                <th>North</th><th>Preload</th><th>Tacho name</th><th>Tacho card</th><th>Tacho member</th>
                <th>Drive left today</th><th>Drive left week</th><th>Work left week</th><th>Last Tacho sync</th>
                <th>Licence no.</th><th>Licence expiry</th><th>Licence status</th><th>Notes</th><th>Active</th><th>Actions</th>
              </tr>
              <tr className="driver-column-filters">
                {bulkDeleteMode && <th />}
                {driverColumnKeys.map((key) => (
                  <th key={key}>
                    <input
                      aria-label={`Filter ${key}`}
                      value={columnFilters[key]}
                      onChange={(event) => setColumnFilter(key, event.target.value)}
                      placeholder="Filter…"
                    />
                  </th>
                ))}
                <th><button type="button" onClick={() => setColumnFilters(emptyDriverColumnFilters())}>Clear</button></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((driver) => {
                const isEditing = editingId === driver.id && draft;
                const row = isEditing ? draft : driver;
                return (
                  <tr key={driver.id}>
                    {bulkDeleteMode && <td><input type="checkbox" aria-label={`Select ${driver.displayName}`} checked={bulkDeleteIds.has(driver.id)} onChange={(event) => toggleBulkDeleteRow(driver.id, event.target.checked)} /></td>}
                    <td>{isEditing ? <input value={row.employeeNumber} onChange={(e) => edit("employeeNumber", e.target.value)} /> : value(row.employeeNumber)}</td>
                    <td>{isEditing ? <input value={row.displayName} onChange={(e) => edit("displayName", e.target.value)} /> : <strong>{value(row.displayName)}</strong>}</td>
                    <td>{isEditing ? <input value={row.mobileNumber || ""} onChange={(e) => edit("mobileNumber", e.target.value)} /> : value(row.mobileNumber)}</td>
                    <td>{isEditing ? <input value={row.driverType || ""} onChange={(e) => edit("driverType", e.target.value)} /> : value(row.driverType)}</td>
                    <td>{isEditing ? <input value={row.driverGroup || ""} onChange={(e) => edit("driverGroup", e.target.value)} /> : value(row.driverGroup)}</td>
                    <td>{isEditing ? <input value={row.skills || ""} onChange={(e) => edit("skills", e.target.value)} /> : value(row.skills)}</td>
                    <td>{isEditing ? <input value={row.coding || ""} onChange={(e) => edit("coding", e.target.value)} /> : value(row.coding)}</td>
                    <td>{isEditing ? <input type="checkbox" checked={Boolean(row.northEligible)} onChange={(e) => edit("northEligible", e.target.checked)} /> : row.northEligible ? "Yes" : "No"}</td>
                    <td>{isEditing ? <input type="checkbox" checked={Boolean(row.preloadEligible)} onChange={(e) => edit("preloadEligible", e.target.checked)} /> : row.preloadEligible ? "Yes" : "No"}</td>
                    <td>{isEditing ? <input value={row.tachoName || ""} onChange={(e) => edit("tachoName", e.target.value)} /> : value(row.tachoName)}</td>
                    <td>{value(row.tachoCardNumber)}</td>
                    <td>{value(row.tachoMasterDriverId)}</td>
                    <td>{minutes(row.tachoDriveAvailableTodayMinutes)}</td>
                    <td>{minutes(row.tachoDriveAvailableWeekMinutes)}</td>
                    <td>{minutes(row.tachoWorkAvailableWeekMinutes)}</td>
                    <td>{dateTime(row.lastTachoSyncUtc)}</td>
                    <td>{isEditing ? <input value={row.drivingLicenceNumber || ""} onChange={(e) => edit("drivingLicenceNumber", e.target.value)} /> : value(row.drivingLicenceNumber)}</td>
                    <td>{isEditing ? <input type="date" value={row.licenceExpiry || ""} onChange={(e) => edit("licenceExpiry", e.target.value)} /> : value(row.licenceExpiry)}</td>
                    <td>{isEditing ? <input value={row.licenceStatus || ""} onChange={(e) => edit("licenceStatus", e.target.value)} /> : value(row.licenceStatus)}</td>
                    <td>{isEditing ? <input value={row.notes || ""} onChange={(e) => edit("notes", e.target.value)} /> : value(row.notes)}</td>
                    <td>{isEditing ? <input type="checkbox" checked={row.active} onChange={(e) => edit("active", e.target.checked)} /> : row.active ? "Yes" : "No"}</td>
                    <td>
                      {isEditing ? <div className="actions"><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button><button onClick={() => { setEditingId(undefined); setDraft(undefined); }}>Cancel</button></div> : <div className="actions"><button disabled={bulkDeleteMode} onClick={() => startEdit(driver)}>Edit</button><button onClick={() => void loadHistory(driver)} disabled={historyLoading || bulkDeleteMode}>{historyLoading ? "Loading…" : "Live / History"}</button></div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">{visible.length} driver{visible.length === 1 ? "" : "s"} shown. Agency has been removed from the operational driver register.</p>

      {history && <div id="tacho-history" className="panel" style={{ marginTop: 20 }}>
        <div className="title-row">
          <div>
            <p className="eyebrow">TachoMaster live duty + history</p>
            <h2>{history.driverName}</h2>
            <p className="hint">{history.from} to {history.to} · Member {value(history.linkedTachoMemberId)} · Card {value(history.linkedTachoCard)}</p>
          </div>
          <button onClick={() => setHistory(undefined)}>Close</button>
        </div>

        {history.live && <div className="panel" style={{ marginBottom: 16, borderColor: history.live.stale ? "#b42318" : history.live.delayed ? "#b7791f" : "#2f855a" }}>
          <div className="title-row" style={{ alignItems: "flex-start" }}>
            <div>
              <p className="eyebrow">Current TachoMaster feed</p>
              <h3 style={{ marginTop: 0 }}>{history.live.status}</h3>
              <p className="hint">{history.live.explanation}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <strong>{history.live.sourceAgeMinutes == null ? "Age unknown" : `${history.live.sourceAgeMinutes.toFixed(0)} min old`}</strong><br/>
              <small>Source {dateTime(history.live.sourceTimestampUtc)}</small>
            </div>
          </div>
          {history.live.currentDuty ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
            <div><small>Vehicle</small><br/><strong>{value(history.live.currentDuty.vehicleCode)}</strong></div>
            <div><small>Duty started</small><br/><strong>{dateTime(history.live.currentDuty.dutyStartUtc)}</strong></div>
            <div><small>Duty end</small><br/><strong>{history.live.currentDuty.dutyEndUtc ? dateTime(history.live.currentDuty.dutyEndUtc) : "Open duty"}</strong></div>
            <div><small>Driving</small><br/><strong>{minutes(history.live.currentDuty.driveMinutes)}</strong></div>
            <div><small>Other work</small><br/><strong>{minutes(history.live.currentDuty.workMinutes)}</strong></div>
            <div><small>Rest</small><br/><strong>{minutes(history.live.currentDuty.restMinutes)}</strong></div>
            <div><small>Drive left today</small><br/><strong>{minutes(history.live.currentDuty.driveAvailableTodayMinutes ?? history.profile?.driveAvailableTodayMinutes)}</strong></div>
            <div><small>Drive left week</small><br/><strong>{minutes(history.live.currentDuty.driveAvailableWeekMinutes ?? history.profile?.driveAvailableWeekMinutes)}</strong></div>
            <div><small>Work left week</small><br/><strong>{minutes(history.live.currentDuty.workAvailableWeekMinutes ?? history.profile?.workAvailableWeekMinutes)}</strong></div>
          </div> : <div className="state">No current open TachoMaster duty was returned for this driver. Completed duty history is still shown below.</div>}
        </div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 16 }}>
          <div className="notice"><strong>{history.summary.dutyCount}</strong><br/><small>Completed/history duty records</small></div>
          <div className="notice"><strong>{history.summary.daysWithDuty}</strong><br/><small>Days with duty</small></div>
          <div className="notice"><strong>{minutes(history.summary.driveMinutes)}</strong><br/><small>Driving</small></div>
          <div className="notice"><strong>{minutes(history.summary.workMinutes)}</strong><br/><small>Other work</small></div>
          <div className="notice"><strong>{minutes(history.summary.availableMinutes)}</strong><br/><small>Availability</small></div>
          <div className="notice"><strong>{minutes(history.summary.restMinutes)}</strong><br/><small>Rest</small></div>
        </div>

        {history.profile && <div className="panel" style={{ marginBottom: 16 }}>
          <h3>Current TachoMaster limits</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            <div><small>Drive left today</small><br/><strong>{minutes(history.profile.driveAvailableTodayMinutes)}</strong></div>
            <div><small>Drive left tomorrow</small><br/><strong>{minutes(history.profile.driveAvailableTomorrowMinutes)}</strong></div>
            <div><small>Drive left week</small><br/><strong>{minutes(history.profile.driveAvailableWeekMinutes)}</strong></div>
            <div><small>Drive left fortnight</small><br/><strong>{minutes(history.profile.driveAvailableFortnightMinutes)}</strong></div>
            <div><small>Work left week</small><br/><strong>{minutes(history.profile.workAvailableWeekMinutes)}</strong></div>
            <div><small>Daily periods available</small><br/><strong>{value(history.profile.dailyDriverPeriodsAvailable)}</strong></div>
            <div><small>Long days this week</small><br/><strong>{value(history.profile.longDaysWorkedThisWeek)}</strong></div>
            <div><small>Short rests this week</small><br/><strong>{value(history.profile.shortDailyRestTakenThisWeek)}</strong></div>
            <div><small>Metrics valid</small><br/><strong>{dateTime(history.profile.metricsValidAtUtc)}</strong></div>
          </div>
        </div>}

        <div className="master-table-wrap" style={{ overflowX: "auto" }}>
          <table className="master-table" style={{ minWidth: 1200 }}>
            <thead><tr><th>Duty start</th><th>Duty end</th><th>Vehicle</th><th>Drive</th><th>Work</th><th>Available</th><th>Rest</th><th>WTD breaks</th><th>Break time</th><th>Member</th></tr></thead>
            <tbody>{history.duties.map((duty, index) => <tr key={`${duty.dutyStartUtc}-${duty.vehicleCode}-${index}`}>
              <td>{dateTime(duty.dutyStartUtc)}</td><td>{dateTime(duty.dutyEndUtc)}</td><td>{value(duty.vehicleCode)}</td>
              <td>{minutes(duty.driveMinutes)}</td><td>{minutes(duty.workMinutes)}</td><td>{minutes(duty.availableMinutes)}</td><td>{minutes(duty.restMinutes)}</td>
              <td>{duty.breakCount}</td><td>{minutes(duty.breakMinutes)}</td><td>{duty.memberCode}</td>
            </tr>)}</tbody>
          </table>
          {history.duties.length === 0 && <div className="state">No completed TachoMaster duty records were returned for this linked driver in the selected period.</div>}
        </div>
      </div>}
    </section>
  );
}
