import { useCallback, useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type Format = {
  formatKey: string; mode: "Off" | "Trial" | "On"; customer?: string; sender?: string; orders: number;
  wouldApprove: number; eligibleApprovedUnchanged: number; eligibleButEdited: number; eligibleButRejected: number; autoApproved: number;
};

const labels: Record<Format["mode"], string> = { Off: "Always review", Trial: "Trial", On: "Auto-approve" };

/**
 * Per booking format: whether its clean orders approve themselves. In Trial the cards
 * only say "would auto-approve", and this table shows how often the planners then
 * approved those orders unchanged, so a format is switched on with evidence.
 */
export function AutoApprovalFormats() {
  const token = useAccessToken();
  const [formats, setFormats] = useState<Format[]>([]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState<string>();

  const load = useCallback(async () => {
    try {
      const result = await request<{ formats: Format[] }>("/api/v1/order-intake/auto-approval?days=14", await token());
      setFormats(result.formats);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Formats could not be loaded.");
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function setMode(format: Format, mode: Format["mode"]) {
    if (mode === "On" && !window.confirm(`Clean ${format.customer || format.formatKey} orders will go straight into planning without review. Anything unusual still comes to Order Review. Continue?`)) return;
    setSaving(format.formatKey);
    try {
      await request("/api/v1/order-intake/auto-approval", await token(), { method: "PUT", body: JSON.stringify({ formatKey: format.formatKey, mode }) });
      setFormats(current => current.map(item => item.formatKey === format.formatKey ? { ...item, mode } : item));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The setting could not be saved.");
    } finally { setSaving(undefined); }
  }

  return <details className="auto-approval-formats">
    <summary>Booking formats &amp; auto-approval</summary>
    <p className="hint">Fixed booking formats are checked against their last 8 weeks. Anything unusual (new depot, new collection site, a count well outside normal) always comes to review. "Approved unchanged" is how many of the would-approve orders planners then approved without editing.</p>
    {error && <p className="notice inline-notice">{error}</p>}
    <div className="table-scroll"><table>
      <thead><tr><th>Format</th><th>Orders (14 days)</th><th>Would auto-approve</th><th>Approved unchanged</th><th>Edited / rejected</th><th>Setting</th></tr></thead>
      <tbody>{formats.map(format => <tr key={format.formatKey}>
        <td><strong>{format.customer || "—"}</strong><small>{format.formatKey}</small></td>
        <td>{format.orders}</td>
        <td>{format.wouldApprove}</td>
        <td>{format.mode === "On" ? `${format.autoApproved} auto-approved` : format.eligibleApprovedUnchanged}</td>
        <td>{format.eligibleButEdited} / {format.eligibleButRejected}</td>
        <td><select value={format.mode} disabled={saving === format.formatKey} onChange={event => void setMode(format, event.target.value as Format["mode"])}>
          {(Object.keys(labels) as Format["mode"][]).map(mode => <option key={mode} value={mode}>{labels[mode]}</option>)}
        </select></td>
      </tr>)}
      {formats.length === 0 && <tr><td colSpan={6}>No fixed-format bookings in the last 14 days yet.</td></tr>}</tbody>
    </table></div>
  </details>;
}
