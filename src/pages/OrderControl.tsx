import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { SILENT_API_REFRESH_EVENT } from "../lib/useApi";
import { startVisiblePolling } from "../lib/visiblePolling";
import { SourceEmailEvidenceDrawer } from "../components/SourceEmailEvidenceDrawer";
import { JobsOperational } from "./JobsOperational";
import { OrderReviewBulk } from "./OrderReviewBulk";
import { UndatedOrderReviewQueue } from "./UndatedOrderReviewQueue";

type OrderControlTab = "review" | "live";
type NwfRepairResponse = { repaired: number; message: string };

type CachedEmailRecord = {
  evidenceId: string;
  idempotencyKey?: string;
  receivedAtUtc?: string;
  messageId?: string;
  senderAddress?: string;
  subject?: string;
  attachmentCount?: number;
  nonInlineAttachmentCount?: number;
  existingOrderCount?: number;
  canForceReview?: boolean;
  candidateCustomer?: string;
  candidateDate?: string;
};

type CachedEmailResponse = {
  fromUtc?: string;
  toUtc?: string;
  count: number;
  records: CachedEmailRecord[];
};

type ForceReviewResponse = {
  checkedEvidence?: number;
  results?: Array<{
    status?: string;
    stagedImportId?: string;
    messageId?: string;
    subject?: string;
    senderAddress?: string;
    reason?: string;
  }>;
  status?: string;
  stagedImportId?: string;
};

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cacheWindowForPlanningDate(date: string) {
  // Orders for tomorrow often arrive today, so use the day before through to the day after.
  return {
    fromUtc: `${addDays(date, -1)}T00:00:00Z`,
    toUtc: `${addDays(date, 1)}T00:00:00Z`
  };
}

function formatShortDateTime(value?: string) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function refreshVisibleReviewData() {
  window.dispatchEvent(new Event(SILENT_API_REFRESH_EVENT));
}

function OrderIntakeCacheRecovery({ date }: { date: string }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forcing, setForcing] = useState<string | "all" | undefined>();
  const [data, setData] = useState<CachedEmailResponse>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const window = useMemo(() => cacheWindowForPlanningDate(date), [date]);

  const missing = (data?.records ?? []).filter(item => item.canForceReview || (item.existingOrderCount ?? 0) === 0);

  async function loadCache() {
    setLoading(true);
    setError(undefined);
    try {
      const result = await request<CachedEmailResponse>(`/api/v1/order-intake/cache?fromUtc=${encodeURIComponent(window.fromUtc)}&toUtc=${encodeURIComponent(window.toUtc)}&take=1000`, await token());
      setData(result);
      setNotice(`${result.count} cached emails found · ${result.records.filter(item => (item.existingOrderCount ?? 0) === 0).length} with no order row.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load cached intake emails.");
    } finally {
      setLoading(false);
    }
  }

  async function forceOne(evidenceId: string) {
    setForcing(evidenceId);
    setError(undefined);
    try {
      const result = await request<ForceReviewResponse>(`/api/v1/order-intake/cache/${evidenceId}/force-review`, await token(), { method: "POST" });
      setNotice(result.stagedImportId ? "Cached email forced into Pending Review." : `Force review result: ${result.status ?? "completed"}.`);
      await loadCache();
      refreshVisibleReviewData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not force this cached email into review.");
    } finally {
      setForcing(undefined);
    }
  }

  async function forceAll() {
    if (!missing.length) return;
    setForcing("all");
    setError(undefined);
    try {
      const result = await request<ForceReviewResponse>(`/api/v1/order-intake/cache/force-review?fromUtc=${encodeURIComponent(window.fromUtc)}&toUtc=${encodeURIComponent(window.toUtc)}&take=1000`, await token(), { method: "POST" });
      const created = (result.results ?? []).filter(item => item.status === "created_manual_review_order").length;
      const existing = (result.results ?? []).filter(item => item.status === "existing_order_found" || item.status === "manual_review_already_created").length;
      setNotice(`Recovery complete: ${created} forced into Pending Review, ${existing} already had orders.`);
      await loadCache();
      refreshVisibleReviewData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not force cached emails into review.");
    } finally {
      setForcing(undefined);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date]);

  return <section className="panel" style={{ marginBottom: 18, borderColor: missing.length ? "#e8b84d" : undefined }}>
    <div className="title-row" style={{ alignItems: "center", gap: 12 }}>
      <div>
        <p className="eyebrow">Intake recovery</p>
        <h2 style={{ margin: 0 }}>Cached emails / manual push</h2>
        <p className="hint" style={{ margin: "4px 0 0" }}>Looks back from {window.fromUtc.slice(0, 10)} to {window.toUtc.slice(0, 10)} so today’s emails for tomorrow’s plan can be forced into review.</p>
      </div>
      <div className="title-actions" style={{ gap: 8, flexWrap: "wrap" }}>
        {data && <span className={missing.length ? "status warning" : "status approved"}>{missing.length} missing order rows</span>}
        <button type="button" onClick={() => setOpen(value => !value)}>{open ? "Hide cached emails" : "Show cached emails"}</button>
        {open && <button type="button" onClick={loadCache} disabled={loading}>{loading ? "Checking…" : "Refresh cache"}</button>}
        {open && <button type="button" className="primary" onClick={forceAll} disabled={forcing !== undefined || missing.length === 0}>{forcing === "all" ? "Forcing…" : `Force all missing (${missing.length})`}</button>}
      </div>
    </div>
    {notice && <p className="notice inline-notice" style={{ marginTop: 12 }}>{notice}</p>}
    {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
    {open && <div style={{ marginTop: 12 }}>
      {loading && !data && <div className="state">Checking cached emails…</div>}
      {!loading && data && data.records.length === 0 && <div className="state">No cached email evidence found for this window. That points back to the Power Automate trigger or submit step.</div>}
      {data && data.records.length > 0 && <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Sender</th>
              <th>Subject</th>
              <th>Attachments</th>
              <th>Orders</th>
              <th>Likely date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.records.map(record => {
              const noOrder = (record.existingOrderCount ?? 0) === 0;
              return <tr key={record.evidenceId}>
                <td>{formatShortDateTime(record.receivedAtUtc)}</td>
                <td>{record.senderAddress ?? "Unknown"}</td>
                <td><strong>{record.subject ?? "No subject"}</strong><br /><span className="hint">{record.candidateCustomer ?? "Unmatched customer"}</span></td>
                <td>{record.nonInlineAttachmentCount ?? record.attachmentCount ?? 0}</td>
                <td><span className={noOrder ? "status warning" : "status approved"}>{record.existingOrderCount ?? 0}</span></td>
                <td>{record.candidateDate ?? "Unknown"}</td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" onClick={() => forceOne(record.evidenceId)} disabled={forcing !== undefined || !noOrder}>{forcing === record.evidenceId ? "Forcing…" : noOrder ? "Force to review" : "Already staged"}</button>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
    </div>}
  </section>;
}

export function OrderControl({ initialTab = "review" }: { initialTab?: OrderControlTab }) {
  const token = useAccessToken();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<OrderControlTab>(initialTab);
  const [repairNotice, setRepairNotice] = useState<string>();
  const reviewId = searchParams.get("reviewId")?.trim() || undefined;
  const sourceEmailStagingId = searchParams.get("sourceEmail") === "1" ? reviewId : undefined;
  const selectedDate = searchParams.get("date") || localDate();

  useEffect(() => { if (reviewId) setTab("review"); }, [reviewId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await request<NwfRepairResponse>("/api/v1/staging/orders/repair-nwf-references", await token(), { method: "POST" });
        if (!active || result.repaired <= 0) return;
        setRepairNotice(result.message);
        refreshVisibleReviewData();
      } catch { /* compatibility repair is optional; normal review loading remains authoritative */ }
    })();
    return () => { active = false; };
  }, [token]);

  useEffect(() => startVisiblePolling(refreshVisibleReviewData, 60_000), []);

  function updateDate(nextDate: string) {
    const next = new URLSearchParams(searchParams);
    if (nextDate) next.set("date", nextDate);
    else next.delete("date");
    setSearchParams(next, { replace: true });
  }

  function closeSourceEmail() {
    const next = new URLSearchParams(searchParams);
    next.delete("sourceEmail");
    setSearchParams(next, { replace: true });
  }

  return <>
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="title-row" style={{ alignItems: "end", gap: 16 }}>
        <div>
          <p className="eyebrow">Order control</p>
          <h1>Manage imported jobs</h1>
        </div>
        <div className="title-actions" style={{ alignItems: "center", gap: 8 }}>
          <label className="dashboard-date">Date <input type="date" value={selectedDate} onChange={(event) => updateDate(event.target.value)} /></label>
          <div role="tablist" aria-label="Order control view" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className={tab === "review" ? "primary" : ""} onClick={() => setTab("review")} role="tab" aria-selected={tab === "review"}>Waiting for review</button>
            <button type="button" className={tab === "live" ? "primary" : ""} onClick={() => setTab("live")} role="tab" aria-selected={tab === "live"}>Approved / live loads</button>
          </div>
        </div>
      </div>
      {repairNotice && <p className="notice inline-notice" style={{ marginBottom: 0 }}>{repairNotice}</p>}
    </section>
    {tab === "review" ? <><OrderIntakeCacheRecovery date={selectedDate} /><UndatedOrderReviewQueue /><OrderReviewBulk date={selectedDate} /></> : <JobsOperational date={selectedDate} />}
    {sourceEmailStagingId && <SourceEmailEvidenceDrawer stagingId={sourceEmailStagingId} onClose={closeSourceEmail} />}
  </>;
}
