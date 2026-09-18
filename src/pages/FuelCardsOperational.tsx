import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Vehicle } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { MasterDataExportButton } from "../components/MasterDataExportButton";

function text(value: unknown) { return String(value ?? "").trim(); }
function maskCard(value?: string) {
  const clean = text(value);
  if (!clean) return "—";
  if (/\*/.test(clean)) return clean;
  const digits = clean.replace(/\s/g, "");
  return digits.length > 8 ? `${digits.slice(0, 6)}••••••${digits.slice(-4)}` : clean;
}

export function FuelCardsOperational() {
  const token = useAccessToken();
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string>();
  const [editing, setEditing] = useState<Vehicle>();
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => (vehicles.data || []).filter((vehicle) => {
    const q = query.trim().toLowerCase();
    return !q || [vehicle.registration, vehicle.abbreviation, vehicle.cabMobile, vehicle.fuelProvider, vehicle.fuelPin, vehicle.shellCard, vehicle.bpRedCard, vehicle.bpPlainCard, vehicle.notes].some((value) => text(value).toLowerCase().includes(q));
  }), [query, vehicles.data]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const { id, ...payload } = editing;
      await api.updateVehicle(id, payload, await token());
      setEditing(undefined);
      await vehicles.refresh();
      setMessage("Fuel card register updated in the Live TMS Master Database.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fuel card details could not be saved.");
    } finally { setSaving(false); }
  }

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Fuel control register</p>
        <h1>Fuel cards & PINs</h1>
        <p className="intro">Live register of vehicle fuel information. The TMS remains the master record; amendments are completed here.</p>
      </div>
      <div className="title-actions">
        <span className="status approved">Live TMS Master Database</span>
        <button onClick={() => void vehicles.refresh()}>Refresh</button><MasterDataExportButton section="fuel-cards" label="Fuel cards" rows={(vehicles.data || []) as unknown as Record<string, unknown>[]} />
        <Link className="button-like" to="/admin/fuel-card-migration">Legacy fuel migration</Link>
      </div>
    </div>

    {editing && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit fuel Master Data" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEditing(undefined); }}>
      <div className="crm-modal">
        <div className="crm-modal-header"><div><p className="eyebrow">Vehicle fuel Master Data record</p><h2>{editing.registration}</h2><p className="hint">Fuel cards and PIN details remain part of the canonical vehicle record.</p></div><button type="button" disabled={saving} onClick={() => setEditing(undefined)}>Close</button></div>
        <div className="crm-modal-body"><section><h3>Fuel & contact details</h3><div className="crm-form-grid">
          <label>Cab mobile<input value={editing.cabMobile || ""} onChange={(e) => setEditing({ ...editing, cabMobile: e.target.value })} /></label>
          <label>Fuel provider<input value={editing.fuelProvider || ""} onChange={(e) => setEditing({ ...editing, fuelProvider: e.target.value })} /></label>
          <label>Fuel PIN<input value={editing.fuelPin || ""} onChange={(e) => setEditing({ ...editing, fuelPin: e.target.value })} /></label>
          <label>Shell card<input value={editing.shellCard || ""} onChange={(e) => setEditing({ ...editing, shellCard: e.target.value })} /></label>
          <label>BP red card<input value={editing.bpRedCard || ""} onChange={(e) => setEditing({ ...editing, bpRedCard: e.target.value })} /></label>
          <label>BP plain card<input value={editing.bpPlainCard || ""} onChange={(e) => setEditing({ ...editing, bpPlainCard: e.target.value })} /></label>
          <label>Fuel PIN secret name<input value={editing.fuelPinSecretName || ""} onChange={(e) => setEditing({ ...editing, fuelPinSecretName: e.target.value })} /></label>
          <label>Fuel card last four<input value={editing.fuelCardLastFour || ""} onChange={(e) => setEditing({ ...editing, fuelCardLastFour: e.target.value })} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Notes<textarea rows={4} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></label>
        </div></section></div>
        <div className="crm-modal-actions"><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Master Data record"}</button><button disabled={saving} onClick={() => setEditing(undefined)}>Cancel</button></div>
      </div>
    </div>}

    {message && <p className="notice inline-notice">{message}</p>}
    {vehicles.error && <p className="notice inline-notice">{vehicles.error}</p>}

    <div className="planner-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vehicle, card, PIN or notes…" />
      <span>{rows.length} vehicle records</span>
    </div>

    <div className="master-table-wrap" style={{ overflowX: "auto" }}>
      <table className="master-table" style={{ minWidth: 1600 }}>
        <thead><tr><th>Vehicle</th><th>Status</th><th>Cab mobile</th><th>Fuel provider</th><th>Fuel PIN</th><th>Shell card</th><th>BP red card</th><th>BP plain card</th><th>Notes</th><th>Edit</th></tr></thead>
        <tbody>{rows.map((vehicle) => <tr key={vehicle.id}>
          <td><strong>{vehicle.registration}</strong><br/><small>{vehicle.fleetNumber || vehicle.abbreviation || "—"}</small></td>
          <td>{vehicle.active ? "Active" : "Inactive"}</td>
          <td>{vehicle.cabMobile || "—"}</td>
          <td>{vehicle.fuelProvider || "—"}</td>
          <td>{vehicle.fuelPin || "—"}</td>
          <td>{maskCard(vehicle.shellCard)}</td>
          <td>{maskCard(vehicle.bpRedCard)}</td>
          <td>{maskCard(vehicle.bpPlainCard)}</td>
          <td>{vehicle.notes || "—"}</td>
          <td><button onClick={() => { setEditing({ ...vehicle }); }}>Edit</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
