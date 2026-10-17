import { useCallback, useEffect, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { MasterDataExportButton } from "../components/MasterDataExportButton";

type Kind = "vehicles" | "trailers";
type MasterRow = Record<string, unknown> & { id: string; active: boolean };

type FleetioAsset = {
  fleetioId: string;
  fleetioName?: string;
  fleetioStatus?: string;
  fleetioVor?: boolean;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  issuesCount?: number;
  workOrdersCount?: number;
  pmiDueUtc?: string;
  motDueUtc?: string;
  serviceStatus?: string;
  matched: boolean;
};

type FleetioVehicle = FleetioAsset & {
  tmsVehicleId?: string;
  registration: string;
  fleetNumber?: string;
  primaryMeterValue?: string;
  primaryMeterUnit?: string;
};

type FleetioTrailer = FleetioAsset & {
  tmsTrailerId?: string;
  trailerNumber: string;
  fleetioCNumber?: string;
  type?: string;
  standardCapacity?: number;
  euroCapacity?: number;
};

type FleetioAssetStatus = {
  configured: boolean;
  connected: boolean;
  retrievedAtUtc: string;
  vehicles: FleetioVehicle[];
  trailers: FleetioTrailer[];
};

type MaintenanceSnapshot = {
  fleetioId: string;
  retrievedAtUtc: string;
  openIssues: Array<{ id: string; number?: string; name: string; state?: string; reportedAtUtc?: string; dueAtUtc?: string }>;
  activeWorkOrders: Array<{ id: string; number?: string; status?: string; description?: string; issuedAtUtc?: string; expectedCompletedAtUtc?: string }>;
  latestInspection?: { id: string; title: string; submittedAtUtc?: string; failedItems?: number; submittedBy?: string };
};

type UnifiedRow = {
  key: string;
  master?: MasterRow;
  fleetio?: FleetioVehicle | FleetioTrailer;
  state: "Linked" | "TMS only" | "Fleetio only";
};

const normalise = (value: unknown) => String(value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const trailerKey = (value: unknown) => {
  const key = normalise(value);
  const match = key.match(/^(?:SLH|TRAILER|TRL)?0*(\d{1,3})$/);
  return match ? String(Number(match[1])) : key;
};
const text = (value: unknown) => value == null || value === "" ? "—" : String(value);
const date = (value?: string) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB");
};
const dateTime = (value?: string) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
};
const description = (asset?: FleetioAsset) => asset ? [asset.year, asset.make, asset.model, asset.trim].filter(Boolean).join(" ") || "—" : "—";
const isVorText = (value: unknown) => {
  const status = String(value ?? "").trim().toLowerCase();
  return status === "vor" || status.includes("vehicle off road") || status.includes("out of service") || status.includes("out-of-service");
};
const isVor = (asset?: FleetioAsset, fallbackStatus?: unknown) => Boolean(asset?.fleetioVor || isVorText(asset?.fleetioStatus) || isVorText(fallbackStatus));
const attention = (asset?: FleetioAsset) => Boolean(asset && (isVor(asset) || (asset.issuesCount || 0) > 0 || (asset.serviceStatus || "").toLowerCase().includes("overdue")));

export function FleetMasterUnified({ kind }: { kind: Kind }) {
  const token = useAccessToken();
  const [masters, setMasters] = useState<MasterRow[]>([]);
  const [fleetio, setFleetio] = useState<FleetioAssetStatus>();
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();
  const [fleetioError, setFleetioError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [selected, setSelected] = useState<MasterRow>();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [maintenance, setMaintenance] = useState<MaintenanceSnapshot>();
  const [maintenanceName, setMaintenanceName] = useState<string>();
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string>();

  const closeMaintenance = useCallback(() => {
    setMaintenance(undefined);
    setMaintenanceError(undefined);
    setMaintenanceName(undefined);
    setMaintenanceLoading(false);
  }, []);

  useEffect(() => {
    if (!(maintenanceLoading || maintenance || maintenanceError)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMaintenance(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMaintenance, maintenance, maintenanceError, maintenanceLoading]);

  const load = useCallback(async () => {
    setLoading(true); setError(undefined); setFleetioError(undefined);
    try {
      const access = await token();
      let nextMasters: MasterRow[] = [];
      try {
        nextMasters = await request<MasterRow[]>(`/api/v1/operational-master-data/${kind}/search?includeInactive=${includeInactive}`, access);
      } catch {
        const fallback = await request<MasterRow[]>(`/api/v1/${kind}`, access);
        nextMasters = fallback.filter(row => includeInactive || row.active !== false);
      }
      setMasters(nextMasters);

      try {
        setFleetio(await request<FleetioAssetStatus>("/api/v1/integrations/fleetio/asset-status-resilient", access, undefined, 60000));
      } catch (exception) {
        try {
          setFleetio(await request<FleetioAssetStatus>("/api/v1/integrations/fleetio/asset-status", access, undefined, 60000));
        } catch {
          setFleetio(undefined);
          setFleetioError(exception instanceof Error ? exception.message : "Fleetio could not be loaded. The TMS master remains available.");
        }
      }
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The fleet master could not be loaded.");
    } finally { setLoading(false); }
  }, [includeInactive, kind, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelected(undefined); setDraft({}); setQuery(""); closeMaintenance(); }, [closeMaintenance, kind]);

  const rows = useMemo<UnifiedRow[]>(() => {
    const result: UnifiedRow[] = [];
    const used = new Set<string>();
    if (kind === "vehicles") {
      const assets = fleetio?.vehicles || [];
      for (const master of masters) {
        const registration = normalise(master.registration);
        const fleetioId = String(master.fleetioId ?? "");
        const asset = assets.find(item => !used.has(item.fleetioId) && (
          item.tmsVehicleId === master.id ||
          (registration && normalise(item.registration) === registration) ||
          (fleetioId && item.fleetioId === fleetioId)
        ));
        if (asset) used.add(asset.fleetioId);
        result.push({ key: `tms-${master.id}`, master, fleetio: asset, state: asset ? "Linked" : "TMS only" });
      }
      for (const asset of assets.filter(item => !used.has(item.fleetioId))) result.push({ key: `fleetio-${asset.fleetioId}`, fleetio: asset, state: "Fleetio only" });
    } else {
      const assets = fleetio?.trailers || [];
      for (const master of masters) {
        const trailerNumber = trailerKey(master.trailerNumber);
        const asset = assets.find(item => !used.has(item.fleetioId) && (
          item.tmsTrailerId === master.id ||
          (trailerNumber && trailerKey(item.trailerNumber) === trailerNumber) ||
          (trailerNumber && trailerKey(item.fleetioName) === trailerNumber)
        ));
        if (asset) used.add(asset.fleetioId);
        result.push({ key: `tms-${master.id}`, master, fleetio: asset, state: asset ? "Linked" : "TMS only" });
      }
      for (const asset of assets.filter(item => !used.has(item.fleetioId))) result.push({ key: `fleetio-${asset.fleetioId}`, fleetio: asset, state: "Fleetio only" });
    }
    const needle = query.trim().toLowerCase();
    return result.filter(row => !needle || JSON.stringify(row).toLowerCase().includes(needle));
  }, [fleetio, kind, masters, query]);

  const linked = rows.filter(row => row.state === "Linked").length;
  const tmsOnly = rows.filter(row => row.state === "TMS only").length;
  const fleetioOnly = rows.filter(row => row.state === "Fleetio only").length;
  const attentionCount = rows.filter(row => attention(row.fleetio)).length;
  const vorCount = rows.filter(row => isVor(row.fleetio, row.master?.fleetioStatus)).length;

  async function syncFleetio() {
    setSyncing(true); setMessage(undefined); setError(undefined);
    try {
      const result = await request<{ message?: string; mappingWarning?: string }>("/api/v1/integrations/fleetio/sync-assets-resilient", await token(), { method: "POST" }, 60000);
      setMessage(result.message || "Fleetio assets were synchronised into the TMS master.");
      await load();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Fleetio sync failed.");
    } finally { setSyncing(false); }
  }

  function edit(row: MasterRow) {
    setSelected(row);
    setDraft({ ...row });
    setMessage(undefined);
  }

  async function save() {
    if (!selected) return;
    setSaving(true); setError(undefined); setMessage(undefined);
    try {
      await request(`/api/v1/operational-master-data/${kind}/${selected.id}`, await token(), { method: "PUT", body: JSON.stringify(draft) });
      setMessage(`${kind === "vehicles" ? "Vehicle" : "Trailer"} updated in the live TMS master. Fleetio information remains linked to the same row.`);
      setSelected(undefined); setDraft({}); await load();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The master record could not be updated.");
    } finally { setSaving(false); }
  }

  async function setActive(row: MasterRow, active: boolean) {
    if (!window.confirm(`${active ? "Restore" : "Archive"} this ${kind === "vehicles" ? "vehicle" : "trailer"}? Historical planning records will be retained.`)) return;
    setSaving(true); setError(undefined);
    try {
      await request(`/api/v1/operational-master-data/${kind}/${row.id}/${active ? "restore" : "archive"}`, await token(), { method: "POST" });
      setMessage(`${kind === "vehicles" ? "Vehicle" : "Trailer"} ${active ? "restored" : "archived"}.`);
      await load();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Archive/restore failed.");
    } finally { setSaving(false); }
  }

  async function showMaintenance(asset: FleetioAsset, label: string) {
    setMaintenanceLoading(true); setMaintenance(undefined); setMaintenanceName(label); setMaintenanceError(undefined);
    try {
      setMaintenance(await request<MaintenanceSnapshot>(`/api/v1/integrations/fleetio/asset-maintenance/${encodeURIComponent(asset.fleetioId)}`, await token(), undefined, 60000));
    } catch (exception) {
      setMaintenanceError(exception instanceof Error ? exception.message : "Fleetio maintenance detail could not be loaded.");
    } finally { setMaintenanceLoading(false); }
  }

  const title = kind === "vehicles" ? "Vehicle master" : "Trailer master";
  const searchPlaceholder = kind === "vehicles" ? "Registration, fleet number, Fleetio ID, make or model…" : "SLH trailer, C-number, Fleetio ID, type or model…";

  const statusCell = (asset?: FleetioAsset, fallback?: unknown) => {
    const status = asset?.fleetioStatus ?? fallback;
    return isVor(asset, fallback)
      ? <span className="vor-badge">VOR · {text(status)}</span>
      : <strong>{text(status)}</strong>;
  };

  return <section className="fleet-master-unified">
    <div className="title-row">
      <div>
        <p className="eyebrow">Single fleet master · TMS + Fleetio</p>
        <h2>{title}</h2>
        <p className="hint">The TMS row is the planning identity. Fleetio maintenance, compliance, specification, defects and work orders are joined onto that same record.</p>
      </div>
      <div className="title-actions">
        <button onClick={() => void load()} disabled={loading}>Refresh</button><MasterDataExportButton section={kind} label={kind === "vehicles" ? "Vehicles" : "Trailers"} rows={(masters) as unknown as Record<string, unknown>[]} />
        <button className="primary" onClick={() => void syncFleetio()} disabled={syncing}>{syncing ? "Syncing…" : "Sync Fleetio into TMS"}</button>
      </div>
    </div>

    {message && <p className="notice inline-notice">{message}</p>}
    {error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>{error}</p>}
    {fleetioError && <p className="notice inline-notice">Fleetio is temporarily unavailable: {fleetioError} The TMS master is still shown below.</p>}

    <div className="metrics fleet-master-metrics">
      <article className="metric"><span>TMS master</span><strong>{masters.length}</strong><small>{kind === "vehicles" ? "vehicle" : "trailer"} records</small></article>
      <article className="metric"><span>Fleetio linked</span><strong>{linked}</strong><small>same canonical row</small></article>
      <article className="metric"><span>TMS only</span><strong>{tmsOnly}</strong><small>not yet linked in Fleetio</small></article>
      <article className="metric"><span>Fleetio only</span><strong>{fleetioOnly}</strong><small>sync/matching required</small></article>
      <article className={vorCount ? "metric vor-metric" : "metric"}><span>VOR</span><strong>{vorCount}</strong><small>vehicle/trailer off road</small></article>
      <article className="metric"><span>Maintenance attention</span><strong>{attentionCount}</strong><small>VOR, issues or overdue service</small></article>
    </div>

    <div className="panel fleet-master-panel">
      <div className="title-row fleet-master-filter-row">
        <label>Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder} /></label>
        <label className="check-label"><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /> Include archived TMS records</label>
      </div>

      {loading && !rows.length ? <div className="state">Loading the joined fleet master…</div> :
        <div className="master-table-wrap fleet-horizontal-scroll">
          {kind === "vehicles" ? <table className="master-table fleet-master-table" style={{ minWidth: 1500 }}>
            <thead><tr><th>Registration</th><th>Fleet no.</th><th>Short code</th><th>Transmission</th><th>Fleetio asset</th><th>Vehicle</th><th>Fleetio status</th><th>Issues</th><th>Work orders</th><th>PMI / service</th><th>MOT</th><th>Link state</th><th>TMS status</th><th>Actions</th></tr></thead>
            <tbody>{rows.map(row => {
              const master = row.master; const asset = row.fleetio as FleetioVehicle | undefined;
              const registration = text(master?.registration ?? asset?.registration);
              const vor = isVor(asset, master?.fleetioStatus);
              return <tr key={row.key} className={vor ? "vor-row" : undefined}>
                <td><strong>{registration}</strong></td>
                <td>{text(master?.fleetNumber ?? asset?.fleetNumber)}</td>
                <td>{text(master?.abbreviation)}</td>
                <td>{text(master?.transmission)}</td>
                <td><small>{asset ? `${text(asset.fleetioName)} · ${asset.fleetioId}` : text(master?.fleetioId)}</small></td>
                <td>{description(asset)}{asset?.vin && <><br/><small>{asset.vin}</small></>}</td>
                <td className={vor ? "vor-cell" : undefined}>{statusCell(asset, master?.fleetioStatus)}</td>
                <td className={(asset?.issuesCount || 0) > 0 ? "fleet-attention-cell" : undefined}><strong>{asset?.issuesCount ?? 0}</strong></td>
                <td>{asset?.workOrdersCount ?? 0}</td>
                <td>{date(asset?.pmiDueUtc)}<br/><small>{text(asset?.serviceStatus)}</small></td>
                <td>{date(asset?.motDueUtc)}</td>
                <td><strong>{row.state === "Linked" ? "✓ Linked" : row.state === "TMS only" ? "TMS only" : "⚠ Fleetio only"}</strong></td>
                <td>{master ? (master.active ? "Active" : "Archived") : "Not in TMS"}</td>
                <td className="fleet-action-cell">{master && <><button onClick={() => edit(master)}>Edit</button>{" "}<button disabled={saving} onClick={() => void setActive(master, !master.active)}>{master.active ? "Archive" : "Restore"}</button>{" "}</>}{asset && <button onClick={() => void showMaintenance(asset, registration)}>Fleetio details</button>}{!master && <button className="primary" disabled={syncing} onClick={() => void syncFleetio()}>Sync to TMS</button>}</td>
              </tr>;
            })}</tbody>
          </table> : <table className="master-table fleet-master-table" style={{ minWidth: 1450 }}>
            <thead><tr><th>SLH trailer</th><th>Type</th><th>Standard cap.</th><th>Euro cap.</th><th>Fleetio C-number</th><th>Fleetio asset</th><th>Specification</th><th>Fleetio status</th><th>Issues</th><th>Work orders</th><th>PMI / service</th><th>Link state</th><th>TMS status</th><th>Actions</th></tr></thead>
            <tbody>{rows.map(row => {
              const master = row.master; const asset = row.fleetio as FleetioTrailer | undefined;
              const trailerNumber = text(master?.trailerNumber ?? asset?.trailerNumber);
              const vor = isVor(asset);
              return <tr key={row.key} className={vor ? "vor-row" : undefined}>
                <td><strong>{trailerNumber}</strong></td>
                <td>{text(master?.type ?? asset?.type)}</td>
                <td>{text(master?.standardCapacity ?? asset?.standardCapacity)}</td>
                <td>{text(master?.euroCapacity ?? asset?.euroCapacity)}</td>
                <td>{text(asset?.fleetioCNumber)}</td>
                <td><small>{asset ? `${text(asset.fleetioName)} · ${asset.fleetioId}` : "—"}</small></td>
                <td>{description(asset)}{asset?.vin && <><br/><small>{asset.vin}</small></>}</td>
                <td className={vor ? "vor-cell" : undefined}>{statusCell(asset)}</td>
                <td className={(asset?.issuesCount || 0) > 0 ? "fleet-attention-cell" : undefined}><strong>{asset?.issuesCount ?? 0}</strong></td>
                <td>{asset?.workOrdersCount ?? 0}</td>
                <td>{date(asset?.pmiDueUtc)}<br/><small>{text(asset?.serviceStatus)}</small></td>
                <td><strong>{row.state === "Linked" ? "✓ Linked" : row.state === "TMS only" ? "TMS only" : "⚠ Fleetio only"}</strong></td>
                <td>{master ? (master.active ? "Active" : "Archived") : "Not in TMS"}</td>
                <td className="fleet-action-cell">{master && <><button onClick={() => edit(master)}>Edit</button>{" "}<button disabled={saving} onClick={() => void setActive(master, !master.active)}>{master.active ? "Archive" : "Restore"}</button>{" "}</>}{asset && <button onClick={() => void showMaintenance(asset, trailerNumber)}>Fleetio details</button>}{!master && <button className="primary" disabled={syncing} onClick={() => void syncFleetio()}>Sync to TMS</button>}</td>
              </tr>;
            })}</tbody>
          </table>}
          {!rows.length && <div className="state">No fleet records match this search.</div>}
        </div>}
    </div>

    {selected && <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Edit ${kind === "vehicles" ? "vehicle" : "trailer"} Master Data`} onMouseDown={event => { if (event.target === event.currentTarget) setSelected(undefined); }}>
      <div className="crm-modal">
        <div className="crm-modal-header">
          <div><p className="eyebrow">{kind === "vehicles" ? "Vehicle" : "Trailer"} Master Data record</p><h2>{text(kind === "vehicles" ? selected.registration : selected.trailerNumber)}</h2><p className="hint">This TMS row is the canonical planning record. Fleetio enriches maintenance/compliance evidence against it.</p></div>
          <button type="button" onClick={() => setSelected(undefined)}>Close</button>
        </div>
        <div className="crm-modal-body">
          <section><h3>Core information</h3>
          {kind === "vehicles" ? <div className="crm-form-grid">
            <label>Registration<input value={String(draft.registration ?? "")} onChange={e => setDraft(v => ({ ...v, registration: e.target.value }))} /></label>
            <label>VIN<input value={String(draft.vin ?? "")} onChange={e => setDraft(v => ({ ...v, vin: e.target.value }))} /></label>
            <label>Owner type<input value={String(draft.ownerType ?? "")} onChange={e => setDraft(v => ({ ...v, ownerType: e.target.value }))} /></label>
            <label>Vehicle site / depot<input value={String(draft.vehicleSite ?? "")} onChange={e => setDraft(v => ({ ...v, vehicleSite: e.target.value }))} /></label>
            <label>Fleet number<input value={String(draft.fleetNumber ?? "")} onChange={e => setDraft(v => ({ ...v, fleetNumber: e.target.value }))} /></label>
            <label>Abbreviation / last 3<input value={String(draft.abbreviation ?? "")} onChange={e => setDraft(v => ({ ...v, abbreviation: e.target.value }))} /></label>
            <label>Transmission<input value={String(draft.transmission ?? "")} onChange={e => setDraft(v => ({ ...v, transmission: e.target.value }))} /></label>
            <label>DVS compliant<input type="checkbox" checked={Boolean(draft.dvsCompliant)} onChange={e => setDraft(v => ({ ...v, dvsCompliant: e.target.checked }))} /></label>
            <label>Fuel provider<input value={String(draft.fuelProvider ?? "")} onChange={e => setDraft(v => ({ ...v, fuelProvider: e.target.value }))} /></label>
            <label>Cab mobile<input value={String(draft.cabMobile ?? "")} onChange={e => setDraft(v => ({ ...v, cabMobile: e.target.value }))} /></label>
            <label>Fuel PIN<input value={String(draft.fuelPin ?? "")} onChange={e => setDraft(v => ({ ...v, fuelPin: e.target.value }))} /></label>
            <label>Shell card<input value={String(draft.shellCard ?? "")} onChange={e => setDraft(v => ({ ...v, shellCard: e.target.value }))} /></label>
            <label>BP red card<input value={String(draft.bpRedCard ?? "")} onChange={e => setDraft(v => ({ ...v, bpRedCard: e.target.value }))} /></label>
            <label>BP plain card<input value={String(draft.bpPlainCard ?? "")} onChange={e => setDraft(v => ({ ...v, bpPlainCard: e.target.value }))} /></label>
            <label>Fuel PIN secret name<input value={String(draft.fuelPinSecretName ?? "")} onChange={e => setDraft(v => ({ ...v, fuelPinSecretName: e.target.value }))} /></label>
            <label>Fuel card last four<input value={String(draft.fuelCardLastFour ?? "")} onChange={e => setDraft(v => ({ ...v, fuelCardLastFour: e.target.value }))} /></label>
            <label>MOT expiry<input type="date" value={String(draft.motExpiry ?? "")} onChange={e => setDraft(v => ({ ...v, motExpiry: e.target.value || null }))} /></label>
            <label>Tacho calibration expiry<input type="date" value={String(draft.tachoCalibrationExpiry ?? "")} onChange={e => setDraft(v => ({ ...v, tachoCalibrationExpiry: e.target.value || null }))} /></label>
            <label>Vehicle test expiry<input type="date" value={String(draft.vehicleTestExpiry ?? "")} onChange={e => setDraft(v => ({ ...v, vehicleTestExpiry: e.target.value || null }))} /></label>
            <label>Fleetio ID<input value={String(draft.fleetioId ?? "")} onChange={e => setDraft(v => ({ ...v, fleetioId: e.target.value }))} /></label>
            <label>Fleetio name<input value={String(draft.fleetioName ?? "")} onChange={e => setDraft(v => ({ ...v, fleetioName: e.target.value }))} /></label>
            <label>Fleetio status<input value={String(draft.fleetioStatus ?? "")} onChange={e => setDraft(v => ({ ...v, fleetioStatus: e.target.value }))} /></label>
            <label style={{ gridColumn: "1 / -1" }}>Notes<textarea rows={4} value={String(draft.notes ?? "")} onChange={e => setDraft(v => ({ ...v, notes: e.target.value }))} /></label>
          </div> : <div className="crm-form-grid">
            <label>SLH trailer number<input value={String(draft.trailerNumber ?? "")} onChange={e => setDraft(v => ({ ...v, trailerNumber: e.target.value }))} /></label>
            <label>Type<input value={String(draft.type ?? "")} onChange={e => setDraft(v => ({ ...v, type: e.target.value }))} /></label>
            <label>Standard capacity<input type="number" value={String(draft.standardCapacity ?? "")} onChange={e => setDraft(v => ({ ...v, standardCapacity: e.target.value === "" ? null : Number(e.target.value) }))} /></label>
            <label>Euro capacity<input type="number" value={String(draft.euroCapacity ?? "")} onChange={e => setDraft(v => ({ ...v, euroCapacity: e.target.value === "" ? null : Number(e.target.value) }))} /></label>
            <label style={{ gridColumn: "1 / -1" }}>Notes<textarea rows={4} value={String(draft.notes ?? "")} onChange={e => setDraft(v => ({ ...v, notes: e.target.value }))} /></label>
          </div>}
          </section>
        </div>
        <div className="crm-modal-actions"><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save Master Data record"}</button><button disabled={saving} onClick={() => setSelected(undefined)}>Cancel</button></div>
      </div>
    </div>}

    {(maintenanceLoading || maintenance || maintenanceError) && <div className="fleetio-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeMaintenance(); }}>
      <section className="fleetio-modal" role="dialog" aria-modal="true" aria-label={`Fleetio details for ${maintenanceName || "asset"}`}>
        <div className="fleetio-modal-header"><div><p className="eyebrow">Live Fleetio maintenance</p><h2>{maintenanceName || "Asset"}</h2></div><button className="fleetio-modal-close" onClick={closeMaintenance} aria-label="Close Fleetio details">Close</button></div>
        <div className="fleetio-modal-body">
          {maintenanceLoading ? <div className="state">Loading defects, inspections and work orders…</div> : maintenanceError ? <div className="state error"><p>{maintenanceError}</p></div> : maintenance && <>
            <p className="hint">Retrieved {dateTime(maintenance.retrievedAtUtc)}</p>
            <div className="fleetio-detail-grid">
              <article><p className="eyebrow">Defects / issues</p><h3>{maintenance.openIssues.length} open</h3>{maintenance.openIssues.length ? maintenance.openIssues.map(issue => <p key={issue.id}><strong>{issue.number ? `#${issue.number} ` : ""}{issue.name}</strong><br/><small>{text(issue.state)} · reported {date(issue.reportedAtUtc)}{issue.dueAtUtc ? ` · due ${date(issue.dueAtUtc)}` : ""}</small></p>) : <p className="hint">No open Fleetio issues returned.</p>}</article>
              <article><p className="eyebrow">Latest inspection</p>{maintenance.latestInspection ? <><h3>{maintenance.latestInspection.title}</h3><p>Submitted {dateTime(maintenance.latestInspection.submittedAtUtc)}</p><p><strong>{maintenance.latestInspection.failedItems ?? 0}</strong> failed item(s)</p>{maintenance.latestInspection.submittedBy && <small>By {maintenance.latestInspection.submittedBy}</small>}</> : <p className="hint">No submitted inspection returned.</p>}</article>
              <article><p className="eyebrow">Work orders</p><h3>{maintenance.activeWorkOrders.length} active</h3>{maintenance.activeWorkOrders.length ? maintenance.activeWorkOrders.map(order => <p key={order.id}><strong>{order.number ? `#${order.number}` : "Work order"} · {text(order.status)}</strong><br/><small>{text(order.description)}{order.expectedCompletedAtUtc ? ` · expected ${date(order.expectedCompletedAtUtc)}` : ""}</small></p>) : <p className="hint">No active Fleetio work orders returned.</p>}</article>
            </div>
          </>}
        </div>
      </section>
    </div>}
  </section>;
}
