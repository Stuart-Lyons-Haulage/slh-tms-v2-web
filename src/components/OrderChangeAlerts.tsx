import { useCallback, useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { startVisiblePolling } from "../lib/visiblePolling";

type FieldChange = { field: string; from?: string; to?: string };
type RunImpact = { loadId: string; reference: string; status: string; samsaraRouteId?: string; live: boolean };
type OrderChange = {
  id: string; open: boolean; raisedAtUtc: string;
  change: { reference: string; customerCode: string; collectionDate: string; kind: string; stage: "LiveRoute" | "OnRun" | "NotPlanned"; action: string; changes: FieldChange[]; runs: RunImpact[]; source?: string };
};

function when(value: string) {
  return new Date(value).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Amendments and cancellations that still need actioning: on a planned run, or on a
 * run already sent to Samsara (amend the driver's live route). Marking one done
 * records who actioned it.
 */
export function OrderChangeAlerts() {
  const token = useAccessToken();
  const [items, setItems] = useState<OrderChange[]>([]);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setItems(await request<OrderChange[]>("/api/v1/order-changes?open=true", await token()));
      setError(undefined);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Changes could not be loaded.");
    }
  }, [token]);

  useEffect(() => startVisiblePolling(load, 60_000), [load]);

  async function done(item: OrderChange) {
    const note = item.change.stage === "LiveRoute"
      ? window.prompt(`Confirm the Samsara route for ${item.change.reference} has been amended and the driver told. Add a note if useful:`, "Route amended, driver told")
      : "Run checked";
    if (note === null) return;
    setBusyId(item.id);
    try {
      await request(`/api/v1/order-changes/${item.id}/done`, await token(), { method: "POST", body: JSON.stringify({ note }) });
      setItems(current => current.filter(entry => entry.id !== item.id));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Could not mark the change as done.");
    } finally {
      setBusyId(undefined);
    }
  }

  if (items.length === 0 && !error) return null;
  const live = items.filter(item => item.change.stage === "LiveRoute").length;

  return <section className="order-change-alerts" aria-label="Order changes to action">
    <header>
      <strong>{items.length} order change{items.length === 1 ? "" : "s"} to action</strong>
      {live > 0 && <span className="order-change-live-count">{live} on a live Samsara route</span>}
    </header>
    {error && <p className="notice inline-notice">{error}</p>}
    <ul>
      {items.map(item => <li key={item.id} className={`order-change ${item.change.stage === "LiveRoute" ? "live" : "run"}`}>
        <div className="order-change-main">
          <div><span className="order-change-kind">{item.change.kind}</span> <strong>{item.change.reference}</strong> · {item.change.customerCode} · {item.change.runs.map(run => run.reference).join(", ")}</div>
          <div className="order-change-what">{item.change.changes.map(change => change.field === "Status" ? "Cancelled" : `${change.field}: ${change.from ?? "—"} → ${change.to ?? "—"}`).join(" · ")}</div>
          <div className="order-change-action">{item.change.action}</div>
          <small>{when(item.raisedAtUtc)}{item.change.source ? ` · ${item.change.source}` : ""}</small>
        </div>
        <button type="button" onClick={() => void done(item)} disabled={busyId === item.id}>{busyId === item.id ? "Saving…" : item.change.stage === "LiveRoute" ? "Route amended" : "Done"}</button>
      </li>)}
    </ul>
  </section>;
}
