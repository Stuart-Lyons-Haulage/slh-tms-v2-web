import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import type { DriverAvailabilityItem, DriverAvailabilitySnapshot } from "../components/dispatch/types";
import { DriverTimesheets } from "./DriverTimesheets";
import { DriverAssignments } from "./Pages";

type ImportRow = { driverName: string; date: string; status: string; source: string };
type ImportIssue = { row: string; reason: string };

const groups = ["Employed available", "Agency confirmed", "Agency unconfirmed", "Casual confirmed", "Casual unconfirmed", "Unavailable/blocked"] as const;

function dateKey(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value || "").trim();
  const parsed = new Date(text);
  return text && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
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
    const headerRow = matrix[Math.max(0, dateRow - 1)] || [];
    const nameColumn = headerRow.findIndex(value => /driver\s*name|driver|name/i.test(String(value)));
    const resolvedNameColumn = nameColumn >= 0 ? nameColumn : 3;
    for (const row of matrix.slice(dateRow + 1)) {
      const driverName = String(row[resolvedNameColumn] || "").trim();
      if (!driverName) continue;
      row.forEach((value, column) => {
        const date = dates[column];
        const status = String(value || "").trim().toUpperCase();
        if (!date || !status) return;
        if (["AV", "AVAILABLE", "A"].includes(status)) rows.push({ driverName, date, status, source: `${file.name} · ${sheetName}` });
        else if (!["REST", "HOL", "HOLIDAY", "OFF", "N", "D", "D?", "C", ""].includes(status)) issues.push({ row: `${driverName} ${date}`, reason: `Unrecognised status “${status}”; not imported.` });
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

export function Staffing() {
  const token = useAccessToken();
  const [planningDate, setPlanningDate] = useState(new Date().toISOString().slice(0, 10));
  const [snapshot, setSnapshot] = useState<DriverAvailabilitySnapshot>();
  const [error, setError] = useState<string>();
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string>();
  const [section, setSection] = useState<"timesheets" | "availability" | "history">("timesheets");
  const [availabilityTab, setAvailabilityTab] = useState<"staff" | "agency">("staff");
  const [weekStart, setWeekStart] = useState(() => monday(planningDate));
  const [calendar, setCalendar] = useState<Record<string, DriverAvailabilitySnapshot>>({});
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarReload, setCalendarReload] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await request<DriverAvailabilitySnapshot>(`/api/v1/driver-availability?date=${encodeURIComponent(planningDate)}`, await token()));
      setError(undefined);
    } catch (exception) { setError(exception instanceof Error ? exception.message : "Staffing could not be loaded."); }
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

  const byGroup = useMemo(() => new Map(groups.map(group => [group, snapshot?.drivers.filter(driver => driver.group === group && (availabilityTab === "staff" ? driver.employmentType === "Employed" : ["Agency", "Casual"].includes(driver.employmentType))) || []])), [availabilityTab, snapshot]);
  const matchedRows = useMemo(() => importRows.map(row => ({ ...row, driver: snapshot?.drivers.find(driver => driver.displayName.trim().toLowerCase() === row.driverName.trim().toLowerCase()) })), [importRows, snapshot]);
  const unmatchedRows = matchedRows.filter(row => !row.driver);

  async function importAvailability() {
    if (!snapshot || !importRows.length) return;
    setImportBusy(true); setImportMessage(undefined);
    let created = 0; let skipped = 0;
    try {
      const uniqueRows = [...new Map(importRows.map(row => [`${row.driverName.toLowerCase()}|${row.date}|${row.source}`, row])).values()];
      for (const row of uniqueRows.map(item => ({ ...item, driver: snapshot.drivers.find(driver => driver.displayName.trim().toLowerCase() === item.driverName.trim().toLowerCase()) }))) {
        if (!row.driver || !["Agency", "Casual"].includes(row.driver.employmentType)) { skipped++; continue; }
        await request("/api/v1/driver-availability", await token(), { method: "POST", body: JSON.stringify({ driverId: row.driver.driverId, ...dayWindow(row.date), confirmed: true, longTermPlacement: false, placementEndDate: null, usualDays: null, notes: `Imported from ${row.source}`, bookingReference: row.source }) });
        created++;
      }
      setImportMessage(`${created} confirmed availability day${created === 1 ? "" : "s"} imported. ${unmatchedRows.length + skipped} row${unmatchedRows.length + skipped === 1 ? "" : "s"} held for review.`);
      setImportRows([]); await refresh();
    } catch (exception) { setImportMessage(exception instanceof Error ? exception.message : "The availability import could not be completed."); }
    finally { setImportBusy(false); }
  }

  return <section className="staffing-page">
    <div className="page-heading"><div><p className="eyebrow">Workforce control</p><h1>Staffing</h1><p>Timesheets, availability and driver history in one operational workspace. Employment type remains controlled by Master Data. Agency availability imports are matched against Driver Master and then feed the availability used by timesheet and dispatch views.</p></div></div>
    <div className="staffing-section-tabs" role="tablist" aria-label="Staffing sections">
      <button className={section === "timesheets" ? "active" : ""} onClick={() => setSection("timesheets")}>Timesheets</button>
      <button className={section === "availability" ? "active" : ""} onClick={() => setSection("availability")}>Availability</button>
      <button className={section === "history" ? "active" : ""} onClick={() => setSection("history")}>Driver History</button>
    </div>
    {section === "timesheets" && <DriverTimesheets embedded />}
    {section === "history" && <DriverAssignments embedded />}
    {section === "availability" && <>
    <div className="staffing-availability-tabs" role="tablist" aria-label="Availability workforce tabs"><button className={availabilityTab === "staff" ? "active" : ""} onClick={() => setAvailabilityTab("staff")}>Staff</button><button className={availabilityTab === "agency" ? "active" : ""} onClick={() => setAvailabilityTab("agency")}>Agency</button></div>
    {availabilityTab === "agency" && <div className="panel staffing-import-panel"><div className="title-row"><div><h2>Import agency availability</h2><p className="hint">Upload agency spreadsheets here. Matched rows feed the Agency availability calendar; manual calendar adjustments remain available after import.</p></div><label>Planning date<input type="date" value={planningDate} onChange={event => setPlanningDate(event.target.value)} /></label></div>
      <input type="file" accept=".xlsx,.xls,.xlsm,.csv" multiple onChange={async event => { const files = Array.from(event.target.files || []); const results = await Promise.all(files.map(parseAgencyWorkbook)); const parsed = results.reduce((all, result) => ({ rows: all.rows.concat(result.rows), issues: all.issues.concat(result.issues) }), { rows: [] as ImportRow[], issues: [] as ImportIssue[] }); setImportRows(parsed.rows); setImportIssues(parsed.issues); setImportMessage(undefined); }} />
      {importRows.length > 0 && <><p><strong>{importRows.length}</strong> confirmed day{importRows.length === 1 ? "" : "s"} ready · <strong>{unmatchedRows.length}</strong> names not matched to Driver Master.</p><button className="primary" type="button" disabled={importBusy || !matchedRows.some(row => row.driver)} onClick={() => void importAvailability()}>{importBusy ? "Importing…" : "Import confirmed availability"}</button></>}
      {importIssues.length > 0 && <details><summary>{importIssues.length} import issue{importIssues.length === 1 ? "" : "s"}</summary><ul>{importIssues.slice(0, 100).map(issue => <li key={`${issue.row}-${issue.reason}`}>{issue.row}: {issue.reason}</li>)}</ul></details>}
      {importMessage && <p className="notice inline-notice">{importMessage}</p>}
    </div>}
    {error && <p className="notice inline-notice">{error}</p>}
    {snapshot && <><div className="driver-availability-summary staffing-summary">{[`${snapshot.summary.employedAvailable} employed available`, `${snapshot.summary.agencyConfirmed} agency confirmed`, `${snapshot.summary.casualConfirmed} casual confirmed`, `${snapshot.summary.driversRequired} drivers required`, `${snapshot.summary.surplusShortfall < 0 ? Math.abs(snapshot.summary.surplusShortfall) + " shortfall" : snapshot.summary.surplusShortfall + " surplus"}`, `${snapshot.classificationMismatchCount} Master Data review`].map(item => <span key={item}>{item}</span>)}</div>
       <div className="panel staffing-calendar-panel"><div className="title-row"><div><h2>{availabilityTab === "staff" ? "Staff availability" : "Agency availability"} · Availability calendar</h2><p className="hint">{availabilityTab === "staff" ? "Sage HR working patterns are the source for employed staff leave and availability. This view is read-only in Staffing." : "Agency availability comes from imported spreadsheets and controlled manual calendar adjustments."}</p></div><div className="calendar-controls"><button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Previous</button><strong>{weekStart} – {addDays(weekStart, 6)}</strong><button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next →</button></div></div>{calendarBusy ? <p className="hint">Loading seven-day availability…</p> : <AvailabilityCalendar employmentType={availabilityTab === "staff" ? "Employed" : "Agency"} weekStart={weekStart} snapshots={calendar} onChanged={() => { void refresh(); setCalendarReload(value => value + 1); }} />}</div>
      <div className="driver-availability-groups staffing-groups">{groups.map(group => <details key={group} open={group.includes("unconfirmed") || group.includes("blocked")}><summary>{group}<b>{byGroup.get(group)?.length || 0}</b></summary><div className="driver-availability-list">{byGroup.get(group)?.map(driver => <StaffingRow key={driver.driverId} driver={driver} onChanged={() => void refresh()} />)}</div></details>)}</div></>}
    </>}
  </section>;
}

function AvailabilityCalendar({ weekStart, snapshots, onChanged, employmentType }: { weekStart: string; snapshots: Record<string, DriverAvailabilitySnapshot>; onChanged: () => void; employmentType: "Employed" | "Agency" }) {
  const token = useAccessToken();
  const [openCell, setOpenCell] = useState<string>();
  const [savingCell, setSavingCell] = useState<string>();
  const drivers = useMemo(() => {
    const all = Object.values(snapshots).flatMap(snapshot => snapshot.drivers);
    return [...new Map(all.filter(driver => employmentType === "Employed" ? driver.employmentType === "Employed" : ["Agency", "Casual"].includes(driver.employmentType)).map(driver => [driver.driverId, driver])).values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [employmentType, snapshots]);
  async function setStatus(driver: DriverAvailabilityItem, date: string, status: "AV" | "Leave" | "Not available") {
    if (employmentType === "Employed" || (driver.employmentType !== "Agency" && driver.employmentType !== "Casual")) return;
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
