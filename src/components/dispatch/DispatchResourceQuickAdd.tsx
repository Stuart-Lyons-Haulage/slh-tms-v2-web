import { useState } from "react";
import { request } from "../../lib/api";
import { useAccessToken } from "../../lib/auth";

type ResourceType = "Agency" | "Employed" | "Casual" | "Subcontractor";

type Props = { onSaved?: () => void };

export function DispatchResourceQuickAdd({ onSaved }: Props) {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [displayName, setDisplayName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [driverType, setDriverType] = useState<ResourceType>("Agency");
  const [organisationName, setOrganisationName] = useState("");

  async function save() {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await request<{ message?: string }>("/api/v1/driver-dispatch/resources", await token(), {
        method: "POST",
        body: JSON.stringify({ displayName, employeeNumber, driverType, organisationName })
      }, 90000);
      setNotice(result.message || "Resource added.");
      setDisplayName("");
      setEmployeeNumber("");
      setOrganisationName("");
      onSaved?.();
    } catch (exception) {
      setNotice(exception instanceof Error ? exception.message : "The driver/subbie could not be added.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="smart-action secondary" type="button" onClick={() => setOpen(true)}>Add Driver</button>
    {open && <div className="dispatch-resource-modal-backdrop" role="presentation">
      <section className="dispatch-resource-modal" role="dialog" aria-modal="true" aria-label="Add driver or subcontractor">
        <header>
          <div><span className="smart-eyebrow">Dispatch resource</span><h3>Add Driver / Subbie</h3></div>
          <button type="button" className="smart-action ghost" onClick={() => setOpen(false)} disabled={busy}>Close</button>
        </header>
        <p>If the driver is missing from Dispatch, add them here. Use <strong>Subbie</strong> for subcontracted drivers or owner-drivers so they appear in the dispatch menu.</p>
        <label>Name<input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Driver or subbie name" /></label>
        <label>Type<select value={driverType} onChange={event => setDriverType(event.target.value as ResourceType)}>
          <option value="Agency">Agency</option>
          <option value="Employed">Employed</option>
          <option value="Casual">Casual</option>
          <option value="Subcontractor">Subbie / Subcontractor</option>
        </select></label>
        {(driverType === "Employed" || driverType === "Casual") && <label>Employee number<input value={employeeNumber} onChange={event => setEmployeeNumber(event.target.value)} placeholder="Employee number" /></label>}
        {(driverType === "Agency" || driverType === "Subcontractor") && <label>{driverType === "Subcontractor" ? "Subbie / company" : "Agency"}<input value={organisationName} onChange={event => setOrganisationName(event.target.value)} placeholder={driverType === "Subcontractor" ? "Company or trading name" : "Agency name"} /></label>}
        {notice && <div className="smart-dispatch-notice" role="status">{notice}</div>}
        <footer>
          <button className="smart-action primary" type="button" disabled={busy || !displayName.trim()} onClick={() => void save()}>{busy ? "Saving…" : driverType === "Subcontractor" ? "Add Subbie" : "Add Driver"}</button>
        </footer>
      </section>
    </div>}
  </>;
}
