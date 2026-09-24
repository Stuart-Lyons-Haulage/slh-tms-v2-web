import { useCallback, useEffect, useMemo, useState } from "react";
import { request, type StagedImport } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { SILENT_API_REFRESH_EVENT } from "../lib/useApi";
import { SourceEmailEvidenceDrawer } from "../components/SourceEmailEvidenceDrawer";
import { resolveSourceEvidence } from "../sourceEvidence";

type QueuePage = {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  records: StagedImport[];
};

type Payload = Record<string, unknown> & {
  poNumber?: string;
  customerPo?: string;
  customerCode?: string;
  collectionDate?: string;
  deliveryDate?: string;
  sellerName?: string;
  stallNumber?: string;
  sourceSubject?: string;
};

type PendingRow = {
  item: StagedImport;
  payload: Payload;
  reason: string;
};

const text = (value: unknown) => String(value ?? "").trim();
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function isUsableDate(value: unknown) {
  const candidate = text(value);
  if (!isoDate.test(candidate)) return false;
  const parsed = new Date(`${candidate}T12:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function parse(item: StagedImport): PendingRow | undefined {
  try {
    const payload = JSON.parse(item.payloadJson || "{}") as Payload;
    const collection = text(payload.collectionDate);
    const delivery = text(payload.deliveryDate);
    if (isUsableDate(collection) || isUsableDate(delivery)) return undefined;

    const reason = !collection && !delivery
      ? "Collection and delivery dates are missing"
      : collection && !isUsableDate(collection)
        ? `Collection date is invalid: ${collection}`
        : delivery && !isUsableDate(delivery)
          ? `Delivery date is invalid: ${delivery}`
          : "Planning date needs review";
    return { item, payload, reason };
  } catch {
    return { item, payload: {}, reason: "Staged order payload cannot be read" };
  }
}

function displayReference(payload: Payload) {
  return text(payload.customerPo) || text(payload.poNumber) || "Reference missing";
}

async function loadPendingOrders(accessToken: string) {
  const records: StagedImport[] = [];
  let page = 1;
  let total = 0;
  let hasMore = true;

  while (hasMore && page <= 50) {
    const result = await request<QueuePage>(
      `/api/v2/staging/queue?status=PendingReview&entityType=order&page=${page}&pageSize=100`,
      accessToken,
    );
    if (page === 1) total = result.total;
    records.push(...result.records);
    hasMore = result.hasMore;
    page += 1;
  }

  return { records, total, complete: records.length >= total };
}

export function UndatedOrderReviewQueue() {
  const token = useAccessToken();
  const [records, setRecords] = useState<StagedImport[]>([]);
  const [total, setTotal] = useState(0);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [editing, setEditing] = useState<{ id: string; payload: Payload }>();
  const [sourceEmailStagingId, setSourceEmailStagingId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setError(undefined);
      const accessToken = await token();
      const result = await loadPendingOrders(accessToken);
      setRecords(result.records);
      setTotal(result.total);
      setComplete(result.complete);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The pending order queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener(SILENT_API_REFRESH_EVENT, handler);
    return () => window.removeEventListener(SILENT_API_REFRESH_EVENT, handler);
  }, [refresh]);

  const undatedRows = useMemo(() => records.map(parse).filter((row): row is PendingRow => Boolean(row)), [records]);
  const datedCount = records.length - undatedRows.length;

  async function beginFix(row: PendingRow) {
    setBusyId(row.item.id);
    try {
      const detail = await request<StagedImport>(`/api/v2/staging/${row.item.id}`, await token());
      const payload = JSON.parse(detail.payloadJson || "{}") as Payload;
      setEditing({ id: row.item.id, payload });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The staged order could not be opened.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function saveDates(row: PendingRow) {
    if (!editing || editing.id !== row.item.id) return;
    const collectionDate = text(editing.payload.collectionDate);
    const deliveryDate = text(editing.payload.deliveryDate);
    if (!isUsableDate(collectionDate) && !isUsableDate(deliveryDate)) {
      setError("Enter a valid collection or delivery date before saving.");
      return;
    }

    setBusyId(row.item.id);
    setError(undefined);
    try {
      await request<StagedImport>(`/api/v2/staging/${row.item.id}/payload`, await token(), {
        method: "PUT",
        body: JSON.stringify({
          payload: editing.payload,
          note: "Planning date corrected from the Needs attention queue before approval.",
        }),
      });
      setEditing(undefined);
      await refresh();
      window.dispatchEvent(new Event(SILENT_API_REFRESH_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The corrected dates could not be saved.");
    } finally {
      setBusyId(undefined);
    }
  }

  if (!loading && undatedRows.length === 0 && complete) return null;

  return <section className="panel order-selection-panel" style={{ marginBottom: 18 }}>
    <div className="title-row" style={{ alignItems: "end" }}>
      <div>
        <p className="eyebrow">Needs attention</p>
        <h2>Orders without a usable planning date</h2>
        <p className="hint">These orders are genuinely waiting in SQL but cannot appear in the date bubbles until a collection or delivery date is usable. Nothing in Pending Review is allowed to disappear silently.</p>
      </div>
    </div>

    <div className="review-metrics" style={{ marginTop: 2 }}>
      <article className={undatedRows.length ? "attention" : ""}><span>Needs date</span><strong>{undatedRows.length}</strong><small>Visible here for correction</small></article>
      <article><span>Dated</span><strong>{datedCount}</strong><small>Visible in normal review dates</small></article>
      <article><span>Total pending</span><strong>{total}</strong><small>API queue total</small></article>
    </div>

    {!complete && <p className="review-error">The queue contains more records than this safety view loaded. Review paging is required before the queue can be reconciled completely.</p>}
    {error && <p className="review-error">{error}</p>}
    {loading && <div className="state">Checking pending orders for missing planning dates…</div>}

    {undatedRows.length > 0 && <div className="bulk-order-list" role="list" aria-label="Orders needing planning dates">
      {undatedRows.map((row) => {
        const rowBusy = busyId === row.item.id;
        const isEditing = editing?.id === row.item.id;
        const payload = isEditing ? editing.payload : row.payload;
        const evidence = resolveSourceEvidence(row.payload);
        const hasSource = Boolean(evidence.messageId || evidence.internetMessageId || evidence.webLink);
        return <article className="bulk-order-row held" key={row.item.id} role="listitem">
          <span className="bulk-order-ref"><strong>{displayReference(row.payload)}</strong><small>{text(row.payload.poNumber) || "TMS reference missing"}</small></span>
          <span><strong>{text(row.payload.customerCode) || "Customer / mapping missing"}</strong><small>{text(row.payload.sellerName) || "Collection site missing"} → {text(row.payload.stallNumber) || "Destination missing"}</small></span>
          <span className="bulk-order-status blocked">{row.reason}</span>
          <div className="bulk-order-actions">
            {hasSource && <button type="button" className="source-email-review-button" onClick={() => setSourceEmailStagingId(row.item.id)} disabled={Boolean(busyId)}>Review source email</button>}
            {!isEditing && <button type="button" onClick={() => void beginFix(row)} disabled={Boolean(busyId)}>{rowBusy ? "Loading…" : "Fix dates"}</button>}
            {isEditing && <>
              <button type="button" onClick={() => setEditing(undefined)} disabled={rowBusy}>Cancel</button>
              <button type="button" className="primary" onClick={() => void saveDates(row)} disabled={rowBusy}>{rowBusy ? "Saving…" : "Save dates"}</button>
            </>}
          </div>
          {isEditing && <div className="bulk-order-editor">
            <div className="bulk-editor-grid">
              <label>Collection date<input type="date" value={text(payload.collectionDate)} onChange={(event) => setEditing((current) => current ? { ...current, payload: { ...current.payload, collectionDate: event.target.value } } : current)} /></label>
              <label>Delivery date<input type="date" value={text(payload.deliveryDate)} onChange={(event) => setEditing((current) => current ? { ...current, payload: { ...current.payload, deliveryDate: event.target.value } } : current)} /></label>
            </div>
            <div className="bulk-source-line">
              <span><strong>Source:</strong> {evidence.subject || row.item.source || "Order intake"}</span>
              {hasSource && <button type="button" onClick={() => setSourceEmailStagingId(row.item.id)}>Review source email</button>}
            </div>
          </div>}
        </article>;
      })}
    </div>}

    {sourceEmailStagingId && <SourceEmailEvidenceDrawer stagingId={sourceEmailStagingId} onClose={() => setSourceEmailStagingId(undefined)} />}
  </section>;
}
