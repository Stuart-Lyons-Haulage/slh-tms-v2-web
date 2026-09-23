import { useEffect, useMemo, useState } from "react";
import { apiBaseUrl, request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../customer-load-plans.css";

type LoadPlanRow = {
  loadId: string;
  loadReference: string;
  orderId: string;
  orderReference: string;
  customerCode: string;
  collectionSite: string;
  deliverySite: string;
  pallets?: number;
  plannedCollectTime?: string;
  deliveryDeadline?: string;
  driverName?: string;
  vehicleRegistration?: string;
  trailerNumber?: string;
  status: string;
  notes?: string;
};

type CustomerPlan = {
  customerCode: string;
  customerName: string;
  planningDate: string;
  subject: string;
  body: string;
  attachmentName: string;
  to: string[];
  cc: string[];
  rows: LoadPlanRow[];
  totalPallets: number;
  lastSendStatus?: string;
  lastSentAtUtc?: string;
};

type PreviewResponse = {
  planningDate: string;
  generatedAtUtc: string;
  plans: CustomerPlan[];
  warnings: string[];
};

type Draft = { to: string; cc: string; subject: string; body: string };

function recipientText(values?: string[]) {
  return (values || []).join("; ");
}
function recipients(value: string) {
  return value.split(/[;,\n]+/).map(item => item.trim()).filter(Boolean);
}
function localSentTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

export function CustomerLoadPlanActions({ date }: { date: string }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PreviewResponse>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [busyCustomer, setBusyCustomer] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function loadPreview() {
    setLoading(true);
    setError(undefined);
    try {
      const result = await request<PreviewResponse>(`/api/v1/customer-load-plans/preview?date=${encodeURIComponent(date)}`, await token());
      setData(result);
      setDrafts(Object.fromEntries(result.plans.map(plan => [plan.customerCode, {
        to: recipientText(plan.to),
        cc: recipientText(plan.cc),
        subject: plan.subject,
        body: plan.body,
      }])));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Customer load plans could not be prepared.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadPreview();
    // The selected Dispatch date is the only input that should refresh an open preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date]);

  const readyCount = useMemo(() => data?.plans.filter(plan => recipients(drafts[plan.customerCode]?.to || "").length > 0).length || 0, [data, drafts]);

  async function previewPdf(plan: CustomerPlan) {
    setBusyCustomer(plan.customerCode);
    setError(undefined);
    try {
      const access = await token();
      const response = await fetch(`${apiBaseUrl}/api/v1/customer-load-plans/pdf?date=${encodeURIComponent(date)}&customerCode=${encodeURIComponent(plan.customerCode)}`, {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(detail?.message || `PDF preview failed (${response.status}).`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) throw new Error("The browser blocked the PDF preview window. Allow pop-ups for the TMS and try again.");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "PDF preview could not be opened.");
    } finally {
      setBusyCustomer(undefined);
    }
  }

  async function queue(plan: CustomerPlan) {
    const draft = drafts[plan.customerCode];
    const to = recipients(draft?.to || "");
    if (to.length === 0) {
      setError(`Add at least one recipient for ${plan.customerName}.`);
      return;
    }
    if (!window.confirm(`Send ${plan.attachmentName} to ${to.join(", ")} from info@lyonshaulage.com?`)) return;

    setBusyCustomer(plan.customerCode);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await request<{ message?: string }>("/api/v1/customer-load-plans/queue", await token(), {
        method: "POST",
        body: JSON.stringify({
          planningDate: date,
          customerCode: plan.customerCode,
          to,
          cc: recipients(draft?.cc || ""),
          subject: draft?.subject || plan.subject,
          body: draft?.body || plan.body,
        }),
      });
      setNotice(result.message || `${plan.customerName} load plan queued to the Info mailbox.`);
      await loadPreview();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The load plan could not be queued.");
    } finally {
      setBusyCustomer(undefined);
    }
  }

  return <>
    <button type="button" className="customer-load-plan-launch" onClick={() => setOpen(true)}>
      Customer load plans
    </button>

    {open && <div className="load-plan-modal-backdrop" role="dialog" aria-modal="true" aria-label="Customer load plans">
      <section className="load-plan-modal">
        <div className="load-plan-modal-head">
          <div>
            <p className="eyebrow">Dispatch → customer communication</p>
            <h2>Customer load plans</h2>
            <p className="hint">Built from the live Dispatch plan for {date}. Review the recipients and PDF, then send from the Info shared mailbox.</p>
          </div>
          <div className="load-plan-head-actions">
            <span><strong>{data?.plans.length || 0}</strong> customers · <strong>{readyCount}</strong> ready</span>
            <button type="button" onClick={() => void loadPreview()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>

        {notice && <p className="notice inline-notice">{notice}</p>}
        {error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}
        {data?.warnings?.map((warning, index) => <p className="load-plan-warning" key={`${warning}-${index}`}>{warning}</p>)}
        {loading && !data && <div className="state">Building customer load plans from Dispatch…</div>}
        {!loading && data && data.plans.length === 0 && <div className="state">No customer-linked planned movements are ready for load-plan export on this date.</div>}

        <div className="load-plan-cards">
          {data?.plans.map(plan => {
            const draft = drafts[plan.customerCode] || { to: recipientText(plan.to), cc: recipientText(plan.cc), subject: plan.subject, body: plan.body };
            const busy = busyCustomer === plan.customerCode;
            return <article className="load-plan-card" key={plan.customerCode}>
              <div className="load-plan-card-title">
                <div>
                  <span className="load-plan-customer-code">{plan.customerCode}</span>
                  <h3>{plan.customerName}</h3>
                  <small>{plan.rows.length} movement{plan.rows.length === 1 ? "" : "s"} · {plan.totalPallets} pallets</small>
                </div>
                <div className="load-plan-state">
                  {plan.lastSendStatus && <span className={`load-plan-state-pill ${plan.lastSendStatus.toLowerCase()}`}>{plan.lastSendStatus}</span>}
                  {plan.lastSentAtUtc && <small>{localSentTime(plan.lastSentAtUtc)}</small>}
                </div>
              </div>

              <div className="load-plan-attachment">
                <span className="load-plan-file-icon">PDF</span>
                <div><strong>{plan.attachmentName}</strong><small>SLH branded live plan · generated from {plan.rows.length} order movement{plan.rows.length === 1 ? "" : "s"}</small></div>
                <button type="button" onClick={() => void previewPdf(plan)} disabled={busy}>{busy ? "Working…" : "Preview PDF"}</button>
              </div>

              <div className="load-plan-mini-table">
                <div className="load-plan-mini-head"><span>Run</span><span>Movement</span><span>Pallets</span><span>Collect</span><span>Allocation</span></div>
                {plan.rows.slice(0, 8).map(row => <div className="load-plan-mini-row" key={`${row.loadId}-${row.orderId}`}>
                  <strong>{row.loadReference}</strong>
                  <span title={`${row.collectionSite} → ${row.deliverySite}`}>{row.collectionSite} → {row.deliverySite}<small>{row.orderReference}</small></span>
                  <span>{row.pallets ?? "—"}</span>
                  <span>{row.plannedCollectTime || "—"}</span>
                  <span>{row.driverName || "Unallocated"}<small>{[row.vehicleRegistration, row.trailerNumber].filter(Boolean).join(" · ") || "Vehicle/trailer not set"}</small></span>
                </div>)}
                {plan.rows.length > 8 && <div className="load-plan-more">+ {plan.rows.length - 8} more movements in the PDF</div>}
              </div>

              <div className="load-plan-email-grid">
                <label>To<input value={draft.to} placeholder="customer@example.com; another@example.com" onChange={event => setDrafts(current => ({ ...current, [plan.customerCode]: { ...draft, to: event.target.value } }))} /></label>
                <label>Cc<input value={draft.cc} placeholder="Optional" onChange={event => setDrafts(current => ({ ...current, [plan.customerCode]: { ...draft, cc: event.target.value } }))} /></label>
                <label className="load-plan-subject">Subject<input value={draft.subject} onChange={event => setDrafts(current => ({ ...current, [plan.customerCode]: { ...draft, subject: event.target.value } }))} /></label>
                <label className="load-plan-body">Email<textarea rows={6} value={draft.body} onChange={event => setDrafts(current => ({ ...current, [plan.customerCode]: { ...draft, body: event.target.value } }))} /></label>
              </div>

              <div className="load-plan-card-actions">
                <span>From <strong>info@lyonshaulage.com</strong></span>
                <button className="primary" type="button" onClick={() => void queue(plan)} disabled={busy || recipients(draft.to).length === 0}>
                  {busy ? "Queuing…" : "SEND FROM INFO MAILBOX"}
                </button>
              </div>
            </article>;
          })}
        </div>
      </section>
    </div>}
  </>;
}
