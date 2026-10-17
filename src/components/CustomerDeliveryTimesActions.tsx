import { useEffect, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../customer-load-plans.css";

type DeliveryTimeRow = {
  orderReference: string;
  deliverySite: string;
  pallets?: number;
  vehicleRegistration?: string;
  plannedDelivery?: string;
  liveEta?: string;
  etaRisk?: string;
  etaAsAt?: string;
  status: string;
};

type CustomerDeliveryTimes = {
  customerCode: string;
  customerName: string;
  planningDate: string;
  subject: string;
  to: string[];
  rows: DeliveryTimeRow[];
  lastSendStatus?: string;
  lastSentAtUtc?: string;
};

type DeliveryTimesResponse = {
  planningDate: string;
  generatedAtUtc: string;
  customers: CustomerDeliveryTimes[];
  warnings: string[];
};

function recipients(value: string) {
  return value.split(/[;,\n]+/).map(item => item.trim()).filter(Boolean);
}

function localSentTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Replaces the hand-built "Daily Times" / "Aldi Times" emails: each customer's planned
 * deliveries with the latest live ETA from tracking, sent from the Info mailbox through
 * the same outbox as the load plans.
 */
export function CustomerDeliveryTimesActions({ date }: { date: string }) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DeliveryTimesResponse>();
  const [to, setTo] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busyCustomer, setBusyCustomer] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const result = await request<DeliveryTimesResponse>(`/api/v1/customer-load-plans/delivery-times?date=${encodeURIComponent(date)}`, await token());
      setData(result);
      setTo(Object.fromEntries(result.customers.map(customer => [customer.customerCode, customer.to.join("; ")])));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Delivery times could not be prepared.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date]);

  const withEta = useMemo(() => data?.customers.reduce((sum, customer) => sum + customer.rows.filter(row => row.liveEta).length, 0) || 0, [data]);

  async function send(customer: CustomerDeliveryTimes) {
    const recipientList = recipients(to[customer.customerCode] || "");
    if (recipientList.length === 0) {
      setError(`Add at least one recipient for ${customer.customerName}.`);
      return;
    }
    if (!window.confirm(`Send ${customer.subject} to ${recipientList.join(", ")} from info@lyonshaulage.com?`)) return;
    setBusyCustomer(customer.customerCode);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await request<{ message?: string }>("/api/v1/customer-load-plans/delivery-times/queue", await token(), {
        method: "POST",
        body: JSON.stringify({ planningDate: date, customerCode: customer.customerCode, to: recipientList }),
      });
      setNotice(result.message || `${customer.customerName} delivery times queued to the Info mailbox.`);
      await load();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Delivery times could not be queued.");
    } finally {
      setBusyCustomer(undefined);
    }
  }

  return <>
    <button type="button" className="customer-load-plan-launch" onClick={() => setOpen(true)}>
      Delivery times &amp; ETAs
    </button>

    {open && <div className="load-plan-modal-backdrop" role="dialog" aria-modal="true" aria-label="Customer delivery times">
      <section className="load-plan-modal">
        <div className="load-plan-modal-head">
          <div>
            <p className="eyebrow">Dispatch → customer communication</p>
            <h2>Delivery times &amp; live ETAs</h2>
            <p className="hint">Planned delivery times for {date} with the latest live ETA from tracking. Sent from the Info shared mailbox with the load plan attached.</p>
          </div>
          <div className="load-plan-head-actions">
            <span><strong>{data?.customers.length || 0}</strong> customers · <strong>{withEta}</strong> live ETAs</span>
            <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh ETAs"}</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>

        {notice && <p className="notice inline-notice">{notice}</p>}
        {error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}
        {data?.warnings?.map((warning, index) => <p className="load-plan-warning" key={`${warning}-${index}`}>{warning}</p>)}
        {loading && !data && <div className="state">Reading planned deliveries and live ETAs…</div>}
        {!loading && data && data.customers.length === 0 && <div className="state">No customer deliveries are planned on runs for this date yet.</div>}

        <div className="load-plan-cards">
          {data?.customers.map(customer => {
            const busy = busyCustomer === customer.customerCode;
            const recipientText = to[customer.customerCode] ?? customer.to.join("; ");
            return <article className="load-plan-card" key={customer.customerCode}>
              <div className="load-plan-card-title">
                <div>
                  <span className="load-plan-customer-code">{customer.customerCode}</span>
                  <h3>{customer.customerName}</h3>
                  <small>{customer.rows.length} deliver{customer.rows.length === 1 ? "y" : "ies"}</small>
                </div>
                <div className="load-plan-state">
                  {customer.lastSendStatus && <span className={`load-plan-state-pill ${customer.lastSendStatus.toLowerCase()}`}>{customer.lastSendStatus}</span>}
                  {customer.lastSentAtUtc && <small>{localSentTime(customer.lastSentAtUtc)}</small>}
                </div>
              </div>

              <div className="load-plan-mini-table">
                <div className="load-plan-mini-head"><span>Delivery</span><span>Order</span><span>Pallets</span><span>Planned</span><span>Live ETA</span></div>
                {customer.rows.map(row => <div className="load-plan-mini-row" key={`${row.orderReference}-${row.deliverySite}`}>
                  <strong>{row.deliverySite}</strong>
                  <span>{row.orderReference}<small>{row.vehicleRegistration || "Vehicle not set"}</small></span>
                  <span>{row.pallets ?? "—"}</span>
                  <span>{row.plannedDelivery || "—"}</span>
                  <span>{row.liveEta || "No live ETA yet"}{row.etaAsAt && <small>as at {row.etaAsAt}{row.etaRisk ? ` · ${row.etaRisk}` : ""}</small>}</span>
                </div>)}
              </div>

              <div className="load-plan-email-grid">
                <label className="load-plan-subject">To<input value={recipientText} placeholder="customer@example.com; another@example.com" onChange={event => setTo(current => ({ ...current, [customer.customerCode]: event.target.value }))} /></label>
              </div>

              <div className="load-plan-card-actions">
                <span>{customer.subject} · from <strong>info@lyonshaulage.com</strong></span>
                <button className="primary" type="button" onClick={() => void send(customer)} disabled={busy || recipients(recipientText).length === 0}>
                  {busy ? "Queuing…" : "SEND DELIVERY TIMES"}
                </button>
              </div>
            </article>;
          })}
        </div>
      </section>
    </div>}
  </>;
}
