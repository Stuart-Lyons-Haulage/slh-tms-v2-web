import { useCallback, useState } from "react";
import { api, type OrderConfirmationItem } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

/**
 * Confirmation queue: lists orders awaiting confirmation for a given date
 * and lets TmsApprove users confirm or reject them in bulk before they
 * can be allocated to runs.
 */
export function OrderConfirmationQueue({ date }: { date: string }) {
  const token = useAccessToken();
  const queue = useApi(
    useCallback(async () => api.ordersAwaitingConfirmation(date, await token()), [date, token])
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  const orders = queue.data?.orders ?? [];
  const allSelected = orders.length > 0 && selected.size === orders.length;

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(orders.map(o => o.id)));
  }

  async function act(action: "confirm" | "reject") {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = action === "confirm"
        ? await api.confirmOrders(ids, await token())
        : await api.rejectOrders(ids, await token());
      setNotice(result.message);
      setSelected(new Set());
      await queue.refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : `Could not ${action} orders.`);
    } finally {
      setBusy(false);
    }
  }

  if (queue.loading) return <p className="state">Loading confirmation queue…</p>;
  if (queue.error) return <p className="state error">{queue.error}</p>;
  if (!orders.length)
    return (
      <div className="panel" style={{ padding: 16 }}>
        <p className="hint">No orders are awaiting confirmation for {date}. All orders for this date have either been confirmed or rejected.</p>
      </div>
    );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <strong>{orders.length} order{orders.length === 1 ? "" : "s"} awaiting confirmation</strong>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={!selected.size || busy} className="primary" onClick={() => void act("confirm")}>
          {busy ? "Working…" : `Confirm ${selected.size || ""}`}
        </button>
        <button type="button" disabled={!selected.size || busy} onClick={() => void act("reject")}>
          Reject {selected.size || ""}
        </button>
        <button type="button" onClick={() => void queue.refresh()} disabled={busy}>Refresh</button>
      </div>
      {notice && <p className="notice inline-notice">{notice}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th>Reference</th>
              <th>Customer</th>
              <th>Collection</th>
              <th>Delivery</th>
              <th>Pallets</th>
              <th>Market</th>
              <th>Seller</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order: OrderConfirmationItem) => (
              <tr key={order.id} className={selected.has(order.id) ? "selected-row" : ""}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(order.id)}
                    onChange={() => toggle(order.id)}
                    aria-label={`Select ${order.reference}`}
                  />
                </td>
                <td><strong>{order.reference}</strong></td>
                <td>{order.customerCode}</td>
                <td>{order.collectionDate}</td>
                <td>{order.deliveryDate || "—"}</td>
                <td>{order.pallets}</td>
                <td>{order.marketName || "—"}</td>
                <td>{order.sellerName || "—"}</td>
                <td>{order.createdAtUtc ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.createdAtUtc)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
