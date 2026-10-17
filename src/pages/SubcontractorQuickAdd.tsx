import { useState, type FormEvent } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";

type Result = {
  company: string;
  driver?: { id: string; displayName: string; employeeNumber: string; created: boolean };
  vehicle?: { id: string; registration: string; created: boolean; trackingLinked: boolean; trackingKey?: string };
  message: string;
};

export function SubcontractorQuickAdd() {
  const token = useAccessToken();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverMobile, setDriverMobile] = useState("");
  const [vehicleRegistration, setVehicleRegistration] = useState("");
  const [trackingProvider, setTrackingProvider] = useState("DOT/Falcon");
  const [trackingKey, setTrackingKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await request<Result>("/api/v1/subcontractors/resources", await token(), {
        method: "POST",
        body: JSON.stringify({
          company,
          driverName: driverName || undefined,
          driverMobile: driverMobile || undefined,
          vehicleRegistration: vehicleRegistration || undefined,
          trackingProvider: trackingProvider || undefined,
          trackingKey: trackingKey || undefined,
        }),
      });
      setMessage(result.message);
      window.dispatchEvent(new Event("slh:master-data-changed"));
      setDriverName("");
      setDriverMobile("");
      setVehicleRegistration("");
      setTrackingKey("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Subcontractor resource could not be added.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="panel" style={{ marginBottom: 14 }}>
    <div className="title-row" style={{ alignItems: "center", gap: 12 }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 3 }}>External resource</p>
        <strong>Subcontractor driver / vehicle</strong><br />
        <small>Add the actual driver and registration so subcontracted runs do not remain Driver / Vehicle TBC.</small>
      </div>
      <button type="button" onClick={() => setOpen(value => !value)}>{open ? "Close" : "+ Add subcontractor"}</button>
    </div>

    {open && <form onSubmit={save} style={{ marginTop: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        <label>Company<input required value={company} onChange={event => setCompany(event.target.value)} placeholder="Haulier / subcontractor" /></label>
        <label>Driver name<input value={driverName} onChange={event => setDriverName(event.target.value)} placeholder="Optional if not yet known" /></label>
        <label>Driver mobile<input value={driverMobile} onChange={event => setDriverMobile(event.target.value)} placeholder="Optional" /></label>
        <label>Vehicle registration<input value={vehicleRegistration} onChange={event => setVehicleRegistration(event.target.value.toUpperCase())} placeholder="e.g. AB12CDE" /></label>
        <label>Tracking provider<select value={trackingProvider} onChange={event => setTrackingProvider(event.target.value)}>
          <option value="DOT/Falcon">DOT / Falcon</option>
          <option value="External">External / not integrated</option>
          <option value="">Unknown / registration match only</option>
        </select></label>
        <label>DOT/Falcon tracking alias<input value={trackingKey} onChange={event => setTrackingKey(event.target.value)} placeholder="Only if different from reg" /></label>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        If Falcon reports the vehicle by registration, leave the alias blank. If it reports a different vehicle code, enter that code here. External providers are recorded but are not treated as live tracking until integrated.
      </p>
      {message && <p className="notice inline-notice">{message}</p>}
      {error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="primary" type="submit" disabled={saving || (!driverName.trim() && !vehicleRegistration.trim())}>{saving ? "Adding…" : "Add to Drivers / Vehicles"}</button>
      </div>
    </form>}
  </div>;
}
