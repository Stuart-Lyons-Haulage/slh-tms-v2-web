import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";

type Preview = { through: string; runs: number; canonicalRuns: number; orders: number; bookings: number; intakeAndPlanningRecords: number; recordsByType: Record<string, number> };
type Status = { state: "Idle" | "Running" | "Done" | "Failed"; result?: { deleted?: Record<string, number>; message?: string } | null };

const labels: Record<string, string> = {
  orders: "Orders", runs: "Runs", canonicalRuns: "Run records", bookings: "Crate/tray bookings",
  intakeAndPlanningRecords: "Intake and planning records", runOrderAllocations: "Orders on runs",
  orderRevisions: "Order versions", orderSourceLines: "Order lines", intakeEvents: "Intake history",
  bookingAllocations: "Booking links", referenceIssues: "Reference chases", invoicesUnlinked: "Invoices unlinked (kept)",
  planProposalAllocations: "Plan suggestions",
};

/**
 * Clear the slate: permanently delete every order, booking and run dated on or before a day.
 * Shows exactly what will go first, and only runs once the date is typed to confirm.
 */
export function PlanningWipe() {
  const token = useAccessToken();
  const [through, setThrough] = useState(todayIsoDate());
  const [preview, setPreview] = useState<Preview>();
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { setPreview(undefined); setConfirm(""); }, [through]);

  useEffect(() => {
    if (status?.state !== "Running") return;
    const timer = globalThis.setInterval(async () => {
      try {
        const next = await request<Status>("/api/v1/admin/planning-wipe/status", await token());
        setStatus(next);
        if (next.state !== "Running") setPreview(undefined);
      } catch { /* keep polling */ }
    }, 3000);
    return () => globalThis.clearInterval(timer);
  }, [status?.state, token]);

  async function check() {
    setBusy(true); setError(undefined); setStatus(undefined);
    try { setPreview(await request<Preview>(`/api/v1/admin/planning-wipe?through=${through}`, await token(), undefined, 120000)); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Could not check what would be deleted."); }
    finally { setBusy(false); }
  }

  async function wipe() {
    setBusy(true); setError(undefined);
    try {
      await request("/api/v1/admin/planning-wipe", await token(), { method: "POST", body: JSON.stringify({ through, confirm }) });
      setStatus({ state: "Running" });
    } catch (exception) { setError(exception instanceof Error ? exception.message : "Could not start the clear-out."); }
    finally { setBusy(false); }
  }

  const total = preview ? preview.orders + preview.runs + preview.bookings + preview.intakeAndPlanningRecords : 0;
  return <section className="ui-card" style={{ borderColor: "#d9534f" }}>
    <div className="ui-card-head"><h2>Clear old orders and runs</h2><span className="ui-chip red">Permanent</span></div>
    <p className="hint">Deletes every order, crate/tray booking and run collected or planned on or before the date, with their intake and planning records, so planning starts clean the next day. Drivers, vehicles, sites, customers, emails and invoices are kept. This can't be undone from the TMS.</p>
    <div className="ui-filters">
      <label>Delete up to and including<input type="date" value={through} max={todayIsoDate()} onChange={event => setThrough(event.target.value)} /></label>
      <button type="button" onClick={() => void check()} disabled={busy || status?.state === "Running"}>{busy && !preview ? "Checking…" : "Check what would go"}</button>
    </div>
    {error && <p className="ui-error">{error}</p>}
    {preview && <>
      <div className="ui-table-wrap"><table className="ui-table"><tbody>
        {(["orders", "runs", "bookings", "intakeAndPlanningRecords"] as const).map(key => <tr key={key}><td>{labels[key]}</td><td><strong>{preview[key].toLocaleString("en-GB")}</strong></td></tr>)}
      </tbody></table></div>
      {total === 0 ? <p className="hint">Nothing dated {through} or earlier.</p> : <div className="ui-filters">
        <label>Type {through} to confirm<input value={confirm} onChange={event => setConfirm(event.target.value)} placeholder={through} /></label>
        <button type="button" className="danger primary" disabled={busy || confirm.trim() !== through} onClick={() => void wipe()}>Delete permanently</button>
      </div>}
    </>}
    {status?.state === "Running" && <p className="notice inline-notice">Deleting… this can take a few minutes. You can leave this page; it carries on.</p>}
    {status?.state === "Done" && <div className="notice inline-notice"><strong>Done.</strong> {Object.entries(status.result?.deleted || {}).map(([key, value]) => `${labels[key] || key}: ${value.toLocaleString("en-GB")}`).join(" · ") || "Nothing needed deleting."}</div>}
    {status?.state === "Failed" && <p className="ui-error">{status.result?.message || "The clear-out failed; nothing was deleted."}</p>}
  </section>;
}
