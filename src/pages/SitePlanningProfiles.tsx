import { useCallback, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type Profile = {
  siteId: string;
  externalCode: string;
  name: string;
  collectionAddress?: string;
  defaultTemperatureC?: number;
  region: string;
  source: string;
};

const regions = ["North", "Midlands", "East", "London", "South East", "South West", "West / Wales", "Other"];

export function SitePlanningProfiles() {
  const token = useAccessToken();
  const profiles = useApi(useCallback(async () => request<Profile[]>("/api/v1/site-planning-profiles", await token()), [token]));
  const [editing, setEditing] = useState<Profile>();
  const [temperature, setTemperature] = useState("");
  const [region, setRegion] = useState("Other");
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

  function edit(profile: Profile) {
    setEditing(profile);
    setTemperature(profile.defaultTemperatureC == null ? "" : String(profile.defaultTemperatureC));
    setRegion(profile.region || "Other");
    setMessage(undefined);
  }

  async function save() {
    if (!editing) return;
    const value = temperature.trim() === "" ? null : Number(temperature);
    if (value != null && !Number.isFinite(value)) { setMessage("Enter a valid temperature or leave it blank."); return; }
    setSaving(true);
    try {
      await request(`/api/v1/site-planning-profiles/${editing.siteId}`, await token(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultTemperatureC: value, region }),
      });
      setMessage(`${editing.name} planning profile updated.`);
      setEditing(undefined);
      await profiles.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Site planning profile could not be saved."); }
    finally { setSaving(false); }
  }

  return <div className="panel" style={{ marginTop: 16 }}>
    <div className="title-row"><div><p className="eyebrow">Planning profile</p><h2>Site temperatures & regions</h2><p className="hint">Order temperature always overrides the site default. Defaults are used only when an incoming order has no temperature. Region controls how delivery columns are grouped on Pallet Control.</p></div><button onClick={() => void profiles.refresh()}>Refresh</button></div>
    {message && <p className="notice inline-notice">{message}</p>}{profiles.error && <p className="notice inline-notice">{profiles.error}</p>}
    {editing && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginBottom: 16, alignItems: "end" }}>
      <label>Site<input value={editing.name} disabled /></label>
      <label>Default temperature °C<input type="number" step="0.5" min="-30" max="30" value={temperature} onChange={(e) => setTemperature(e.target.value)} placeholder="No default" /></label>
      <label>Planning region<select value={region} onChange={(e) => setRegion(e.target.value)}>{regions.map((item) => <option key={item}>{item}</option>)}</select></label>
      <div style={{ display: "flex", gap: 8 }}><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save profile"}</button><button onClick={() => setEditing(undefined)}>Cancel</button></div>
    </div>}
    <div style={{ overflowX: "auto" }}><table className="master-table"><thead><tr><th>Site</th><th>Code</th><th>Default temp</th><th>Region</th><th>Address</th><th></th></tr></thead><tbody>{(profiles.data || []).map((profile) => <tr key={profile.siteId}><td><strong>{profile.name}</strong></td><td>{profile.externalCode}</td><td>{profile.defaultTemperatureC == null ? "—" : `${profile.defaultTemperatureC > 0 ? "+" : ""}${profile.defaultTemperatureC}°C`}</td><td>{profile.region}</td><td>{profile.collectionAddress || "—"}</td><td><button onClick={() => edit(profile)}>Edit</button></td></tr>)}</tbody></table></div>
  </div>;
}
