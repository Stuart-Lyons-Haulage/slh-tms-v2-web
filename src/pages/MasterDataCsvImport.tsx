/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState, type ChangeEvent } from "react";
import { apiBaseUrl, type MasterApplyResponse, type StageBatchRequest } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type MasterEntity = "driver" | "vehicle" | "trailer" | "site";
type FlatPayload = Record<string, string | number | boolean>;

type ParsedMasterCsv = {
  requests: StageBatchRequest[];
  headers: string[];
  preview: FlatPayload[];
  warnings: string[];
};

type WorkbookSummaryCounts = {
  total: number;
  matched: number;
  imported: number;
  ready: number;
  review: number;
  skipped: number;
  newRows: number;
};

type WorkbookRowResult = {
  section: string;
  rowNumber: number;
  key: string;
  status: string;
  reason: string;
  confidence: number;
  actionTaken?: string;
  relatedRecords?: string[];
};

type WorkbookImportResult = {
  mode: string;
  rows: WorkbookRowResult[];
  warnings: string[];
  summary?: Record<string, WorkbookSummaryCounts>;
};

type WorkbookUploadState = {
  file?: File;
  fileName: string;
  preview?: WorkbookImportResult;
  commit?: WorkbookImportResult;
};

const MASTER_IMPORT_CHUNK_SIZE = 25;
const WORKBOOK_ACCEPT = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

const identityFields: Record<MasterEntity, string[]> = {
  driver: ["employeeNumber", "displayName"],
  vehicle: ["registration"],
  trailer: ["trailerNumber"],
  site: ["externalCode", "name"],
};

const aliases: Record<string, string> = {
  employeenumber: "employeeNumber", drivernumber: "employeeNumber", driverno: "employeeNumber", payrollnumber: "employeeNumber", payrollno: "employeeNumber",
  displayname: "displayName", drivername: "displayName", name: "name",
  drivinglicencenumber: "drivingLicenceNumber", licencenumber: "drivingLicenceNumber", licensenumber: "drivingLicenceNumber",
  licenceexpiry: "licenceExpiry", licenseexpiry: "licenceExpiry", tachoname: "tachoName", mobilenumber: "mobileNumber", mobile: "mobileNumber",
  registration: "registration", reg: "registration", fleetnumber: "fleetNumber", fleetno: "fleetNumber", abbreviation: "abbreviation",
  trailernumber: "trailerNumber", trailerno: "trailerNumber", standardcapacity: "standardCapacity", eurocapacity: "euroCapacity", type: "type",
  externalcode: "externalCode", sitecode: "externalCode", sitename: "name", drivertextname: "driverTextName", collectionaddress: "collectionAddress", aliases: "aliases",
  active: "active",
};

function key(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fieldName(value: string) {
  const compact = key(value);
  return aliases[compact] || value.trim().replace(/^./, (character) => character.toLowerCase()).replace(/\s+(.)/g, (_, character: string) => character.toUpperCase());
}

export function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(value.trim()); value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normaliseDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : value;
}

function typedValue(field: string, raw: string): string | number | boolean {
  if (field === "active") return !["false", "no", "0", "inactive"].includes(raw.trim().toLowerCase());
  if (["standardCapacity", "euroCapacity"].includes(field) && /^-?\d+$/.test(raw.trim())) return Number(raw);
  if (field.toLowerCase().includes("expiry") || field.toLowerCase().endsWith("date")) return normaliseDate(raw.trim());
  return raw.trim();
}

export function parseMasterDataCsv(text: string, entity: MasterEntity, fileName: string): ParsedMasterCsv {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
  const headers = rows[0].map(fieldName);
  const warnings: string[] = [];
  const preview: FlatPayload[] = [];
  const requests: StageBatchRequest[] = [];

  rows.slice(1).forEach((cells, index) => {
    const payload: FlatPayload = {};
    headers.forEach((header, column) => {
      const raw = cells[column] ?? "";
      if (raw !== "") payload[header] = typedValue(header, raw);
    });
    const identity = identityFields[entity].map((field) => payload[field]).find((value) => value != null && String(value).trim());
    if (!identity) {
      warnings.push(`Row ${index + 2} was skipped because it has no ${identityFields[entity].join(" / ")} identity.`);
      return;
    }
    preview.push(payload);
    requests.push({
      entityType: entity,
      idempotencyKey: `csv-sanity:${entity}:${String(identity).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-")}`,
      source: `Master data CSV sanity · ${fileName}`,
      payload,
    });
  });

  if (!requests.length) throw new Error("No importable master-data rows were found in the CSV.");
  return { requests, headers, preview: preview.slice(0, 6), warnings };
}

export async function applyMasterDataInChunks(
  records: StageBatchRequest[],
  applyBatch: (batch: StageBatchRequest[]) => Promise<MasterApplyResponse>,
  chunkSize = MASTER_IMPORT_CHUNK_SIZE,
  onProgress?: (completed: number, total: number) => void,
): Promise<MasterApplyResponse> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("Import chunk size must be at least 1.");
  const aggregate: MasterApplyResponse = { received: 0, applied: 0, registered: 0, failed: 0, linked: 0, results: [] };

  for (let offset = 0; offset < records.length; offset += chunkSize) {
    const batch = records.slice(offset, offset + chunkSize);
    const result = await applyBatch(batch);
    aggregate.received += result.received;
    aggregate.applied += result.applied;
    aggregate.registered = (aggregate.registered ?? 0) + (result.registered ?? 0);
    aggregate.failed += result.failed;
    aggregate.linked = (aggregate.linked ?? 0) + (result.linked ?? 0);
    aggregate.results.push(...result.results);
    onProgress?.(Math.min(offset + batch.length, records.length), records.length);
  }

  return aggregate;
}

function isWorkbookFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls");
}

function sectionCount(result: WorkbookImportResult | undefined, section: string) {
  return result?.rows?.filter((row) => row.section === section).length ?? 0;
}

function shortResultRows(result: WorkbookImportResult | undefined) {
  if (!result?.rows?.length) return [];
  return result.rows
    .filter((row) => ["review", "conflict", "skipped", "matched", "updated", "imported", "ready", "new"].includes(String(row.status).toLowerCase()))
    .slice(0, 40);
}

function apiErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
  }
  return fallback;
}

async function postWorkbook(file: File, action: "preview" | "commit", accessToken?: string): Promise<WorkbookImportResult> {
  const form = new FormData();
  form.append("file", file, file.name);

  const response = await fetch(`${apiBaseUrl}/api/v1/master-data/workbook/${action}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: form,
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(apiErrorMessage(payload, `Workbook import failed (${response.status}).`));
  }

  return await response.json() as WorkbookImportResult;
}

export function MasterDataCsvImport() {
  const token = useAccessToken();
  const [upload, setUpload] = useState<WorkbookUploadState>({ fileName: "" });
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const latestResult = upload.commit || upload.preview;
  const resultRows = useMemo(() => shortResultRows(latestResult), [latestResult]);

  const summarySections = useMemo(() => {
    const result = latestResult;
    if (!result) return [];

    const fromSummary = result.summary
      ? Object.entries(result.summary).map(([section, counts]) => ({ section, ...counts }))
      : [];

    if (fromSummary.length) return fromSummary;

    return [
      "Sites",
      "Site Cutoffs",
      "Run Times",
      "Vehicles & Fuel",
      "Drivers",
      "Customer Contacts",
      "Market Contacts",
      "Fuel Price History",
    ].map((section) => ({
      section,
      total: sectionCount(result, section),
      matched: 0,
      imported: 0,
      ready: 0,
      review: 0,
      skipped: 0,
      newRows: 0,
    })).filter((row) => row.total > 0);
  }, [latestResult]);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setUpload({ fileName: "" });
    setMessage(undefined);
    setError(undefined);

    if (!file) return;

    setUpload({ file, fileName: file.name });
    if (!isWorkbookFile(file)) {
      setError("Choose the SLH master-data workbook as a .xlsx or .xls file. Do not convert it to CSV.");
      return;
    }

    setMessage("Workbook selected. Run preview first to check what will update before committing.");
  }

  async function previewWorkbook() {
    if (!upload.file) return;
    if (!isWorkbookFile(upload.file)) {
      setError("Choose the SLH master-data workbook as a .xlsx or .xls file.");
      return;
    }

    setPreviewing(true);
    setError(undefined);
    setMessage("Reading workbook and checking live TMS matches…");

    try {
      const accessToken = await token();
      const result = await postWorkbook(upload.file, "preview", accessToken);
      setUpload((current) => ({ ...current, preview: result, commit: undefined }));
      setMessage(`${result.rows?.length ?? 0} workbook rows checked. Review warnings/conflicts before committing.`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The workbook preview could not be completed.");
      setMessage(undefined);
    } finally {
      setPreviewing(false);
    }
  }

  async function commitWorkbook() {
    if (!upload.file) return;
    if (!isWorkbookFile(upload.file)) {
      setError("Choose the SLH master-data workbook as a .xlsx or .xls file.");
      return;
    }

    setCommitting(true);
    setError(undefined);
    setMessage("Writing workbook updates to TMS Master Data…");

    try {
      const accessToken = await token();
      const result = await postWorkbook(upload.file, "commit", accessToken);
      setUpload((current) => ({ ...current, commit: result }));
      const imported = result.rows?.filter((row) => ["imported", "updated", "matched"].includes(String(row.status).toLowerCase())).length ?? 0;
      const review = result.rows?.filter((row) => ["review", "conflict", "skipped"].includes(String(row.status).toLowerCase())).length ?? 0;
      setMessage(`${imported} rows written or matched. ${review} rows held/skipped for review.`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The workbook commit could not be completed.");
      setMessage(undefined);
    } finally {
      setCommitting(false);
    }
  }

  return <section className="panel master-csv-import">
    <div className="title-row">
      <div>
        <p className="eyebrow">SQL master-data workbook</p>
        <h2>Master data workbook</h2>
        <p className="hint">Upload the full SLH master-data Excel workbook. The API reads every sheet and writes updates to the correct TMS master-data area. Drivers are update-only; TachoMaster remains the authority for driver identity.</p>
      </div>
    </div>
    <div className="master-csv-controls">
      <label>Workbook file<input type="file" accept={WORKBOOK_ACCEPT} onChange={(event) => void chooseFile(event)} /></label>
      {upload.fileName && <strong>{upload.fileName}</strong>}
    </div>
    {message && <p className="notice ready">{message}</p>}
    {error && <p className="notice">{error}</p>}
    <div className="actions">
      <button type="button" className="primary" disabled={!upload.file || previewing || committing} onClick={() => void previewWorkbook()}>{previewing ? "Previewing workbook…" : "Preview workbook"}</button>
      <button type="button" className="primary" disabled={!upload.file || !upload.preview || previewing || committing} onClick={() => void commitWorkbook()}>{committing ? "Writing updates…" : "Commit workbook updates"}</button>
    </div>
    {latestResult?.warnings?.length ? <div className="notice inline-notice"><strong>Workbook warnings</strong><ul>{latestResult.warnings.slice(0, 10).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div> : null}
    {summarySections.length ? <div className="master-csv-preview"><h3>Workbook summary</h3><table className="master-table"><thead><tr><th>Section</th><th>Total</th><th>Matched</th><th>Imported</th><th>Ready</th><th>Review</th><th>Skipped</th><th>New</th></tr></thead><tbody>{summarySections.map((row) => <tr key={row.section}><td>{row.section}</td><td>{row.total}</td><td>{row.matched}</td><td>{row.imported}</td><td>{row.ready}</td><td>{row.review}</td><td>{row.skipped}</td><td>{row.newRows}</td></tr>)}</tbody></table></div> : null}
    {resultRows.length ? <div className="master-csv-preview"><h3>Review rows</h3><table className="master-table"><thead><tr><th>Section</th><th>Row</th><th>Key</th><th>Status</th><th>Confidence</th><th>Action</th><th>Reason</th></tr></thead><tbody>{resultRows.map((row, index) => <tr key={`${row.section}-${row.rowNumber}-${row.key}-${index}`}><td>{row.section}</td><td>{row.rowNumber}</td><td>{row.key}</td><td>{row.status}</td><td>{row.confidence}</td><td>{row.actionTaken ?? ""}</td><td>{row.reason}</td></tr>)}</tbody></table></div> : null}
  </section>;
}
