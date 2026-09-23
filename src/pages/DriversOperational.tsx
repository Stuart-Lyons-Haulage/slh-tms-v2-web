import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { api, request, type Driver } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { DriversMaster } from "./Pages";

function value(value: unknown) {
  return value == null || value === "" ? "—" : String(value);
}

function minutes(value?: number) {
  if (value == null) return "—";
  const hours = Math.floor(value / 60);
  const mins = Math.abs(value % 60);
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

function dateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-GB");
}

function normaliseName(input: unknown) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sortedName(input: unknown) {
  return normaliseName(input).split(" ").filter(Boolean).sort().join(" ");
}

type TachoCsvDriver = {
  surname: string;
  givenNames: string;
  tachoName: string;
  siteName?: string;
  lastRead?: string;
};

type TachoMatch = {
  source: TachoCsvDriver;
  driver: Driver;
  confidence: "Exact" | "Strong";
};

type IdentityImportResult = {
  source: number;
  matched: number;
  updated?: number;
  ambiguous: number;
  unmatched: number;
  message: string;
};

type PreferredVehicle = {
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehicleRegistration: string;
  confidencePercent: number;
  observedDays: number;
  updatedAtUtc?: string;
  protected: boolean;
  nextPlannedDate?: string;
  prompt: string;
};

type PreferredVehicleResponse = {
  planningDate: string;
  lookbackDays: number;
  generatedAtUtc: string;
  preferences: PreferredVehicle[];
};

type PreferredVehicleRefresh = {
  applied: number;
  skipped: number;
  changes: string[];
};

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function csvTable(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [] as string[], rows: [] as string[][] };
  return {
    headers: parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase()),
    rows: lines.slice(1).map(parseCsvLine),
  };
}

function parseTachoAvailabilityCsv(text: string): TachoCsvDriver[] {
  const { headers, rows } = csvTable(text);
  const indexOf = (name: string) => headers.indexOf(name);
  const surnameIndex = indexOf("s_name");
  const givenIndex = indexOf("c_name");
  if (surnameIndex < 0 || givenIndex < 0)
    throw new Error("This does not look like a TachoMaster Driver Availability CSV. Expected s_name and c_name columns.");
  const siteIndex = indexOf("site_name");
  const readIndex = indexOf("tacho_card_last_read_csv");
  return rows.flatMap((cells) => {
    const surname = (cells[surnameIndex] || "").trim();
    const givenNames = (cells[givenIndex] || "").trim();
    if (!surname || !givenNames) return [];
    return [{
      surname,
      givenNames,
      tachoName: `${givenNames} ${surname}`.replace(/\s+/g, " ").trim(),
      siteName: siteIndex >= 0 ? cells[siteIndex] : undefined,
      lastRead: readIndex >= 0 ? cells[readIndex] : undefined,
    }];
  });
}

function parseWorkerList(text: string) {
  const { headers, rows } = csvTable(text);
  const at = (name: string) => headers.indexOf(name);
  const member = at("member code");
  const worker = at("worker name");
  const employee = at("employee number");
  const card = at("driver card no.");
  if (member < 0 || worker < 0 || card < 0)
    throw new Error("This does not look like a TachoMaster Worker List. Expected Member Code, Worker Name and Driver Card No. columns.");
  return rows.flatMap((cells) => {
    if (!(cells[worker] || "").trim()) return [];
    return [{
      memberCode: (cells[member] || "").trim(),
      workerName: (cells[worker] || "").trim(),
      employeeNumber: employee >= 0 ? (cells[employee] || "").trim() : "",
      driverCardNumber: (cells[card] || "").trim(),
    }];
  });
}

function parseVehicleList(text: string) {
  const { headers, rows } = csvTable(text);
  const at = (name: string) => headers.indexOf(name);
  const vehicle = at("vehicle");
  const site = at("site");
  const ownerType = at("owner type");
  const vin = at("vin");
  if (vehicle < 0 || vin < 0)
    throw new Error("This does not look like a TachoMaster Vehicle List. Expected Vehicle and VIN columns.");
  return rows.flatMap((cells) => {
    if (!(cells[vehicle] || "").trim()) return [];
    return [{
      vehicle: (cells[vehicle] || "").trim(),
      site: site >= 0 ? (cells[site] || "").trim() : "",
      ownerType: ownerType >= 0 ? (cells[ownerType] || "").trim() : "",
      vin: (cells[vin] || "").trim(),
    }];
  });
}

function matchTachoDriver(source: TachoCsvDriver, drivers: Driver[]): TachoMatch | undefined {
  const sourceSorted = sortedName(source.tachoName);
  const exact = drivers.filter((driver) =>
    [driver.tachoName, driver.displayName].some((name) => sortedName(name) === sourceSorted),
  );
  if (exact.length === 1) return { source, driver: exact[0], confidence: "Exact" };

  const sourceSurname = normaliseName(source.surname);
  const sourceFirst = normaliseName(source.givenNames).split(" ")[0] || "";
  const strong = drivers.filter((driver) => {
    const candidates = [driver.tachoName, driver.displayName].filter(Boolean).map(normaliseName);
    return candidates.some((candidate) => {
      const parts = candidate.split(" ").filter(Boolean);
      const surnamePresent = parts.includes(sourceSurname);
      const givenMatch = parts.some((part) =>
        part.length >= 4 && sourceFirst.length >= 4 &&
        (part.startsWith(sourceFirst) || sourceFirst.startsWith(part)),
      );
      return surnamePresent && givenMatch;
    });
  });
  return strong.length === 1 ? { source, driver: strong[0], confidence: "Strong" } : undefined;
}

function DriverTachoOverview({ rows, preferences }: { rows: Driver[]; preferences: PreferredVehicle[] }) {
  const [filter, setFilter] = useState("");
  const normalised = filter.trim().toLowerCase();
  const preferenceByDriver = useMemo(() => new Map(preferences.map((item) => [item.driverId, item])), [preferences]);
  const visible = useMemo(
    () => rows.filter((row) => !normalised || [row.displayName, row.employeeNumber, row.tachoName, row.tachoCardNumber, row.mobileNumber].some((field) => String(field || "").toLowerCase().includes(normalised))),
    [rows, normalised],
  );

  return (
    <section className="driver-tacho-overview">
      <div className="title-row">
        <div>
          <p className="eyebrow">Operational driver register</p>
          <h1>Drivers & TachoMaster</h1>
        </div>
        <label className="master-filter">
          Search driver / employee / Tacho
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search…" />
        </label>
      </div>
      <p className="intro">
        Live planning view of driver identity, TachoMaster linkage, regular vehicle pairing and available driving/work time. Driver maintenance and imports remain below this table.
      </p>
      <div className="master-table-wrap">
        <table className="master-table driver-tacho-table">
          <thead>
            <tr>
              <th>Employee</th><th>Driver</th><th>Preferred vehicle</th><th>Pairing</th><th>Protection</th><th>Mobile</th><th>Type</th><th>Group</th><th>Agency</th>
              <th>Tacho name</th><th>Tacho card</th><th>Tacho link</th><th>Drive left today</th><th>Drive left week</th>
              <th>Work left week</th><th>Last Tacho sync</th><th>Licence</th><th>Licence expiry</th><th>Active</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const preference = preferenceByDriver.get(row.id);
              return <tr key={row.id}>
                <td>{value(row.employeeNumber)}</td>
                <td><strong>{value(row.displayName)}</strong></td>
                <td><strong>{value(preference?.vehicleRegistration)}</strong></td>
                <td>{preference ? `${preference.confidencePercent.toFixed(0)}% · ${preference.observedDays} days` : "—"}</td>
                <td>{preference?.protected ? `Protected${preference.nextPlannedDate ? ` · next ${preference.nextPlannedDate}` : ""}` : preference ? "Preferred" : "—"}</td>
                <td>{value(row.mobileNumber)}</td>
                <td>{value(row.driverType || (row.agencyName ? "Agency" : ""))}</td>
                <td>{value(row.driverGroup)}</td>
                <td>{value(row.agencyName)}</td>
                <td>{value(row.tachoName)}</td>
                <td>{value(row.tachoCardNumber)}</td>
                <td>{row.tachoMasterDriverId ? "Linked" : "Not linked"}</td>
                <td>{minutes(row.tachoDriveAvailableTodayMinutes)}</td>
                <td>{minutes(row.tachoDriveAvailableWeekMinutes)}</td>
                <td>{minutes(row.tachoWorkAvailableWeekMinutes)}</td>
                <td>{dateTime(row.lastTachoSyncUtc)}</td>
                <td>{value(row.licenceStatus)}</td>
                <td>{value(row.licenceExpiry)}</td>
                <td>{row.active ? "Yes" : "No"}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">{visible.length} of {rows.length} drivers shown. Preferred vehicles use a 28-day TachoMaster + DOT/Falcon historical average and only auto-assign where the pairing evidence is strong.</p>
    </section>
  );
}

export function DriversOperational() {
  const token = useAccessToken();
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const preferences = useApi(useCallback(async () => request<PreferredVehicleResponse>("/api/v1/driver-vehicle-preferences", await token()), [token]));
  const [syncing, setSyncing] = useState(false);
  const [assigningVehicles, setAssigningVehicles] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string>();

  async function syncTacho() {
    setSyncing(true);
    setMessage(undefined);
    try {
      const result = await api.syncTachoMasterDrivers(await token());
      setMessage(result.message || `${result.matched} drivers updated from TachoMaster.`);
      await drivers.refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "TachoMaster sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function assignRegularVehicles() {
    setAssigningVehicles(true);
    setMessage(undefined);
    try {
      const result = await request<PreferredVehicleRefresh>("/api/v1/driver-vehicle-preferences/refresh?days=28", await token(), { method: "POST" }, 120000);
      setMessage(`Regular vehicle analysis complete: ${result.applied} preferred vehicle pairing(s) assigned, ${result.skipped} left as suggestions only.${result.changes.length ? ` ${result.changes.slice(0, 5).join("; ")}${result.changes.length > 5 ? "; …" : ""}` : ""}`);
      await preferences.refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "Regular vehicle analysis failed.");
    } finally {
      setAssigningVehicles(false);
    }
  }

  async function importWorkerList(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setMessage(undefined);
    try {
      const rows = parseWorkerList(await file.text());
      const result = await request<IdentityImportResult>("/api/v1/integrations/tachomaster/identity/workers", await token(), {
        method: "POST", body: JSON.stringify(rows),
      });
      setMessage(result.message);
      await api.syncTachoMasterDrivers(await token()).catch(() => undefined);
      await drivers.refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "TachoMaster Worker List import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function importVehicleList(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setMessage(undefined);
    try {
      const rows = parseVehicleList(await file.text());
      const result = await request<IdentityImportResult>("/api/v1/integrations/tachomaster/identity/vehicles", await token(), {
        method: "POST", body: JSON.stringify(rows),
      });
      setMessage(result.message);
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "TachoMaster Vehicle List import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function importAvailabilityCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !drivers.data?.length) return;
    setImporting(true);
    setMessage(undefined);
    try {
      const sourceRows = parseTachoAvailabilityCsv(await file.text());
      const matches = sourceRows.flatMap((source) => {
        const match = matchTachoDriver(source, drivers.data || []);
        return match ? [match] : [];
      });
      const uniqueDrivers = new Map(matches.map((match) => [match.driver.id, match]));
      const accessToken = await token();
      let updated = 0;
      for (const match of uniqueDrivers.values()) {
        if (normaliseName(match.driver.tachoName) === normaliseName(match.source.tachoName)) continue;
        const { id, lastTachoSyncUtc: _lastSync, ...payload } = match.driver;
        void _lastSync;
        await api.updateDriver(id, { ...payload, tachoName: match.source.tachoName }, accessToken);
        updated += 1;
      }
      const exactCount = matches.filter((match) => match.confidence === "Exact").length;
      const strongCount = matches.filter((match) => match.confidence === "Strong").length;
      const unmatched = Math.max(sourceRows.length - matches.length, 0);
      setMessage(`Availability file: ${sourceRows.length} drivers, ${matches.length} confidently matched (${exactCount} exact, ${strongCount} strong), ${updated} Tacho names updated and ${unmatched} left for review.`);
      await drivers.refresh();
      await api.syncTachoMasterDrivers(accessToken).catch(() => undefined);
      await drivers.refresh();
    } catch (exception) {
      setMessage(exception instanceof Error ? exception.message : "TachoMaster availability import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="drivers-operational-page">
      <div className="title-row driver-sync-actions">
        <div>
          <p className="eyebrow">Driver availability</p>
          <h1>Driver control</h1>
        </div>
        <div className="title-actions">
          <label className={`button-like ${importing ? "disabled" : ""}`}>
            Import Worker List
            <input type="file" accept=".csv,text/csv" hidden disabled={importing} onChange={(event) => void importWorkerList(event)} />
          </label>
          <label className={`button-like ${importing ? "disabled" : ""}`}>
            Import Vehicle List
            <input type="file" accept=".csv,text/csv" hidden disabled={importing} onChange={(event) => void importVehicleList(event)} />
          </label>
          <label className={`button-like ${importing ? "disabled" : ""}`}>
            Import Availability
            <input type="file" accept=".csv,text/csv" hidden disabled={importing} onChange={(event) => void importAvailabilityCsv(event)} />
          </label>
          <button onClick={() => { void drivers.refresh(); void preferences.refresh(); }} disabled={drivers.loading || preferences.loading}>Refresh</button>
          <button onClick={() => void assignRegularVehicles()} disabled={assigningVehicles}>
            {assigningVehicles ? "Analysing 28 days…" : "Assign regular vehicles"}
          </button>
          <button className="primary" onClick={() => void syncTacho()} disabled={syncing}>
            {syncing ? "Syncing TachoMaster…" : "Sync TachoMaster"}
          </button>
        </div>
      </div>
      <p className="hint">Worker List is the preferred identity import because it carries TachoMaster member code and driver card number. Vehicle List links the TachoMaster/DOT registration to the existing vehicle master. “Assign regular vehicles” reviews the last 28 days of TachoMaster duties and stored DOT/Falcon driver evidence, then only assigns a preferred truck where the pairing is sufficiently strong.</p>
      {message && <p className="notice inline-notice">{message}</p>}
      {(drivers.error || preferences.error) ? <div className="state error"><p>{drivers.error || preferences.error}</p></div> : drivers.loading && !drivers.data ? <div className="state">Loading driver and Tacho data…</div> : <DriverTachoOverview rows={drivers.data || []} preferences={preferences.data?.preferences || []} />}
      <div className="driver-maintenance-section">
        <p className="eyebrow">Driver maintenance</p>
        <DriversMaster />
      </div>
    </div>
  );
}
