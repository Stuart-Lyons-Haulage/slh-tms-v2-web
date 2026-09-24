import { useCallback, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api, type DriverTimesheetDay, type DriverTimesheetDriver } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { useApi } from '../lib/useApi';

type TimesheetSection = 'Employed' | 'Agency';

function asDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function isoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentLyonsWeek() {
  const today = new Date();
  const offset = (today.getDay() - 3 + 7) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}

function moveRange(from: string, to: string, days: number) {
  const start = asDate(from);
  const end = asDate(to);
  start.setDate(start.getDate() + days);
  end.setDate(end.getDate() + days);
  return { from: isoDate(start), to: isoDate(end) };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).format(asDate(value));
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatTime(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function hhmm(minutes?: number) {
  if (minutes == null) return '—';
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, '0')}m`;
}

function decimalHours(minutes?: number) {
  return minutes == null ? '' : (minutes / 60).toFixed(2);
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function evidenceClass(status: string) {
  if (status === 'Confirmed') return 'confirmed';
  if (status === 'Review' || status === 'Missing evidence') return 'review';
  if (status === 'Open duty') return 'open';
  return 'partial';
}

function DriverRows({ drivers }: { drivers: DriverTimesheetDriver[] }) {
  return <div className="timesheet-table-wrap">
    <table className="timesheet-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Driver</th>
          <th>Start</th>
          <th>First move</th>
          <th>Finish</th>
          <th>Last move</th>
          <th>Duty</th>
          <th>Drive</th>
          <th>Other work</th>
          <th>Break / rest</th>
          <th>Vehicle</th>
          <th>Run</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        {drivers.flatMap(driver => driver.days.map(day =>
          <tr key={`${driver.driverId}-${day.date}`}>
            <td><strong>{formatDate(day.date)}</strong></td>
            <td>
              <strong>{driver.driverName}</strong>
              <small>{driver.employeeNumber}{driver.agencyName ? ` · ${driver.agencyName}` : ''}</small>
            </td>
            <td>{formatTime(day.startUtc)}<small>Tacho {formatTime(day.tachoStartUtc)}</small></td>
            <td>{formatTime(day.firstMovementUtc)}{day.startVarianceMinutes != null && <small>{Math.abs(day.startVarianceMinutes)} min variance</small>}</td>
            <td>{formatTime(day.finishUtc)}<small>Tacho {formatTime(day.tachoEndUtc)}</small></td>
            <td>{formatTime(day.lastMovementUtc)}{day.finishVarianceMinutes != null && <small>{Math.abs(day.finishVarianceMinutes)} min variance</small>}</td>
            <td><strong>{hhmm(day.dutySpanMinutes)}</strong></td>
            <td>{hhmm(day.driveMinutes)}</td>
            <td>{hhmm(day.workMinutes)}</td>
            <td>{hhmm(day.restMinutes)}<small>{day.breakCount ? `${day.breakCount} break${day.breakCount === 1 ? '' : 's'}` : ''}</small></td>
            <td>{day.vehicles.length ? day.vehicles.join(', ') : '—'}</td>
            <td>{day.runs.length ? day.runs.join(', ') : <span className="timesheet-no-route">No allocated route</span>}</td>
            <td>
              <span className={`timesheet-status ${evidenceClass(day.status)}`}>{day.status}</span>
              {day.notes.length > 0 && <small className="timesheet-note" title={day.notes.join(' ')}>{day.notes[0]}</small>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

function SectionSummary({ drivers, section }: { drivers: DriverTimesheetDriver[]; section: TimesheetSection }) {
  const totals = useMemo(() => ({
    drivers: drivers.length,
    shifts: drivers.reduce((sum, driver) => sum + driver.daysWorked, 0),
    duty: drivers.reduce((sum, driver) => sum + driver.dutySpanMinutes, 0),
    drive: drivers.reduce((sum, driver) => sum + driver.driveMinutes, 0),
    review: drivers.reduce((sum, driver) => sum + driver.reviewDays, 0)
  }), [drivers]);

  return <div className="timesheet-metrics">
    <article><span>{section} drivers</span><strong>{totals.drivers}</strong></article>
    <article><span>Shifts evidenced</span><strong>{totals.shifts}</strong></article>
    <article><span>Duty total</span><strong>{hhmm(totals.duty)}</strong></article>
    <article><span>Driving total</span><strong>{hhmm(totals.drive)}</strong></article>
    <article className={totals.review ? 'attention' : ''}><span>Needs review</span><strong>{totals.review}</strong></article>
  </div>;
}

export function DriverTimesheets() {
  const token = useAccessToken();
  const initial = useMemo(currentLyonsWeek, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [section, setSection] = useState<TimesheetSection>('Employed');
  const [search, setSearch] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);

  const report = useApi(useCallback(async () => api.driverTimesheets(from, to, await token()), [from, to, token]));
  const sourceDrivers = report.data?.drivers || [];
  const drivers = sourceDrivers
    .filter(driver => driver.employmentType === section)
    .filter(driver => !reviewOnly || driver.reviewDays > 0)
    .filter(driver => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [driver.driverName, driver.employeeNumber, driver.agencyName]
        .some(value => value?.toLowerCase().includes(q));
    });

  const setWeek = (direction: -1 | 1) => {
    const moved = moveRange(from, to, direction * 7);
    setFrom(moved.from);
    setTo(moved.to);
  };

  const resetToCurrentWeek = () => {
    const current = currentLyonsWeek();
    setFrom(current.from);
    setTo(current.to);
  };

  const detailedExport = () => {
    const header = [
      'Date', 'Driver', 'Employee Number', 'Employment Type', 'Agency', 'Start', 'First Vehicle Movement',
      'Finish', 'Last Vehicle Movement', 'Duty HH:MM', 'Duty Hours Decimal', 'Driving HH:MM', 'Driving Hours Decimal',
      'Other Work HH:MM', 'Availability HH:MM', 'Break/Rest HH:MM', 'Vehicle(s)', 'Run(s)', 'Route Allocated',
      'Evidence Status', 'Start Variance Minutes', 'Finish Variance Minutes', 'Notes'
    ];
    const rows = drivers.flatMap(driver => driver.days.map(day => [
      day.date, driver.driverName, driver.employeeNumber, driver.employmentType, driver.agencyName,
      formatDateTime(day.startUtc), formatDateTime(day.firstMovementUtc), formatDateTime(day.finishUtc), formatDateTime(day.lastMovementUtc),
      hhmm(day.dutySpanMinutes), decimalHours(day.dutySpanMinutes), hhmm(day.driveMinutes), decimalHours(day.driveMinutes),
      hhmm(day.workMinutes), hhmm(day.availableMinutes), hhmm(day.restMinutes), day.vehicles.join('; '), day.runs.join('; '),
      day.routeAllocated ? 'Yes' : 'No', day.status, day.startVarianceMinutes, day.finishVarianceMinutes, day.notes.join(' | ')
    ]));
    downloadCsv(`slh-${section.toLowerCase()}-timesheets-${from}-to-${to}`, [header, ...rows]);
  };

  const summaryExport = () => {
    const header = [
      'Agency', 'Driver', 'Employee Number', 'From', 'To', 'Days Worked', 'Duty HH:MM', 'Duty Hours Decimal',
      'Driving HH:MM', 'Driving Hours Decimal', 'Other Work HH:MM', 'Availability HH:MM', 'Break/Rest HH:MM',
      'Review Days', 'Evidence Status'
    ];
    const rows = drivers.map(driver => [
      driver.agencyName, driver.driverName, driver.employeeNumber, from, to, driver.daysWorked,
      hhmm(driver.dutySpanMinutes), decimalHours(driver.dutySpanMinutes), hhmm(driver.driveMinutes), decimalHours(driver.driveMinutes),
      hhmm(driver.workMinutes), hhmm(driver.availableMinutes), hhmm(driver.restMinutes), driver.reviewDays, driver.status
    ]);
    downloadCsv(`slh-${section.toLowerCase()}-timesheet-summary-${from}-to-${to}`, [header, ...rows]);
  };

  return <section className="driver-timesheets-page">
    <div className="driver-history-subnav" aria-label="Driver history sections">
      <NavLink to="/driver-assignments">Driver assignments</NavLink>
      <NavLink to="/driver-timesheets">Timesheets</NavLink>
    </div>

    <div className="title-row">
      <div>
        <p className="eyebrow">Driver history · timesheets</p>
        <h1>Driver timesheets</h1>
        <p className="hint">TachoMaster duty evidence reconciled to RoadTech vehicle movement. A route allocation is not required for a timesheet.</p>
      </div>
      <div className="timesheet-export-actions">
        <button onClick={summaryExport} disabled={!drivers.length}>Export summary CSV</button>
        <button className="primary" onClick={detailedExport} disabled={!drivers.length}>Export detailed CSV</button>
      </div>
    </div>

    <div className="timesheet-toolbar">
      <button onClick={() => setWeek(-1)}>← Previous week</button>
      <label>From <input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>To <input type="date" min={from} value={to} onChange={event => setTo(event.target.value)} /></label>
      <button onClick={() => setWeek(1)}>Next week →</button>
      <button onClick={resetToCurrentWeek}>Current Wed–Tue</button>
      <button onClick={() => void report.refresh()}>Refresh evidence</button>
    </div>

    <div className="timesheet-section-tabs" role="tablist" aria-label="Timesheet driver type">
      <button className={section === 'Employed' ? 'active' : ''} onClick={() => setSection('Employed')}>
        Employed drivers <span>{report.data?.summary.employedDrivers ?? 0}</span>
      </button>
      <button className={section === 'Agency' ? 'active' : ''} onClick={() => setSection('Agency')}>
        Agency drivers <span>{report.data?.summary.agencyDrivers ?? 0}</span>
      </button>
    </div>

    {report.data?.summary.unmatchedTachoDuties ? <div className="notice warn">
      {report.data.summary.unmatchedTachoDuties} TachoMaster duty record{report.data.summary.unmatchedTachoDuties === 1 ? '' : 's'} could not be matched to Driver Master and are excluded until the identity link is resolved.
    </div> : null}

    {report.data && <div className="timesheet-source-strip">
      <span><strong>TachoMaster:</strong> {report.data.sourceStatus.tachoMaster}</span>
      <span><strong>RoadTech:</strong> {report.data.sourceStatus.roadTech}</span>
      <span><strong>Range:</strong> {formatDate(report.data.from)} – {formatDate(report.data.to)}</span>
    </div>}

    <div className="timesheet-filter-row">
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder={section === 'Agency' ? 'Search driver or agency…' : 'Search driver…'} />
      <label className="timesheet-review-check"><input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)} /> Needs review only</label>
    </div>

    {report.loading ? <div className="state">Building TachoMaster and RoadTech timesheet evidence…</div>
      : report.error ? <div className="state error">{report.error}</div>
      : <>
          <SectionSummary drivers={drivers} section={section} />
          {section === 'Agency' && drivers.length > 0 && <div className="timesheet-agency-summary">
            {Object.entries(drivers.reduce<Record<string, DriverTimesheetDriver[]>>((groups, driver) => {
              const key = driver.agencyName || 'Agency not set';
              (groups[key] ||= []).push(driver);
              return groups;
            }, {})).map(([agency, agencyDrivers]) => {
              const duty = agencyDrivers.reduce((sum, driver) => sum + driver.dutySpanMinutes, 0);
              const reviews = agencyDrivers.reduce((sum, driver) => sum + driver.reviewDays, 0);
              return <article key={agency}>
                <strong>{agency}</strong>
                <span>{agencyDrivers.length} driver{agencyDrivers.length === 1 ? '' : 's'} · {hhmm(duty)} evidenced</span>
                <span className={reviews ? 'review-text' : ''}>{reviews ? `${reviews} shift${reviews === 1 ? '' : 's'} to review` : 'No review variances'}</span>
              </article>;
            })}
          </div>}
          {drivers.length ? <DriverRows drivers={drivers} /> : <div className="state">No {section.toLowerCase()} driver timesheets match this range and filter.</div>}
        </>}
  </section>;
}
