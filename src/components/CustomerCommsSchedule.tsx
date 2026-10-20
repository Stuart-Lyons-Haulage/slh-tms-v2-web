import { useCallback, useEffect, useState } from "react";
import { apiBaseUrl, request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useTmsQuery } from "../lib/useTmsQuery";

type ScheduleCustomer = {
  customerCode: string;
  customerName: string;
  recipients: string[];
  loadPlan: boolean;
  deliveryTimes: boolean;
  loadPlanStatus?: string;
  loadPlanHold?: string;
  deliveryTimesStatus?: string;
  hasPlanTomorrow: boolean;
  hasDeliveriesToday: boolean;
  loadPlanOpenedInOutlook?: { openedBy?: string; openedAtUtc: string };
  deliveryTimesOpenedInOutlook?: { openedBy?: string; openedAtUtc: string };
};

function openedLabel(opened?: { openedBy?: string; openedAtUtc: string }) {
  if (!opened) return null;
  const time = new Date(opened.openedAtUtc).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return <small className="hint">Opened in Outlook {time}{opened.openedBy ? ` by ${opened.openedBy.split("@")[0]}` : ""}</small>;
}
type ScheduleResponse = { loadPlanTime: string; deliveryTimesTime: string; loadPlanLatest: string; today: string; tomorrow: string; emailsWaitingOverTenMinutes: number; customers: ScheduleCustomer[] };

function statusChip(status?: string, hold?: string) {
  if (hold) return <span className="ui-chip amber" title={hold}>{hold.replace(/^Held: /, "Held · ")}</span>;
  if (status === "Sent") return <span className="ui-chip green">Sent</span>;
  if (status === "Queued") return <span className="ui-chip blue">Sending</span>;
  if (status === "Failed") return <span className="ui-chip red">Failed</span>;
  return <span className="ui-chip">Not sent</span>;
}

/**
 * When customer emails go out on their own. Load plans for tomorrow go late afternoon once
 * the plan is built (held while anything for that customer is still to plan); delivery
 * times for today go mid-morning. Each customer is switched on separately.
 */
export function CustomerCommsSchedule() {
  const token = useAccessToken();
  const data = useTmsQuery<ScheduleResponse>(['customer-comms', 'schedule'] as const, useCallback((t: string) => request<ScheduleResponse>("/api/v1/customer-load-plans/schedule", t, undefined, 60000), []));
  const [draft, setDraft] = useState<ScheduleResponse>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [opening, setOpening] = useState<string>();

  /** Downloads a ready-to-send email; opening it gives a new Outlook message with the PDF attached. */
  async function openInOutlook(customer: ScheduleCustomer, kind: "plan" | "times") {
    if (!draft) return;
    const key = `${customer.customerCode}-${kind}`;
    setOpening(key); setMessage(undefined);
    try {
      const date = kind === "plan" ? draft.tomorrow : draft.today;
      const response = await fetch(`${apiBaseUrl}/api/v1/customer-load-plans/draft?date=${encodeURIComponent(date)}&customerCode=${encodeURIComponent(customer.customerCode)}&kind=${kind}`, { headers: { Authorization: `Bearer ${await token()}` } });
      if (!response.ok) {
        const problem = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(problem?.message || `Could not build the email (${response.status}).`);
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] || `${customer.customerName} ${kind === "plan" ? "Load Plan" : "Delivery Times"}.eml`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = decodeURIComponent(name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setMessage(`${customer.customerName} ${kind === "plan" ? "load plan" : "delivery times"} ready: open the downloaded email to send it from Outlook.`);
      void data.refetch();
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Could not build the email."); }
    finally { setOpening(undefined); }
  }
  useEffect(() => { if (data.data) setDraft(data.data); }, [data.data]);

  async function save(next: ScheduleResponse) {
    setDraft(next);
    setSaving(true); setMessage(undefined);
    try {
      await request("/api/v1/customer-load-plans/schedule", await token(), {
        method: "PUT",
        body: JSON.stringify({
          loadPlanTime: next.loadPlanTime,
          deliveryTimesTime: next.deliveryTimesTime,
          loadPlanLatest: next.loadPlanLatest,
          customers: Object.fromEntries(next.customers.map(item => [item.customerCode, { loadPlan: item.loadPlan, deliveryTimes: item.deliveryTimes }])),
        }),
      });
      setMessage("Schedule saved.");
    } catch (exception) { setMessage(exception instanceof Error ? exception.message : "Could not save the schedule."); }
    finally { setSaving(false); }
  }

  function toggle(code: string, field: "loadPlan" | "deliveryTimes", value: boolean) {
    if (!draft) return;
    const customer = draft.customers.find(item => item.customerCode === code);
    if (value && customer && customer.recipients.length === 0 && !window.confirm(`${customer.customerName} has no email contact in Master data yet, so nothing will be sent until one is added. Turn on anyway?`)) return;
    void save({ ...draft, customers: draft.customers.map(item => item.customerCode === code ? { ...item, [field]: value } : item) });
  }

  if (data.error) return <p className="ui-error">{data.error.message}</p>;
  if (!draft) return <div className="ui-empty">Loading the send schedule…</div>;
  return <section className="ui-card">
    <div className="ui-card-head">
      <h2>Send to customers</h2>
      <div className="ui-filters">
        <label>Load plans (tomorrow) from<input type="time" value={draft.loadPlanTime} onChange={event => setDraft({ ...draft, loadPlanTime: event.target.value })} onBlur={() => void save(draft)} /></label>
        <label>Keep trying until<input type="time" value={draft.loadPlanLatest} onChange={event => setDraft({ ...draft, loadPlanLatest: event.target.value })} onBlur={() => void save(draft)} /></label>
        <label>Delivery times (today) at<input type="time" value={draft.deliveryTimesTime} onChange={event => setDraft({ ...draft, deliveryTimesTime: event.target.value })} onBlur={() => void save(draft)} /></label>
      </div>
    </div>
    <p className="hint"><strong>Open in Outlook</strong> gives a ready-to-send email (recipients, subject, the load plan PDF with loading guides, info@ copied in): open the download, check it, press Send. Tip: in the browser's downloads, choose "Always open files of this type" so it opens straight in Outlook. <strong>Auto-send</strong> is ready for when you want it: load plans wait until every order for that customer is on a run.</p>
    {draft.emailsWaitingOverTenMinutes > 0 && <p className="ui-error">{draft.emailsWaitingOverTenMinutes} email{draft.emailsWaitingOverTenMinutes === 1 ? " has" : "s have"} been waiting to send for over 10 minutes. Check the info@ send flow in Power Automate is switched on.</p>}
    {message && <p className="notice inline-notice">{message}</p>}
    <div className="ui-table-wrap"><table className="ui-table">
      <thead><tr><th>Customer</th><th>Sent to</th><th>Load plan · tomorrow</th><th>Delivery times · today</th></tr></thead>
      <tbody>{draft.customers.map(item => <tr key={item.customerCode}>
        <td><strong>{item.customerName}</strong><br /><small>{item.customerCode}</small></td>
        <td>{item.recipients.length ? <small>{item.recipients.join(", ")}</small> : <span className="ui-chip amber">No email in Master data</span>}</td>
        <td>
          {item.hasPlanTomorrow ? <div className="comms-cell">
            <button type="button" className="primary" disabled={Boolean(opening)} onClick={() => void openInOutlook(item, "plan")}>{opening === `${item.customerCode}-plan` ? "Preparing…" : "Open in Outlook"}</button>
            {openedLabel(item.loadPlanOpenedInOutlook) || (item.loadPlanStatus || item.loadPlanHold ? statusChip(item.loadPlanStatus, item.loadPlanHold) : null)}
          </div> : <small>Nothing planned</small>}
          <label className="checkbox-label comms-auto"><input type="checkbox" checked={item.loadPlan} disabled={saving} onChange={event => toggle(item.customerCode, "loadPlan", event.target.checked)} /> Auto-send at {draft.loadPlanTime}</label>
        </td>
        <td>
          {item.hasDeliveriesToday ? <div className="comms-cell">
            <button type="button" className="primary" disabled={Boolean(opening)} onClick={() => void openInOutlook(item, "times")}>{opening === `${item.customerCode}-times` ? "Preparing…" : "Open in Outlook"}</button>
            {openedLabel(item.deliveryTimesOpenedInOutlook) || (item.deliveryTimesStatus ? statusChip(item.deliveryTimesStatus) : null)}
          </div> : <small>No deliveries</small>}
          <label className="checkbox-label comms-auto"><input type="checkbox" checked={item.deliveryTimes} disabled={saving} onChange={event => toggle(item.customerCode, "deliveryTimes", event.target.checked)} /> Auto-send at {draft.deliveryTimesTime}</label>
        </td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
