import { useCallback, useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

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
};
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
  const data = useApi(useCallback(async () => request<ScheduleResponse>("/api/v1/customer-load-plans/schedule", await token(), undefined, 60000), [token]));
  const [draft, setDraft] = useState<ScheduleResponse>();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
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

  if (data.error) return <p className="ui-error">{data.error}</p>;
  if (!draft) return <div className="ui-empty">Loading the send schedule…</div>;
  return <section className="ui-card">
    <div className="ui-card-head">
      <h2>Send automatically</h2>
      <div className="ui-filters">
        <label>Load plans (tomorrow) from<input type="time" value={draft.loadPlanTime} onChange={event => setDraft({ ...draft, loadPlanTime: event.target.value })} onBlur={() => void save(draft)} /></label>
        <label>Keep trying until<input type="time" value={draft.loadPlanLatest} onChange={event => setDraft({ ...draft, loadPlanLatest: event.target.value })} onBlur={() => void save(draft)} /></label>
        <label>Delivery times (today) at<input type="time" value={draft.deliveryTimesTime} onChange={event => setDraft({ ...draft, deliveryTimesTime: event.target.value })} onBlur={() => void save(draft)} /></label>
      </div>
    </div>
    <p className="hint">A customer's load plan only goes once every one of their orders is on a run; until then it waits and shows why. Delivery times use the live ETAs. Each goes once a day, from info@, exactly as the buttons above would send it, with loading guides for mixed euro/standard loads.</p>
    {draft.emailsWaitingOverTenMinutes > 0 && <p className="ui-error">{draft.emailsWaitingOverTenMinutes} email{draft.emailsWaitingOverTenMinutes === 1 ? " has" : "s have"} been waiting to send for over 10 minutes. Check the info@ send flow in Power Automate is switched on.</p>}
    {message && <p className="notice inline-notice">{message}</p>}
    <div className="ui-table-wrap"><table className="ui-table">
      <thead><tr><th>Customer</th><th>Sent to</th><th>Load plan · {draft.tomorrow}</th><th>Delivery times · {draft.today}</th></tr></thead>
      <tbody>{draft.customers.map(item => <tr key={item.customerCode}>
        <td><strong>{item.customerName}</strong><br /><small>{item.customerCode}</small></td>
        <td>{item.recipients.length ? <small>{item.recipients.join(", ")}</small> : <span className="ui-chip amber">No email in Master data</span>}</td>
        <td>
          <label className="checkbox-label"><input type="checkbox" checked={item.loadPlan} disabled={saving} onChange={event => toggle(item.customerCode, "loadPlan", event.target.checked)} /> Auto at {draft.loadPlanTime}</label>
          {item.hasPlanTomorrow ? statusChip(item.loadPlanStatus, item.loadPlanHold) : <small>Nothing planned</small>}
        </td>
        <td>
          <label className="checkbox-label"><input type="checkbox" checked={item.deliveryTimes} disabled={saving} onChange={event => toggle(item.customerCode, "deliveryTimes", event.target.checked)} /> Auto at {draft.deliveryTimesTime}</label>
          {item.hasDeliveriesToday ? statusChip(item.deliveryTimesStatus) : <small>No deliveries</small>}
        </td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
