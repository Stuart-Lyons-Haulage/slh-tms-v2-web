import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { SILENT_API_REFRESH_EVENT } from "../lib/useApi";
import { startVisiblePolling } from "../lib/visiblePolling";
import { SourceEmailEvidenceDrawer } from "../components/SourceEmailEvidenceDrawer";
import { JobsOperational } from "./JobsOperational";
import { OrderReviewBulk } from "./OrderReviewBulk";
import { UndatedOrderReviewQueue } from "./UndatedOrderReviewQueue";
import { listRuns } from "../api/runs";
import { tomorrowIsoDate } from "../lib/dateUtils";
import type { Load, TransportOrder } from "../lib/api";

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

type RetainedReplayResponse = {
  eligibleOrders: number;
  pendingAfterReplay: number;
  legacyMappingExceptionsArchived: number;
  hasMore: boolean;
  nextAfterReceivedAtUtc?: string;
  nextAfterEvidenceId?: string;
};

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

function OrderReviewDateStrip({ selectedDate, onChange }: { selectedDate: string; onChange: (date: string) => void }) {
  const token = useAccessToken();
  const dates = useMemo(() => Array.from({ length: 11 }, (_, index) => addDays(selectedDate, index - 5)), [selectedDate]);
  const [counts, setCounts] = useState<Record<string, number | undefined>>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await request<Record<string, number>>(
          `/api/v1/staging/queue/date-counts?from=${encodeURIComponent(dates[0])}&to=${encodeURIComponent(dates.at(-1) || dates[0])}`,
          await token(),
        );
        if (active) setCounts(result);
      } catch {
        if (active) setCounts(Object.fromEntries(dates.map((date) => [date, undefined])));
      }
    })();
    return () => { active = false; };
  }, [dates, token]);

  useEffect(() => {
    const refresh = () => {
      void token().then(async (authToken) => {
        const result = await request<Record<string, number>>(
          `/api/v1/staging/queue/date-counts?from=${encodeURIComponent(dates[0])}&to=${encodeURIComponent(dates.at(-1) || dates[0])}`,
          authToken,
        );
        setCounts(result);
      }).catch(() => undefined);
    };
    window.addEventListener(SILENT_API_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(SILENT_API_REFRESH_EVENT, refresh);
  }, [dates, token]);

  return <div className="order-date-strip" aria-label="Pending order dates">
    {dates.map((date) => {
      const value = new Date(`${date}T12:00:00`);
      const count = counts[date];
      const selected = date === selectedDate;
      return <button key={date} type="button" className={`${count ? "has-orders" : "empty"} ${selected ? "selected" : ""}`} onClick={() => onChange(date)} aria-pressed={selected} title={`${date}: ${count == null ? "checking" : `${count} pending order${count === 1 ? "" : "s"}`}`}>
        <span>{new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(value)}</span>
        <strong>{value.getDate()}</strong>
        <small>{new Intl.DateTimeFormat("en-GB", { month: "short" }).format(value)}</small>
        <b>{count == null ? "…" : count}</b>
        <em>{count === 1 ? "order" : "orders"}</em>
      </button>;
    })}
  </div>;
}

export function ApprovedOrdersList({ date, token }: { date: string; token: ReturnType<typeof useAccessToken> }) {
  const [orders, setOrders] = useState<TransportOrder[]>([]);
  const [runs, setRuns] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const authToken = await token();
      const [liveOrders, liveRuns] = await Promise.all([
        request<TransportOrder[]>(`/api/v1/orders?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`, authToken),
        listRuns(date, authToken),
      ]);
      setOrders(liveOrders.filter(order => order.status !== "Cancelled"));
      setRuns(liveRuns);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Approved orders could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [date, token]);

  useEffect(() => {
    let active = true;
    void refresh();
    const timer = window.setInterval(() => { if (active) void refresh(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);

  const runByOrderId = new Map(runs.flatMap(run => run.stops
    .filter(stop => stop.orderId)
    .map(stop => [stop.orderId!, run] as const)));

  return <section className="panel" style={{ marginBottom: 18 }}>
    <div className="title-row"><div><p className="eyebrow">Operational order handover</p><h2>Approved orders through dispatch</h2><p className="hint">Live orders for {date}, linked to their current run until dispatch. Refreshes every 30 seconds.</p></div><div className="title-actions" style={{ alignItems: "center", gap: 8 }}><strong>{orders.length} order{orders.length === 1 ? "" : "s"}</strong><button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></div>
    {error && <p className="review-error">{error}</p>}
    {!loading && !error && orders.length === 0 && <div className="state">No approved live orders are recorded for this date.</div>}
    {orders.length > 0 && <div style={{ overflowX: "auto" }}><table className="master-table"><thead><tr><th>Order status</th><th>Customer</th><th>Reference</th><th>Collection</th><th>Delivery</th><th>Quantity</th><th>Run</th><th>Run status</th></tr></thead><tbody>{orders.map(order => { const run = runByOrderId.get(order.id); return <tr key={order.id}><td><span className={`status ${order.status.toLowerCase().replaceAll(" ", "-")}`}>{order.status}</span></td><td>{order.customerCode}</td><td>{order.reference || order.poNumber || "—"}</td><td>{order.sellerName || order.collectionLocation || "—"}</td><td>{order.marketName || order.deliveryLocation || "—"}</td><td>{order.pallets ?? order.cases ?? order.trays ?? order.trolleys ?? "—"}</td><td>{run?.reference || "Awaiting run"}</td><td>{run ? <span className={`status ${run.status.toLowerCase().replaceAll(" ", "-")}`}>{run.status}</span> : "Not yet planned"}</td></tr>; })}</tbody></table></div>}
  </section>;
}

function OrderIntakeCacheRecovery({ date }: { date: string }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forcing, setForcing] = useState<string | "all" | undefined>();
  const [replaying, setReplaying] = useState(false);
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

  async function replayRetainedEvidence() {
    setReplaying(true);
    setError(undefined);
    try {
      const authToken = await token();
      const baseRequest = {
        receivedFromUtc: `${addDays(date, -2)}T00:00:00Z`,
        minimumPlanningDate: date,
        maximumPlanningDate: date,
        refreshUnamendedPending: true,
        maxMessages: 5
      };
      let afterReceivedAtUtc: string | undefined;
      let afterEvidenceId: string | undefined;
      let eligibleOrders = 0;
      let pendingAfterReplay = 0;
      let archived = 0;
      let batches = 0;
      let hasMore = true;

      while (hasMore) {
        const result = await request<RetainedReplayResponse>("/api/v1/order-intake/replay-retained-evidence", authToken, {
          method: "POST",
          body: JSON.stringify({ ...baseRequest, afterReceivedAtUtc, afterEvidenceId })
        });
        batches += 1;
        eligibleOrders += result.eligibleOrders;
        pendingAfterReplay = result.pendingAfterReplay;
        archived += result.legacyMappingExceptionsArchived;
        hasMore = result.hasMore;
        afterReceivedAtUtc = result.nextAfterReceivedAtUtc;
        afterEvidenceId = result.nextAfterEvidenceId;
        if (hasMore && (!afterReceivedAtUtc || !afterEvidenceId)) {
          throw new Error("Replay continuation cursor was missing.");
        }
        if (batches > 500) throw new Error("Replay exceeded the safe batch limit.");
      }

      setNotice(`Re-parse complete: ${eligibleOrders} order${eligibleOrders === 1 ? "" : "s"} matched for ${date}; ${pendingAfterReplay} awaiting review; ${archived} legacy mapping exception${archived === 1 ? "" : "s"} archived.`);
      await loadCache();
      refreshVisibleReviewData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retained evidence could not be re-parsed.");
    } finally {
      setReplaying(false);
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
        <button type="button" onClick={() => void replayRetainedEvidence()} disabled={replaying || forcing !== undefined || loading}>{replaying ? "Re-parsing…" : `Re-parse ${date}`}</button>
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
  const selectedDate = searchParams.get("date") || tomorrowIsoDate();

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

  useEffect(() => startVisiblePolling(refreshVisibleReviewData, 15_000), []);

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
            <button type="button" className={tab === "live" ? "primary" : ""} onClick={() => setTab("live")} role="tab" aria-selected={tab === "live"}>Approved / promoted orders</button>
          </div>
        </div>
      </div>
      {repairNotice && <p className="notice inline-notice" style={{ marginBottom: 0 }}>{repairNotice}</p>}
    </section>
    <OrderReviewDateStrip selectedDate={selectedDate} onChange={updateDate} />
    {tab === "review" ? <><OrderIntakeCacheRecovery date={selectedDate} /><UndatedOrderReviewQueue /><OrderReviewBulk date={selectedDate} /></> : <><ApprovedOrdersList date={selectedDate} token={token} /><JobsOperational date={selectedDate} /></>}
    {sourceEmailStagingId && <SourceEmailEvidenceDrawer stagingId={sourceEmailStagingId} onClose={closeSourceEmail} />}
  </>;
}
