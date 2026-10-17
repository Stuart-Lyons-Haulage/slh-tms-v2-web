import { useEffect, useState } from "react";
import { api, type CustomerCommunication } from "../lib/api";
import { useAccessToken } from "../lib/auth";

const purposeLabels: Record<string, string> = {
  Request: "Request",
  EtaUpdate: "ETA",
  Exception: "Delay / issue",
  BookingChange: "Booking change",
  LoadPlan: "Load plan",
  Other: "Message",
};

function received(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Customer emails that are not new orders: requests ("push back all collections"),
 * ETA chases, and depots dropped from a resent booking. Each is linked to the orders in
 * the same email thread, and pending orders also show it as a review warning.
 */
export function CustomerMessagesPanel() {
  const token = useAccessToken();
  const [items, setItems] = useState<CustomerCommunication[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      setItems(await api.customerCommunications(await token(), "PendingReview", undefined, 100));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Customer messages could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markDone(item: CustomerCommunication) {
    setBusyId(item.id);
    setError(undefined);
    try {
      await api.approveCustomerCommunication(item.id, "Handled by planning", await token());
      setItems(current => current.filter(entry => entry.id !== item.id));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The message could not be marked as handled.");
    } finally {
      setBusyId(undefined);
    }
  }

  return <section className="customer-messages" aria-label="Customer messages">
    <div className="customer-messages-head">
      <div>
        <h3>Customer messages</h3>
        <p className="hint">Requests, ETA chases and booking changes from the Info mailbox that are not new orders. Mark each one done once it is dealt with.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    {error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}
    {!loading && items.length === 0 && <div className="state">No customer messages waiting.</div>}
    <ul className="customer-message-list">
      {items.map(item => {
        const purpose = item.payload.extraction?.purpose || "Other";
        const source = item.payload.source || {};
        const linked = item.payload.linkedOrders || [];
        return <li className={`customer-message purpose-${purpose.toLowerCase()}`} key={item.id}>
          <div className="customer-message-meta">
            <span className="customer-message-pill">{purposeLabels[purpose] || purpose}</span>
            <strong>{source.senderName || source.senderAddress || "Unknown sender"}</strong>
            <small>{received(source.receivedAtUtc || item.receivedAtUtc)}</small>
          </div>
          <div className="customer-message-subject">{source.subject || "(no subject)"}</div>
          {item.payload.ownText && <p className="customer-message-text">{item.payload.ownText}</p>}
          {linked.length > 0 && <div className="customer-message-orders">
            Linked to {linked.length} order{linked.length === 1 ? "" : "s"}: {linked.map(order => [order.reference, order.destination].filter(Boolean).join(" ")).filter(Boolean).join(", ") || "see Order Review"}
          </div>}
          <div className="customer-message-actions">
            {source.webLink && <a href={source.webLink} target="_blank" rel="noreferrer">Open email</a>}
            <button type="button" onClick={() => void markDone(item)} disabled={busyId === item.id}>{busyId === item.id ? "Saving…" : "Done"}</button>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
