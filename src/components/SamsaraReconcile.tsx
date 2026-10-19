import { useCallback, useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type Item = { name: string; detail?: string | null };
type Section = { tms: number; samsara: number; matched: number; onlyInTms: Item[]; onlyInSamsara: Item[]; differences: Item[]; problem?: string | null };
type Result = { checkedAtUtc?: string | null; drivers?: Section; vehicles?: Section; trailers?: Section; problem?: string | null; gaps?: number; configured?: boolean; assetSyncEnabled?: boolean };

const help: Record<string, { tms: string; samsara: string }> = {
  drivers: { tms: "Add them in Samsara (Drivers) so runs can be sent to their app.", samsara: "Left the company? Deactivate in Samsara. Still driving? Check their name on Driver Master." },
  vehicles: { tms: "Use 'Send to Samsara' below, or check the registration in Samsara.", samsara: "Sold or off fleet? Archive in Samsara. Still in use? Check Fleetio / Vehicle Master." },
  trailers: { tms: "Use 'Send to Samsara' below.", samsara: "Not ours any more? Archive in Samsara. Otherwise add it to Trailer Master." },
};

/** TMS and Samsara kept in step: drivers, vehicles and trailers compared both ways. */
export function SamsaraReconcile() {
  const token = useAccessToken();
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try { setResult(await request<Result>("/api/v1/integrations/samsara/reconcile", await token())); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Could not read the Samsara check."); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function check() {
    setBusy("check"); setError(undefined); setMessage(undefined);
    try { setResult(await request<Result>("/api/v1/integrations/samsara/reconcile", await token(), { method: "POST" }, 120000)); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "The check failed."); }
    finally { setBusy(undefined); }
  }

  async function sendAssets() {
    setBusy("send"); setError(undefined); setMessage(undefined);
    try {
      const sent = await request<{ message?: string }>("/api/v1/integrations/samsara/master-data/sync", await token(), { method: "POST" }, 180000);
      setMessage(sent.message || "Sent to Samsara.");
      await check();
    } catch (exception) { setError(exception instanceof Error ? exception.message : "Sending to Samsara failed."); }
    finally { setBusy(undefined); }
  }

  const sections: Array<[string, string, Section | undefined]> = [["drivers", "Drivers", result?.drivers], ["vehicles", "Vehicles", result?.vehicles], ["trailers", "Trailers", result?.trailers]];
  const assetGaps = (result?.vehicles?.onlyInTms.length || 0) + (result?.trailers?.onlyInTms.length || 0);
  const gaps = result?.gaps ?? 0;

  return <article className="ui-card">
    <div className="ui-card-head"><h2>TMS and Samsara in step</h2>
      <span className={`ui-chip ${result?.problem ? "amber" : !result?.checkedAtUtc ? "amber" : gaps ? "amber" : "green"}`}>{result?.problem ? "Problem" : !result?.checkedAtUtc ? "Not checked yet" : gaps ? `${gaps} to sort` : "In step"}</span></div>
    <p className="hint">Drivers, vehicles and trailers compared both ways every six hours. Matches are linked automatically so runs land on the right driver and truck; nothing is added or removed on either side without you.{result?.checkedAtUtc ? ` Last checked ${new Date(result.checkedAtUtc).toLocaleString("en-GB")}.` : ""}</p>
    {result?.problem && <p className="ui-error">{result.problem}</p>}
    <div className="ui-page-actions" style={{ gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void check()}>{busy === "check" ? "Checking…" : "Check now"}</button>
      {assetGaps > 0 && result?.assetSyncEnabled && <button type="button" disabled={Boolean(busy)} onClick={() => void sendAssets()}>{busy === "send" ? "Sending…" : `Send ${assetGaps} vehicle/trailer${assetGaps === 1 ? "" : "s"} to Samsara`}</button>}
    </div>
    {message && <p className="notice inline-notice">{message}</p>}
    {error && <p className="ui-error">{error}</p>}
    {result?.checkedAtUtc && sections.map(([key, label, section]) => section && <details key={key} open={(section.onlyInTms.length + section.onlyInSamsara.length) > 0} style={{ marginTop: 8 }}>
      <summary><strong>{label}</strong>: {section.matched} matched · {section.onlyInTms.length} only in TMS · {section.onlyInSamsara.length} only in Samsara{section.differences.length ? ` · ${section.differences.length} named differently` : ""}{section.problem ? ` · ${section.problem}` : ""}</summary>
      {section.onlyInTms.length > 0 && <p className="hint"><strong>Only in the TMS:</strong> {section.onlyInTms.map((item) => item.detail ? `${item.name} (${item.detail})` : item.name).join(", ")}. {help[key].tms}</p>}
      {section.onlyInSamsara.length > 0 && <p className="hint"><strong>Only in Samsara:</strong> {section.onlyInSamsara.map((item) => item.name).join(", ")}. {help[key].samsara}</p>}
      {section.differences.length > 0 && <p className="hint"><strong>Linked but named differently:</strong> {section.differences.map((item) => item.detail || item.name).join("; ")}.</p>}
    </details>)}
  </article>;
}
