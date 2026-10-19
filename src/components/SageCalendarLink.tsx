import { useCallback, useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type Status = {
  linked: boolean; link?: string; linkSavedBy?: string; lastReadUtc?: string; problem?: string;
  events: number; matched: number; unmatched: string[]; archivedDrivers?: string[]; ignored?: number; types: Record<string, number>;
  driversOffToday: Array<{ driverName: string; kind: string; type: string }>; leaveDays: number; nonWorkingDays: number;
};

/**
 * Sage HR "Who's off" calendar: paste the "Sync with my calendar" link once. The TMS reads it
 * hourly and marks drivers on leave or on a non-working day in Availability and Dispatch.
 */
export function SageCalendarLink() {
  const token = useAccessToken();
  const [status, setStatus] = useState<Status>();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try { setStatus(await request<Status>("/api/v1/integrations/sage-calendar", await token())); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Could not read the Sage calendar status."); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<{ events?: number; matched?: number; problem?: string | null }>) {
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const result = await action();
      setMessage(result.problem ? result.problem : `Read ${result.events ?? 0} calendar entries; ${result.matched ?? 0} matched to drivers.`);
      setUrl("");
      await load();
    } catch (exception) { setError(exception instanceof Error ? exception.message : "That didn't work."); }
    finally { setBusy(false); }
  }

  const save = async () => run(async () => request("/api/v1/integrations/sage-calendar", await token(), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }, 60000));
  const refresh = async () => run(async () => request("/api/v1/integrations/sage-calendar/refresh", await token(), { method: "POST" }, 60000));
  const types = Object.entries(status?.types || {}).sort((a, b) => b[1] - a[1]);

  return <article className="ui-card">
    <div className="ui-card-head"><h2>Sage HR calendar (who's off)</h2>
      <span className={`ui-chip ${status?.problem ? "amber" : status?.lastReadUtc ? "green" : "amber"}`}>{!status?.linked ? "Not linked" : status.problem ? "Problem" : status.lastReadUtc ? "Reading hourly" : "Waiting for first read"}</span></div>
    <p className="hint">Paste the <strong>Sync with my calendar</strong> link from Sage HR's Who's off page. Drivers on leave or on a non-working day are then marked on Availability and Dispatch. The link is stored encrypted and never shown again; if it's ever shared by mistake, reset it in Sage and paste the new one.</p>
    {status?.linked && <p className="hint">Linked: {status.link}{status.linkSavedBy ? ` (saved by ${status.linkSavedBy})` : ""}{status.lastReadUtc ? ` · last read ${new Date(status.lastReadUtc).toLocaleString("en-GB")}` : ""}</p>}
    {status?.problem && <p className="ui-error">{status.problem}</p>}
    <div className="ui-page-actions" style={{ gap: 8, flexWrap: "wrap" }}>
      <input aria-label="Sage HR calendar link" type="password" autoComplete="off" placeholder="webcal://…sage.hr/calendar/sync/…" value={url} onChange={(event) => setUrl(event.target.value)} style={{ minWidth: 280, flex: 1 }} />
      <button type="button" className="primary" disabled={busy || !url.trim()} onClick={() => void save()}>{busy ? "Working…" : status?.linked ? "Replace link" : "Save link"}</button>
      {status?.linked && <button type="button" disabled={busy} onClick={() => void refresh()}>Read now</button>}
    </div>
    {message && <p className="notice inline-notice">{message}</p>}
    {error && <p className="ui-error">{error}</p>}
    {status?.linked && status.events > 0 && <>
      <p className="hint">{status.events} entries · {status.matched} matched to drivers · {status.leaveDays} leave days and {status.nonWorkingDays} non-working days in the next 90 days.</p>
      {types.length > 0 && <p className="hint">Types found: {types.map(([type, count]) => `${type} (${count})`).join(", ")}</p>}
      {status.driversOffToday.length > 0 && <p className="hint">Off today: {status.driversOffToday.map((item) => `${item.driverName} (${item.type})`).join(", ")}</p>}
      {status.unmatched.length > 0 && <p className="hint"><strong>Not matched to a driver ({status.unmatched.length}):</strong> {status.unmatched.join(", ")}. Office staff are expected here; for a driver, check the name on Driver Master.</p>}
      {(status.archivedDrivers?.length || 0) > 0 && <p className="hint"><strong>Archived drivers still in Sage ({status.archivedDrivers!.length}):</strong> {status.archivedDrivers!.join(", ")}. If they've left, end them in Sage; if they're back, restore them on Driver Master.</p>}
      {(status.ignored || 0) > 0 && <p className="hint">{status.ignored} birthdays, anniversaries and company holidays skipped (not absences).</p>}
    </>}
  </article>;
}
