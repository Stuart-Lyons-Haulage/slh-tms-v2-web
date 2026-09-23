import { useMemo, useState, type ChangeEvent } from "react";
import { api, type StageBatchRequest } from "../lib/api";
import { useAccessToken } from "../lib/auth";

function text(value: unknown) { return String(value ?? "").trim(); }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

function parseBatch(raw: unknown): StageBatchRequest[] {
  const candidate = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw.records) ? raw.records : undefined;
  if (!candidate) throw new Error("This is not a TMS staging batch. Use the contingency JSON produced for Order Review.");
  if (candidate.length === 0) throw new Error("The file contains no records.");
  if (candidate.length > 500) throw new Error("A contingency batch can contain a maximum of 500 records.");
  return candidate.map((item, index) => {
    if (!isObject(item)) throw new Error(`Record ${index + 1} is not a valid object.`);
    if (text(item.entityType).toLowerCase() !== "order") throw new Error(`Record ${index + 1} is not an order record.`);
    if (!text(item.idempotencyKey)) throw new Error(`Record ${index + 1} is missing an idempotency key.`);
    if (!isObject(item.payload)) throw new Error(`Record ${index + 1} is missing its order payload.`);
    return item as unknown as StageBatchRequest;
  });
}

export function ManualContingencyImport() {
  const token = useAccessToken();
  const [records, setRecords] = useState<StageBatchRequest[]>([]);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => {
    const dates = new Set<string>();
    let missingReference = 0; let missingCustomer = 0; let missingDate = 0; let warnings = 0;
    const keys = records.map(record => text(record.idempotencyKey).toLowerCase());
    for (const record of records) {
      const payload = record.payload as Record<string, unknown>;
      if (!text(payload.poNumber)) missingReference++;
      if (!text(payload.customerCode)) missingCustomer++;
      if (!text(payload.collectionDate)) missingDate++; else dates.add(text(payload.collectionDate));
      if (Array.isArray(payload.intakeWarnings)) warnings += payload.intakeWarnings.length;
    }
    return { dates: [...dates].sort(), missingReference, missingCustomer, missingDate, warnings, duplicateKeys: keys.length - new Set(keys).size };
  }, [records]);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setFileName(file.name); setRecords([]); setMessage(undefined); setError(undefined);
    try { setRecords(parseBatch(JSON.parse(await file.text()) as unknown)); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "The contingency file could not be read."); }
  }

  async function submit() {
    if (!records.length || summary.duplicateKeys || busy) return;
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const result = await api.stageBatch(records, await token());
      setMessage(`${result.created} new order${result.created === 1 ? "" : "s"} staged into Order Review. ${result.existing} already existed. Nothing was auto-approved.`);
      setRecords([]); setFileName("");
    } catch (exception) { setError(exception instanceof Error ? exception.message : "The contingency batch could not be staged."); }
    finally { setBusy(false); }
  }

  return <section className="import-subpage">
    <div className="title-row"><div><p className="eyebrow">Manual contingency</p><h2>Stage an order batch</h2><p className="hint">Use only when the normal Info-mailbox/customer-file intake is unavailable. Every order still goes through Order Control before planning.</p></div></div>
    <label className="file-drop"><strong>Choose contingency JSON</strong><span>{fileName || "TMS order staging JSON"}</span><input type="file" accept=".json,application/json" onChange={(event) => void choose(event)} disabled={busy} /></label>
    {error && <p className="notice inline-notice">{error}</p>}
    {records.length > 0 && <>
      <div className="review-metrics import-centre-metrics">
        <article><span>Records</span><strong>{records.length}</strong><small>{summary.dates.join(", ") || "Date missing"}</small></article>
        <article className={summary.missingReference ? "attention" : ""}><span>Missing reference</span><strong>{summary.missingReference}</strong></article>
        <article className={summary.missingCustomer ? "attention" : ""}><span>Missing customer</span><strong>{summary.missingCustomer}</strong></article>
        <article className={summary.missingDate ? "attention" : ""}><span>Missing date</span><strong>{summary.missingDate}</strong></article>
        <article className={summary.duplicateKeys ? "attention" : ""}><span>Duplicate keys</span><strong>{summary.duplicateKeys}</strong></article>
        <article className={summary.warnings ? "attention" : ""}><span>Source warnings</span><strong>{summary.warnings}</strong></article>
      </div>
      <button className="primary" type="button" onClick={() => void submit()} disabled={busy || summary.duplicateKeys > 0}>{busy ? "Staging…" : `Send ${records.length} to Order Control`}</button>
    </>}
    {message && <p className="notice inline-notice">{message}</p>}
  </section>;
}
