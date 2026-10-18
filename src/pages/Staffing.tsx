import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import type { DriverAvailabilityItem, DriverAvailabilitySnapshot } from "../components/dispatch/types";
import { DriverTimesheets } from "./DriverTimesheets";
import { DriverAssignments } from "./Pages";
import { useWorkingDate, workingDateLabel } from "../lib/workingDate";
import { todayIsoDate } from "../lib/dateUtils";
import { getMasterDispatchData } from "../api/master";

type ImportRow = { driverName: string; date: string; status: string; source: string; agencyName: string };
type ImportIssue = { row: string; reason: string };
type ForecastDay = { date: string; dayRequired: number; nightRequired: number; notes?: string; opsNotes?: string; agencyRequested: number; agencyConfirmed: number; availableDrivers: number; employedAvailable: number; agencyAvailable: number; casualAvailable: number; shortfall: number; suggestedDayRequired: number; suggestedNightRequired: number; plannedRunCount: number; suggestedShortfall: number };

const groups = ["Employed available", "Agency confirmed", "Agency unconfirmed", "Casual confirmed", "Casual unconfirmed", "Unavailable/blocked"] as const;

function dateKey(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || "").trim();
  const parsed = new Date(text);
  return text && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function agencyNameFromFile(fileName: string) {
  const name = fileName.replace(/\.[^.]+$/, "").replace(/\s+-\s+Lyons\s+Bookings$/i, "").replace(/^Lyons\s+-\s+/i, "").replace(/\s+Bookings$/i, "").trim();
  return name || "Agency import";
}

function isLikelyDriverName(value: string) {
  const text = value.trim();
  if (text.length < 3 || text.split(/\s+/).length < 2) return false;
  if (/^(requirements|nights?\s+prefered|days?|driver\s+name|available\s+for)\b/i.test(text)) return false;
  return /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*)+$/u.test(text);
}

function normaliseDriverName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

const agencyStatusCodes = new Set([
  "AV", "AVAILABLE", "A", "REST", "REST DAY", "RESTDAY", "RES", "R", "R?",
  "HOL", "HOLIDAY", "LEAVE", "SICK", "OFF", "N", "N?", "D", "D?", "C", "X",
  "N/A", "NA", "UNAVAILABLE", "NOT AVAILABLE", "CANCELLED", "CANCELED",
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
]);

export function isIgnorableAgencyStatus(value: unknown) {
  const status = String(value || "").trim().toUpperCase();
  if (!status || agencyStatusCodes.has(status)) return true;
  // Some providers export the date/weekday label into the status grid. It is
  // structural workbook data, not an availability decision, so do not turn it
  // into a false import exception.
  if (/^(MON|TUE|WED|THU|FRI|SAT|SUN)\b/.test(status)) return true;
  if (/^(?:\d+\s*[ND])(?:\s+\d+\s*[ND])*$/i.test(status)) return true;
  if (/\b(?:NOT\s*REQ|CANX|CANC|CANCEL(?:LED|ED)?|NOT\s+AVAILABLE|D\s+NA|LICENCE\s+EXP|DAY\s+SHIFT\s+ONLY)\b/i.test(status)) return true;
  if (status === "?" || status.length > 40) return true;
  if (!Number.isNaN(new Date(status).getTime())) return true;
  return false;
}

function findDriverNameColumn(matrix: unknown[][], dateRow: number) {
  const headerRows = matrix.slice(Math.max(0, dateRow - 1), Math.min(matrix.length, dateRow + 5));
  const isNameLike = (value: unknown) => {
    const text = String(value || "").trim();
    return text.length >= 3 && text.split(/\s+/).length >= 2 && !agencyStatusCodes.has(text.toUpperCase()) && !dateKey(value) && /[a-z]/i.test(text);
  };
  const score = (column: number) => matrix.slice(dateRow + 1).reduce((total, row) => {
    return total + (isNameLike(row[column]) ? 1 : 0);
  }, 0);
  for (const header of headerRows) {
    const exact = header.findIndex(value => /^(driver\s*name|driver|name)$/i.test(String(value || "").trim()));
    if (exact >= 0) {
      const nearby = [exact - 2, exact - 1, exact, exact + 1, exact + 2].filter(column => column >= 0);
      const strongest = Math.max(...nearby.map(score), 0);
      if (score(exact) > 0 && score(exact) >= strongest * 0.5) return exact;
    }
  }
  const counts = new Map<number, number>();
  for (const row of matrix.slice(dateRow + 1)) row.forEach((value, column) => { if (isNameLike(value)) counts.set(column, (counts.get(column) || 0) + 1); });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
}

async function parseAgencyWorkbook(file: File): Promise<{ rows: ImportRow[]; issues: ImportIssue[] }> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });
    const dateRow = matrix.findIndex(row => row.filter(cell => Boolean(dateKey(cell))).length >= 5);
    if (dateRow < 0) continue;
    const dates = matrix[dateRow].map(dateKey);
    const resolvedNameColumn = findDriverNameColumn(matrix, dateRow);
    if (resolvedNameColumn < 0) { issues.push({ row: sheetName, reason: "Could not identify a driver-name column beside the availability dates." }); continue; }
    for (const row of matrix.slice(dateRow + 1)) {
      const driverName = String(row[resolvedNameColumn] || "").trim();
      if (!driverName) continue;
      row.forEach((value, column) => {
        const date = dates[column];
        const status = String(value || "").trim().toUpperCase();
        if (!date || !status) return;
        if (["AV", "AVAILABLE", "A"].includes(status) && isLikelyDriverName(driverName)) rows.push({ driverName, date, status, source: `${file.name} · ${sheetName}`, agencyName: agencyNameFromFile(file.name) });
        else if (isLikelyDriverName(driverName) && status && !isIgnorableAgencyStatus(status)) issues.push({ row: `${driverName} ${date}`, reason: `Unrecognised status “${status}”; not imported.` });
      });
    }
  }
  if (!rows.length && !issues.length) issues.push({ row: "Workbook", reason: "No sheet contained a row with at least five usable dates and driver availability cells." });
  return { rows, issues };
}

function dayWindow(date: string) {
  return { availableFromUtc: `${date}T00:00:00.000Z`, availableUntilUtc: `${date}T23:59:59.000Z` };
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function monday(value: string) {
  const date = new Date(`${value}T12:00:00`);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date.toISOString().slice(0, 10);
}

function calendarState(driver: DriverAvailabilityItem | undefined) {
  if (!driver) return { label: "—", className: "empty" };
  const manualStatus = driver.notes?.match(/(?:^|\b)Calendar status:\s*(AV|Leave|Not available)\b/i)?.[1]?.toLowerCase();
  if (manualStatus === "leave") return { label: "LEAVE", className: "blocked" };
  if (manualStatus === "not available") return { label: "N/A", className: "blocked" };
  if (manualStatus === "av") return { label: "AV", className: "available" };
  if (driver.dispatchable) return { label: "AV", className: "available" };
  if (driver.availabilityConfirmed) return { label: "BOOKED", className: "booked" };
  if (driver.blockReasons.some(reason => /leave|holiday/i.test(reason))) return { label: "LEAVE", className: "blocked" };
  if (driver.blockReasons.some(reason => /rest|tacho/i.test(reason))) return { label: "REST", className: "blocked" };
  return { label: driver.employmentType === "Employed" ? "PATTERN" : "—", className: "pattern" };
}

type Section = "cover" | "availability" | "files" | "timesheets" | "history";
const sections: Array<[Section, string]> = [["cover", "Cover"], ["availability", "Availability"], ["files", "Driver files"], ["timesheets", "Timesheets"], ["history", "Run history"]];

/**
 * Drivers: who we need, who we have, each driver's file, timesheets and run history.
 * Employment type remains controlled by Master Data.
 */
export function Staffing() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const section: Section = sections.some(([key]) => key === requested) ? requested as Section : "cover";
  function open(next: Section) {
    const updated = new URLSearchParams(params);
    if (next === "cover") updated.delete("tab"); else updated.set("tab", next);
    setParams(updated, { replace: true });
  }
  return <section className="ui-page staffing-page">
    <div className="ui-page-head"><div><h1>Drivers</h1><p>Who we need, who we have, and each driver's file. Employment type remains controlled by Master Data.</p></div></div>
    <div className="ui-tabs" role="tablist" aria-label="Driver sections">
      {sections.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={section === key} onClick={() => open(key)}>{label}</button>)}
    </div>
    {section === "cover" && <DriverForecast />}
    {section === "availability" && <AvailabilitySection />}
    {section === "files" && <DriverFiles />}
    {section === "timesheets" && <DriverTimesheets embedded />}
    {section === "history" && <DriverAssignments embedded />}
  </section>;
}

type CalendarFilter = "all" | "Employed" | "Agency";

function AvailabilitySection() {
  const token = useAccessToken();
  const [planningDate] = useWorkingDate();
  const [snapshot, setSnapshot] = useState<DriverAvailabilitySnapshot>();
  const [error, setError] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string>();
  const [filter, setFilter] = useState<CalendarFilter>("all");
  const [weekStart, setWeekStart] = useState(() => monday(planningDate));
  const [calendar, setCalendar] = useState<Record<string, DriverAvailabilitySnapshot>>({});
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarReload, setCalendarReload] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await request<DriverAvailabilitySnapshot>(`/api/v1/driver-availability?date=${encodeURIComponent(planningDate)}`, await token()));
      setError(undefined);
    } catch (exception) { setError(exception instanceof Error ? exception.message : "Availability could not be loaded."); }
  }, [planningDate, token]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setWeekStart(monday(planningDate)); }, [planningDate]);
  useEffect(() => {
    let cancelled = false;
    setCalendarBusy(true);
    void (async () => { const accessToken = await token(); return Promise.all(Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      return request<DriverAvailabilitySnapshot>(`/api/v1/driver-availability?date=${encodeURIComponent(date)}`, accessToken).then(value => [date, value] as const);
    })); })().then(entries => { if (!cancelled) setCalendar(Object.fromEntries(entries)); })
      .catch(() => { if (!cancelled) setCalendar({}); })
      .finally(() => { if (!cancelled) setCalendarBusy(false); });
    return () => { cancelled = true; };
  }, [weekStart, token, calendarReload]);

  const inFilter = useCallback((driver: DriverAvailabilityItem) => filter === "all" || (filter === "Employed" ? driver.employmentType === "Employed" : ["Agency", "Casual"].includes(driver.employmentType)), [filter]);
  const byGroup = useMemo(() => new Map(groups.map(group => [group, (snapshot?.drivers.filter(driver => driver.group === group && inFilter(driver)) || []).sort((left, right) => Number(right.dispatchable) - Number(left.dispatchable) || Number(right.availabilityConfirmed) - Number(left.availabilityConfirmed) || left.displayName.localeCompare(right.displayName))])), [inFilter, snapshot]);
  const matchedRows = useMemo(() => importRows.map(row => ({ ...row, driver: snapshot?.drivers.find(driver => normaliseDriverName(driver.displayName) === normaliseDriverName(row.driverName)) })), [importRows, snapshot]);
  const unmatchedRows = matchedRows.filter(row => !row.driver);
  const creatableRows = unmatchedRows.filter(row => isLikelyDriverName(row.driverName));

  async function importAvailability() {
    if (!snapshot || !importRows.length) return;
    setImportBusy(true); setImportMessage(undefined);
    let created = 0; let newDrivers = 0;
    try {
      const uniqueRows = [...new Map(importRows.map(row => [`${normaliseDriverName(row.driverName)}|${row.date}`, row])).values()];
      const createdDrivers = new Map<string, string>();
      let reviewRows = 0;
      for (const row of uniqueRows.map(item => ({ ...item, driver: snapshot.drivers.find(driver => normaliseDriverName(driver.displayName) === normaliseDriverName(item.driverName)) }))) {
        let driverId = row.driver?.driverId;
        if (!driverId && isLikelyDriverName(row.driverName)) {
          const key = `${row.driverName.trim().toLowerCase()}|${row.agencyName.trim().toLowerCase()}`;
          driverId = createdDrivers.get(key);
          if (!driverId) {
            const added = await request<{ driverId: string; created?: boolean }>("/api/v1/driver-dispatch/drivers", await token(), { method: "POST", body: JSON.stringify({ displayName: row.driverName, driverType: "Agency", agencyName: row.agencyName, startDate: row.date, days: 1 }) });
            driverId = added.driverId;
            createdDrivers.set(key, driverId);
            if (added.created) newDrivers++;
          }
        }
        if (!driverId || !["Agency", "Casual"].includes(row.driver?.employmentType || "Agency")) { reviewRows++; continue; }
        try {
          await request("/api/v1/driver-availability", await token(), { method: "POST", body: JSON.stringify({ driverId, ...dayWindow(row.date), confirmed: true, longTermPlacement: false, placementEndDate: null, usualDays: null, notes: `Imported from ${row.source}`, bookingReference: row.source }) });
          created++;
        } catch {
          reviewRows++;
        }
      }
      setImportMessage(`${created} confirmed availability day${created === 1 ? "" : "s"} imported or updated. ${newDrivers} new agency driver${newDrivers === 1 ? "" : "s"} added to Driver Master. ${reviewRows} row${reviewRows === 1 ? "" : "s"} held for review.`);
      setImportRows([]); await refresh(); setCalendarReload(value => value + 1);
    } catch (exception) { setImportMessage(exception instanceof Error ? exception.message : "The availability import could not be completed."); }
    finally { setImportBusy(false); }
  }

  const summary = snapshot?.summary;
  return <>
    {error && <p className="ui-error">{error}</p>}
    {summary && <div className="ui-grid">
      <div className="ui-metric"><span>Employed available</span><strong>{summary.employedAvailable}</strong><small>{workingDateLabel(planningDate)}</small></div>
      <div className="ui-metric"><span>Agency confirmed</span><strong>{summary.agencyConfirmed + summary.casualConfirmed}</strong><small>{summary.agencyUnconfirmed + summary.casualUnconfirmed} not confirmed</small></div>
      <div className={`ui-metric ${summary.surplusShortfall < 0 ? "red" : "green"}`}><span>Needed</span><strong>{summary.driversRequired}</strong><small>{summary.surplusShortfall < 0 ? `${Math.abs(summary.surplusShortfall)} short` : `${summary.surplusShortfall} spare`}</small></div>
      {snapshot.classificationMismatchCount > 0 && <div className="ui-metric amber"><span>Master data to check</span><strong>{snapshot.classificationMismatchCount}</strong><small>employment type differs from the source</small></div>}
    </div>}

    <section className="ui-card staffing-calendar-panel">
      <div className="ui-card-head">
        <h2>Availability calendar</h2>
        <div className="ui-page-actions">
          <div className="ui-seg" role="group" aria-label="Show drivers">
            {([["all", "All"], ["Employed", "Employed"], ["Agency", "Agency & casual"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
          </div>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Week</button>
          <strong>{workingDateLabel(weekStart)} – {workingDateLabel(addDays(weekStart, 6))}</strong>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>Week ›</button>
          <button type="button" className="primary" onClick={() => setImportOpen(value => !value)}>{importOpen ? "Close import" : "Import agency spreadsheet"}</button>
        </div>
      </div>
      <p className="hint">Employed drivers: leave comes from Sage HR and rest from Tacho; Sage HR working patterns are not read yet, so other days show as PATTERN. Agency and casual: from imported agency spreadsheets, and you can set a day by clicking it.</p>
      {importOpen && <div className="staffing-import-panel">
        <h3>Import agency availability</h3>
        <p className="hint">Upload the agency booking spreadsheets. Names are matched to Driver Master; new agency names are added as agency drivers.</p>
        <input type="file" accept=".xlsx,.xls,.xlsm,.csv" multiple onChange={async event => { const files = Array.from(event.target.files || []); const results = await Promise.all(files.map(parseAgencyWorkbook)); const parsed = results.reduce((all, result) => ({ rows: all.rows.concat(result.rows), issues: all.issues.concat(result.issues) }), { rows: [] as ImportRow[], issues: [] as ImportIssue[] }); setImportRows(parsed.rows); setImportIssues(parsed.issues); setImportMessage(undefined); }} />
        {importRows.length > 0 && <><p><strong>{importRows.length}</strong> confirmed day{importRows.length === 1 ? "" : "s"} ready · <strong>{unmatchedRows.length}</strong> names not matched to Driver Master · <strong>{creatableRows.length}</strong> will be added as agency drivers.</p><button className="primary" type="button" disabled={importBusy || (!matchedRows.some(row => row.driver) && creatableRows.length === 0)} onClick={() => void importAvailability()}>{importBusy ? "Importing…" : "Import confirmed availability"}</button></>}
        {importIssues.length > 0 && <details><summary>{importIssues.length} row{importIssues.length === 1 ? "" : "s"} not imported</summary><ul>{importIssues.slice(0, 100).map(issue => <li key={`${issue.row}-${issue.reason}`}>{issue.row}: {issue.reason}</li>)}</ul></details>}
        {importMessage && <p className="notice inline-notice">{importMessage}</p>}
      </div>}
      {calendarBusy ? <div className="ui-empty">Loading the week…</div> : <AvailabilityCalendar filter={filter} weekStart={weekStart} snapshots={calendar} onChanged={() => { void refresh(); setCalendarReload(value => value + 1); }} />}
    </section>

    {snapshot && <details className="ui-card">
      <summary><strong>Who is available on {workingDateLabel(planningDate)}</strong> · amend an agency booking window</summary>
      <div className="driver-availability-groups staffing-groups">{groups.map(group => <details key={group} open={group.includes("unconfirmed")}><summary>{group}<b>{byGroup.get(group)?.length || 0}</b></summary><div className="driver-availability-list">{byGroup.get(group)?.map(driver => <StaffingRow key={driver.driverId} driver={driver} onChanged={() => void refresh()} />)}</div></details>)}</div>
    </details>}
  </>;
}

function DriverForecast() {
  const token = useAccessToken();
  const [workingDate] = useWorkingDate();
  const [from, setFrom] = useState(() => monday(workingDate));
  const [rows, setRows] = useState<ForecastDay[]>([]);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const to = addDays(from, 6);
  useEffect(() => { setFrom(monday(workingDate)); }, [workingDate]);
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await request<ForecastDay[]>(`/api/v1/driver-forecast?from=${from}&to=${to}`, await token(), undefined, 30000)); setDirty({}); setMessage(undefined); }
    catch (exception) { setMessage(exception instanceof Error ? exception.message : "Forecast could not be loaded."); }
    finally { setBusy(false); }
  }, [from, to, token]);
  useEffect(() => { void load(); }, [load]);
  async function save(row: ForecastDay) {
    try {
      await request(`/api/v1/driver-forecast/${row.date}`, await token(), { method: "PUT", body: JSON.stringify({ dayRequired: row.dayRequired, nightRequired: row.nightRequired, agencyRequested: row.agencyRequested, agencyConfirmed: row.agencyConfirmed, notes: row.notes || null, opsNotes: row.opsNotes || null }) });
      setMessage(`${workingDateLabel(row.date)} saved.`); await load();
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Could not save."); }
  }
  function adoptSuggestion(date: string) {
    setRows(current => current.map(row => row.date === date ? { ...row, dayRequired: row.suggestedDayRequired, nightRequired: row.suggestedNightRequired } : row));
    setDirty(current => ({ ...current, [date]: true }));
  }
  function edit(date: string, field: keyof ForecastDay, value: string) {
    setRows(current => current.map(row => row.date === date ? { ...row, [field]: field === "notes" || field === "opsNotes" ? value : Math.max(0, Number(value) || 0) } : row));
    setDirty(current => ({ ...current, [date]: true }));
  }
  const weekShort = rows.reduce((sum, row) => sum + Math.max(0, row.shortfall), 0);
  return <section className="driver-forecast">
    <div className="ui-card-head">
      <div><p className="eyebrow">Management input · Operations action · Planner visibility</p><h2>Driver requirements forecast</h2></div>
      <div className="ui-page-actions">
        <button type="button" onClick={() => setFrom(addDays(from, -7))}>‹ Week</button>
        <strong>{workingDateLabel(from)} – {workingDateLabel(to)}</strong>
        <button type="button" onClick={() => setFrom(addDays(from, 7))}>Week ›</button>
        {weekShort > 0 ? <span className="ui-chip red">{weekShort} driver-days short</span> : rows.length > 0 && <span className="ui-chip green">Week covered</span>}
      </div>
    </div>
    <p className="hint">Management sets how many drivers are needed. The suggestion comes from the runs already planned.</p>
    {message && <p className="notice inline-notice">{message}</p>}
    {busy && !rows.length ? <div className="ui-empty">Working out cover against availability…</div> : <div className="forecast-cards">
      {rows.map(row => {
        const needed = row.dayRequired + row.nightRequired;
        const short = row.shortfall > 0;
        return <article key={row.date} className={`ui-card forecast-card ${short ? "short" : "ok"} ${row.date === workingDate ? "selected" : ""}`}>
          <div className="forecast-card-head"><strong>{workingDateLabel(row.date)}</strong><span className={`ui-chip ${short ? "red" : "green"}`}>{short ? `${row.shortfall} short` : row.shortfall < 0 ? `${Math.abs(row.shortfall)} spare` : "Covered"}</span></div>
          <div className="forecast-need-have"><div><span>Need</span><b>{needed}</b></div><div><span>Have</span><b>{row.availableDrivers}</b></div></div>
          <small>{row.employedAvailable} employed · {row.agencyAvailable} agency · {row.casualAvailable} casual</small>
          <div className="forecast-inputs">
            <label>Day<input aria-label={`${row.date} day drivers required`} type="number" min="0" value={row.dayRequired} onChange={event => edit(row.date, "dayRequired", event.target.value)} /></label>
            <label>Night<input aria-label={`${row.date} night drivers required`} type="number" min="0" value={row.nightRequired} onChange={event => edit(row.date, "nightRequired", event.target.value)} /></label>
            <label>Agency asked<input aria-label={`${row.date} agency target`} type="number" min="0" value={row.agencyRequested} onChange={event => edit(row.date, "agencyRequested", event.target.value)} /></label>
            <label>Agency confirmed<input aria-label={`${row.date} agency confirmed`} type="number" min="0" value={row.agencyConfirmed} onChange={event => edit(row.date, "agencyConfirmed", event.target.value)} /></label>
          </div>
          {(row.suggestedDayRequired !== row.dayRequired || row.suggestedNightRequired !== row.nightRequired) && <button type="button" className="forecast-suggestion-button" onClick={() => adoptSuggestion(row.date)}>{row.plannedRunCount} runs planned: use {row.suggestedDayRequired} day · {row.suggestedNightRequired} night</button>}
          <input aria-label={`${row.date} operations notes`} value={row.opsNotes || ""} onChange={event => edit(row.date, "opsNotes", event.target.value)} placeholder="Note, e.g. agency booking reference" />
          {dirty[row.date] && <button className="primary" type="button" onClick={() => void save(row)}>Save</button>}
        </article>;
      })}
    </div>}
  </section>;
}

type FileDriver = { driverId: string; displayName?: string; employeeNumber?: string; driverType?: string; driverGroup?: string; skills?: string; workingStyle?: string; recentRuns?: number; recentLongRuns?: number; recentFurthestMiles?: number; onLeave: boolean; leaveType?: string };
type FileStatus = { driverId: string; projectedDayNumber?: number; cycleLength?: number; cycleNote?: string; weeklyRestStatus?: string; availabilityStatus?: string; availabilityMessage?: string };

function expiryChip(label: string, value: string | undefined, today: string) {
  if (!value) return <span key={label} className="ui-chip">{label} not recorded</span>;
  const days = Math.round((Date.parse(`${value.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const tone = days < 0 ? "red" : days <= 30 ? "amber" : "green";
  const text = days < 0 ? `${label} expired` : days <= 30 ? `${label} ${days}d` : `${label} ok`;
  return <span key={label} className={`ui-chip ${tone}`} title={`${label} expires ${value.slice(0, 10)}`}>{text}</span>;
}

const styleLabel: Record<string, string> = { Tramper: "Tramper (nights out)", HalfTramper: "Half tramper", Day: "Day driver", Night: "Night driver" };

function DriverFiles() {
  const token = useAccessToken();
  const [date] = useWorkingDate();
  const today = todayIsoDate();
  const [search, setSearch] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [state, setState] = useState<{ drivers: FileDriver[]; statuses: Record<string, FileStatus>; master: Awaited<ReturnType<typeof getMasterDispatchData>> | undefined; error?: string; loading: boolean }>({ drivers: [], statuses: {}, master: undefined, loading: true });

  useEffect(() => {
    let active = true;
    setState(current => ({ ...current, loading: true }));
    void (async () => {
      const accessToken = await token();
      const [dispatch, status, master] = await Promise.allSettled([
        request<{ drivers: FileDriver[] }>(`/api/v1/driver-dispatch?date=${encodeURIComponent(date)}`, accessToken, undefined, 60000),
        request<{ drivers: FileStatus[] }>(`/api/v1/driver-dispatch-status?date=${encodeURIComponent(date)}`, accessToken, undefined, 60000),
        getMasterDispatchData(accessToken),
      ]);
      if (!active) return;
      setState({
        drivers: dispatch.status === "fulfilled" ? dispatch.value.drivers : [],
        statuses: status.status === "fulfilled" ? Object.fromEntries(status.value.drivers.map(item => [item.driverId, item])) : {},
        master: master.status === "fulfilled" ? master.value : undefined,
        error: dispatch.status === "rejected" ? "Driver list could not be loaded." : undefined,
        loading: false,
      });
    })();
    return () => { active = false; };
  }, [date, token]);

  const rows = useMemo(() => {
    const masterById = new Map((state.master?.drivers || []).map(driver => [driver.driverId, driver]));
    return state.drivers.map(driver => {
      const master = masterById.get(driver.driverId);
      const docs = [master?.licenceExpiry, master?.cpcExpiry, master?.digitalTachoCardExpiry];
      const docDays = docs.filter(Boolean).map(value => Math.round((Date.parse(`${value!.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000));
      const status = state.statuses[driver.driverId];
      const problem = docDays.some(days => days <= 30) || status?.availabilityStatus === "Unavailable" || status?.weeklyRestStatus === "Overdue";
      return { driver, master, status, problem, worstDoc: docDays.length ? Math.min(...docDays) : 9999 };
    })
      .filter(row => !problemsOnly || row.problem)
      .filter(row => !search.trim() || `${row.driver.displayName} ${row.driver.employeeNumber} ${row.driver.skills}`.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => Number(b.problem) - Number(a.problem) || a.worstDoc - b.worstDoc || (a.driver.displayName || "").localeCompare(b.driver.displayName || ""));
  }, [problemsOnly, search, state, today]);

  return <section className="ui-card">
    <div className="ui-card-head">
      <h2>Driver files</h2>
      <div className="ui-filters">
        <label>Search<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, number or skill" /></label>
        <label className="checkbox-label"><input type="checkbox" checked={problemsOnly} onChange={event => setProblemsOnly(event.target.checked)} /> Only drivers needing attention</label>
      </div>
    </div>
    <p className="hint">Block day and weekly rest come from Tacho for {workingDateLabel(date)}. Long runs are runs of 120+ miles from Barnham in the last 14 days, so the far work is shared fairly.</p>
    {state.error && <p className="ui-error">{state.error}</p>}
    {state.loading ? <div className="ui-empty">Loading driver files…</div> : rows.length === 0 ? <div className="ui-empty">No drivers match.</div> : <div className="ui-table-wrap"><table className="ui-table">
      <thead><tr><th>Driver</th><th>Works as</th><th>Block</th><th>Last 14 days</th><th>Documents</th><th>Skills</th></tr></thead>
      <tbody>{rows.map(({ driver, master, status }) => <tr key={driver.driverId}>
        <td><strong>{driver.displayName || master?.preferredName || master?.fullName || driver.employeeNumber}</strong><br /><small>{driver.employeeNumber || "No employee number"} · {driver.driverType || master?.employmentType || "Type not set"}{master?.agencyName ? ` · ${master.agencyName}` : ""}</small></td>
        <td>{driver.workingStyle ? styleLabel[driver.workingStyle] || driver.workingStyle : <span className="ui-chip">Not set</span>}</td>
        <td>{driver.onLeave ? <span className="ui-chip blue">{driver.leaveType || "Leave"}</span> : status?.projectedDayNumber ? <span className={`ui-chip ${status.availabilityStatus === "Unavailable" ? "red" : status.projectedDayNumber >= (status.cycleLength || 6) ? "amber" : "green"}`}>Day {status.projectedDayNumber} of {status.cycleLength || 6}</span> : <span className="ui-chip">No Tacho block</span>}{status?.cycleNote && <><br /><small>{status.cycleNote}</small></>}</td>
        <td>{driver.recentRuns ?? 0} runs · {driver.recentLongRuns ?? 0} long{driver.recentFurthestMiles ? <><br /><small>furthest {Math.round(driver.recentFurthestMiles)} mi</small></> : null}</td>
        <td><div className="ui-page-actions">{expiryChip("Licence", master?.licenceExpiry, today)}{expiryChip("CPC", master?.cpcExpiry, today)}{expiryChip("Tacho card", master?.digitalTachoCardExpiry, today)}</div></td>
        <td><small>{driver.skills || "—"}</small></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

function AvailabilityCalendar({ weekStart, snapshots, onChanged, filter }: { weekStart: string; snapshots: Record<string, DriverAvailabilitySnapshot>; onChanged: () => void; filter: CalendarFilter }) {
  const token = useAccessToken();
  const [openCell, setOpenCell] = useState<string>();
  const [savingCell, setSavingCell] = useState<string>();
  const drivers = useMemo(() => {
    const all = Object.values(snapshots).flatMap(snapshot => snapshot.drivers);
    return [...new Map(all.filter(driver => filter === "all" || (filter === "Employed" ? driver.employmentType === "Employed" : ["Agency", "Casual"].includes(driver.employmentType))).map(driver => [driver.driverId, driver])).values()].sort((a, b) => Number(b.dispatchable) - Number(a.dispatchable) || Number(b.availabilityConfirmed) - Number(a.availabilityConfirmed) || a.displayName.localeCompare(b.displayName));
  }, [filter, snapshots]);
  async function setStatus(driver: DriverAvailabilityItem, date: string, status: "AV" | "Leave" | "Not available") {
    if (driver.employmentType !== "Agency" && driver.employmentType !== "Casual") return;
    const key = `${driver.driverId}-${date}`;
    setSavingCell(key);
    const current = snapshots[date]?.drivers.find(item => item.driverId === driver.driverId);
    try {
      const accessToken = await token();
      const payload = { driverId: driver.driverId, ...dayWindow(date), confirmed: status === "AV", longTermPlacement: current?.longTermPlacement || false, placementEndDate: current?.placementEndDate || null, usualDays: current?.usualDays || null, notes: `Calendar status: ${status}`, bookingReference: current?.bookingReference || "STAFFING-CALENDAR" };
      await request(current?.availabilityWindowId ? `/api/v1/driver-availability/${current.availabilityWindowId}` : "/api/v1/driver-availability", accessToken, { method: current?.availabilityWindowId ? "PUT" : "POST", body: JSON.stringify(payload) });
      setOpenCell(undefined);
      onChanged();
    } finally { setSavingCell(undefined); }
  }
  return <div className="staffing-calendar-wrap"><table className="staffing-calendar"><thead><tr><th>Driver</th>{Array.from({ length: 7 }, (_, index) => { const date = addDays(weekStart, index); return <th key={date}>{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${date}T12:00:00`))}</th>; })}</tr></thead><tbody>{drivers.map(driver => <tr key={driver.driverId}><th><span>{driver.displayName}</span><small>{driver.employmentType}{driver.agencyName ? ` · ${driver.agencyName}` : ""}</small></th>{Array.from({ length: 7 }, (_, index) => { const date = addDays(weekStart, index); const state = calendarState(snapshots[date]?.drivers.find(item => item.driverId === driver.driverId)); const editable = driver.employmentType === "Agency" || driver.employmentType === "Casual"; const key = `${driver.driverId}-${date}`; const currentOpen = openCell === key; return <td className="staffing-calendar-cell" key={date}><button type="button" className={`calendar-cell ${state.className}`} disabled={!editable} title={editable ? "Choose AV, Leave or Not available" : "Sage HR / operational availability"} onClick={() => setOpenCell(currentOpen ? undefined : key)}>{state.label}</button>{currentOpen && <div className="availability-popup" role="menu" aria-label={`Set ${driver.displayName} status for ${date}`}><span>Set status</span>{(["AV", "Leave", "Not available"] as const).map(option => <button key={option} type="button" role="menuitem" disabled={savingCell === key} onClick={() => void setStatus(driver, date, option)}>{option}</button>)}</div>}</td>; })}</tr>)}</tbody></table></div>;
}

function StaffingRow({ driver, onChanged }: { driver: DriverAvailabilityItem; onChanged: () => void }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(`${new Date().toISOString().slice(0, 10)}T00:00`);
  const [until, setUntil] = useState(`${new Date().toISOString().slice(0, 10)}T23:59`);
  const [confirmed, setConfirmed] = useState(driver.availabilityConfirmed);
  const [notes, setNotes] = useState(driver.notes || "");
  async function save() {
    await request(driver.availabilityWindowId ? `/api/v1/driver-availability/${driver.availabilityWindowId}` : "/api/v1/driver-availability", await token(), { method: driver.availabilityWindowId ? "PUT" : "POST", body: JSON.stringify({ driverId: driver.driverId, availableFromUtc: new Date(from).toISOString(), availableUntilUtc: new Date(until).toISOString(), confirmed, longTermPlacement: false, placementEndDate: null, usualDays: null, notes: notes || null, bookingReference: null }) });
    setOpen(false); onChanged();
  }
  return <article><div><strong>{driver.displayName}</strong><small>{driver.employeeNumber || "No employee number"} · {driver.employmentType}{driver.agencyName ? ` · ${driver.agencyName}` : ""}</small></div><div><span>{driver.availableFromUtc && driver.availableUntilUtc ? `${new Date(driver.availableFromUtc).toLocaleString("en-GB")} → ${new Date(driver.availableUntilUtc).toLocaleString("en-GB")}` : "No confirmed window"}</span><small>{driver.skills || "Skills not recorded"}{driver.placementEndDate ? ` · placement ends ${driver.placementEndDate}` : ""}</small></div><div><span>{driver.blockReasons.join(" · ") || "Available"}</span><small>{driver.currentAllocationReference ? `Allocated · ${driver.currentAllocationReference}` : "Not allocated"}</small></div>{(driver.employmentType === "Agency" || driver.employmentType === "Casual") && <button type="button" onClick={() => setOpen(value => !value)}>{open ? "Close" : "Amend availability"}</button>}{open && <div className="staffing-inline-editor"><label>From<input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Until<input type="datetime-local" value={until} onChange={event => setUntil(event.target.value)} /></label><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Confirmed</label><label>Notes<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label><button className="primary" type="button" onClick={() => void save()}>Save</button></div>}</article>;
}
