import { useCallback, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useTmsQuery } from "../lib/useTmsQuery";
import { workingDateLabel } from "../lib/workingDate";

export type PastDatedOrder = { id: string; customer?: string; reference?: string; latestDate: string; receivedAtUtc: string; subject?: string };
export type PastDatedResponse = { today: string; count: number; oldest?: string; items: PastDatedOrder[] };

/**
 * Orders still waiting for review whose dates have all gone. They can no longer be planned,
 * so the planner sees them together and closes them in one click (kept as rejected, with a
 * note, so they're still in the history).
 */
export function PastDatedOrders({ onClosed }: { onClosed?: () => void }) {
  const token = useAccessToken();
  const data = useTmsQuery<PastDatedResponse>(['staging', 'past-dated'] as const, useCallback((t: string) => request<PastDatedResponse>("/api/v1/staging/queue/past-dated", t), []));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const items = data.data?.items || [];
  if (!items.length) return message ? <p className="notice inline-notice">{message}</p> : null;

  async function closeAll() {
    if (!window.confirm(`Close ${items.length} waiting order${items.length === 1 ? "" : "s"} whose dates have passed? They'll be marked rejected with the note "date passed while waiting for review".`)) return;
    setBusy(true); setMessage(undefined);
    try {
      const result = await request<{ closed: number; skipped: number }>("/api/v1/staging/queue/past-dated/close", await token(), { method: "POST", body: JSON.stringify({ ids: items.map(item => item.id) }) });
      setMessage(`${result.closed} past-dated order${result.closed === 1 ? "" : "s"} closed${result.skipped ? `, ${result.skipped} left (already reviewed or no longer past-dated)` : ""}.`);
      await data.refetch();
      onClosed?.();
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Could not close the orders."); }
    finally { setBusy(false); }
  }

  return <section className="ui-card" style={{ marginBottom: 12, borderColor: "#e8b84d" }}>
    <div className="ui-card-head">
      <h2>{items.length} waiting order{items.length === 1 ? " is" : "s are"} for dates already gone</h2>
      <div className="ui-filters">
        <button type="button" onClick={() => setOpen(value => !value)}>{open ? "Hide list" : "Show list"}</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void closeAll()}>{busy ? "Closing…" : "Close them all"}</button>
      </div>
    </div>
    <p className="hint">Oldest: {data.data?.oldest ? workingDateLabel(data.data.oldest) : "—"}. They can't be planned any more. Approve any that still need invoicing from the date strip first; close the rest.</p>
    {message && <p className="notice inline-notice">{message}</p>}
    {open && <div className="ui-table-wrap"><table className="ui-table">
      <thead><tr><th>Date</th><th>Customer</th><th>Reference</th><th>Email</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.id}>
        <td>{workingDateLabel(item.latestDate)}</td>
        <td>{item.customer || "—"}</td>
        <td>{item.reference || "—"}</td>
        <td><small>{item.subject || "—"}</small></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
