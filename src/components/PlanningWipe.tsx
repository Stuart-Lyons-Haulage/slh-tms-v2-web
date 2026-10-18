import { useCallback, useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";

type Preview = { through: string; runs: number; canonicalRuns: number; orders: number; bookings: number; intakeAndPlanningRecords: number; recordsByType: Record<string, number> };
type Status = {
  state: "Idle" | "Checking" | "Checked" | "Deleting" | "Done" | "Failed";
  through?: string;
  preview?: Preview | null;
  result?: { deleted?: Record<string, number> } | null;
  message?: string | null;
};

const labels: Record<string, string> = {
  orders: "Orders", runs: "Runs", canonicalRuns: "Run records", bookings: "Crate/tray bookings",
  intakeAndPlanningRecords: "Intake and planning records", runOrderAllocations: "Orders on runs",
  orderRevisions: "Order versions", orderSourceLines: "Order lines", intakeEvents: "Intake history",
  bookingAllocations: "Booking links", referenceIssues: "Reference chases", invoicesUnlinked: "Invoices unlinked (kept)",
  planProposalAllocations: "Plan suggestions",
};

/**
 * Clear the slate: permanently delete every order, booking and run dated on or before a day.
 * The check and the delete both run on the server in the background; this card polls.
 */
export function PlanningWipe() {
  const token = useAccessToken();
  const [through, setThrough] = useState(todayIsoDate());
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const poll = useCallback(async () => {
    try { setStatus(await request<Status>("/api/v1/admin/planning-wipe/status", await token())); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Could not read the clear-out status."); }
  }, [token]);

  useEffect(() => { void poll(); }, [poll]);
  const working = status?.state === "Checking" || status?.state === "Deleting";
  useEffect(() => {
    if (!working) return;
    const timer = globalThis.setInterval(() => void poll(), 3000);
    return () => globalThis.clearInterval(timer);
  }, [working, poll]);

  async function start(path: string, body: object) {
    setBusy(true); setError(undefined);
    try {
      await request(path, await token(), { method: "POST", body: JSON.stringify(body) });
      await poll();
    } catch (exception) { setError(exception instanceof Error ? exception.message : "Could not start."); }
    finally { setBusy(false); }
  }

  const preview = status?.state === "Checked" && status.through === through ? status.preview ?? undefined : undefined;
  const total = preview ? preview.orders + preview.runs + preview.bookings + preview.intakeAndPlanningRecords : 0;
  return <section className="ui-card" style={{ borderColor: "#d9534f" }}>
    <div className="ui-card-head"><h2>Clear old orders and runs</h2><span className="ui-chip red">Permanent</span></div>
    <p className="hint">Deletes every order, crate/tray booking and run collected or planned on or before the date, with their intake and planning records, so planning starts clean the next day. Drivers, vehicles, sites, customers, emails and invoices are kept. This can't be undone from the TMS.</p>
    <div className="ui-filters">
      <label>Delete up to and including<input type="date" value={through} max={todayIsoDate()} onChange={event => { setThrough(event.target.value); setConfirm(""); }} /></label>
      <button type="button" onClick={() => void start("/api/v1/admin/planning-wipe/check", { through })} disabled={busy || working}>Check what would go</button>
    </div>
    {error && <p className="ui-error">{error}</p>}
    {status?.state === "Checking" && <p className="notice inline-notice">Checking every order and run record… this can take a minute or two.</p>}
    {preview && <>
      <div className="ui-table-wrap"><table className="ui-table"><tbody>
        {(["orders", "runs", "bookings", "intakeAndPlanningRecords"] as const).map(key => <tr key={key}><td>{labels[key]}</td><td><strong>{preview[key].toLocaleString("en-GB")}</strong></td></tr>)}
      </tbody></table></div>
      {total === 0 ? <p className="hint">Nothing dated {through} or earlier.</p> : <div className="ui-filters">
        <label>Type {through} to confirm<input value={confirm} onChange={event => setConfirm(event.target.value)} placeholder={through} /></label>
        <button type="button" className="danger primary" disabled={busy || confirm.trim() !== through} onClick={() => void start("/api/v1/admin/planning-wipe", { through, confirm })}>Delete permanently</button>
      </div>}
    </>}
    {status?.state === "Deleting" && <p className="notice inline-notice">Deleting… this can take a few minutes. You can leave this page; it carries on.</p>}
    {status?.state === "Done" && <div className="notice inline-notice"><strong>Done ({status.through}).</strong> {Object.entries(status.result?.deleted || {}).map(([key, value]) => `${labels[key] || key}: ${value.toLocaleString("en-GB")}`).join(" · ") || "Nothing needed deleting."}</div>}
    {status?.state === "Failed" && <p className="ui-error">{status.message || "It failed; nothing was deleted."}</p>}
  </section>;
}
