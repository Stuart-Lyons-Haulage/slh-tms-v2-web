import { useCallback, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type FleetioAsset = {
  fleetioId: string;
  fleetioName?: string;
  fleetioStatus?: string;
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

type FleetioAssetStatus = {
  configured: boolean;
  connected: boolean;
  retrievedAtUtc: string;
  vehicles: Array<FleetioAsset & {
    tmsVehicleId?: string;
    registration: string;
    fleetNumber?: string;
    primaryMeterValue?: string;
    primaryMeterUnit?: string;
  }>;
  trailers: Array<FleetioAsset & {
    tmsTrailerId?: string;
    trailerNumber: string;
    fleetioCNumber?: string;
    type?: string;
  }>;
};

type MaintenanceSnapshot = {
  fleetioId: string;
  retrievedAtUtc: string;
  openIssues: Array<{ id: string; number?: string; name: string; state?: string; reportedAtUtc?: string; dueAtUtc?: string }>;
  activeWorkOrders: Array<{ id: string; number?: string; status?: string; description?: string; issuedAtUtc?: string; expectedCompletedAtUtc?: string }>;
  latestInspection?: { id: string; title: string; submittedAtUtc?: string; failedItems?: number; submittedBy?: string };
};

function date(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB");
}

function dateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function text(value?: string) {
  return value?.trim() || "—";
}

function vehicleDescription(asset: FleetioAsset) {
  return [asset.year?.toString(), asset.make, asset.model, asset.trim].filter(Boolean).join(" ") || "—";
}

export function FleetAssetsOperational() {
  const token = useAccessToken();
  const status = useApi(useCallback(async () => request<FleetioAssetStatus>("/api/v1/integrations/fleetio/asset-status", await token()), [token]));
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>();
  const [maintenance, setMaintenance] = useState<MaintenanceSnapshot>();
  const [maintenanceName, setMaintenanceName] = useState<string>();
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string>();

  async function sync() {
    setSyncing(true);
    setMessage(undefined);
    try {
      const result = await request<{ message?: string }>("/api/v1/integrations/fleetio/sync-assets", await token(), { method: "POST" }, 60000);
      setMessage(result.message || "Fleetio asset sync completed.");
      await status.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fleetio sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function showMaintenance(fleetioId: string, name: string) {
    setMaintenanceLoading(true);
    setMaintenance(undefined);
    setMaintenanceName(name);
    setMaintenanceError(undefined);
    try {
      setMaintenance(await request<MaintenanceSnapshot>(`/api/v1/integrations/fleetio/asset-maintenance/${encodeURIComponent(fleetioId)}`, await token(), {}, 60000));
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : "Fleetio maintenance detail could not be loaded.");
    } finally {
      setMaintenanceLoading(false);
    }
  }

  const allAssets = status.data ? [...status.data.vehicles, ...status.data.trailers] : [];
  const dueAttention = allAssets.filter(asset =>
    (asset.serviceStatus || "").toLowerCase().includes("overdue") ||
    (asset.issuesCount || 0) > 0
  ).length;

  return (
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">Fleetio maintenance & compliance</p>
          <h1>Vehicles & trailers</h1>
          <p className="hint">The TMS remains the planning system. Fleetio is the maintenance and compliance source for asset identity, status, service dates, defects, inspections and work orders.</p>
        </div>
        <div className="title-actions">
          <button onClick={() => void status.refresh()} disabled={status.loading}>Refresh</button>
          <button className="primary" onClick={() => void sync()} disabled={syncing}>{syncing ? "Syncing Fleetio…" : "Sync Fleetio"}</button>
        </div>
      </div>
      {message && <p className="notice inline-notice">{message}</p>}
      {status.error ? <div className="state error"><p>{status.error}</p></div> : status.loading && !status.data ? <div className="state">Loading Fleetio assets…</div> : (
        <>
          {status.data && <div className="metrics">
            <article className="metric"><span>Fleetio connection</span><strong>{status.data.connected ? "Connected" : "Unavailable"}</strong><small>Retrieved {dateTime(status.data.retrievedAtUtc)}</small></article>
            <article className="metric"><span>Vehicles</span><strong>{status.data.vehicles.length}</strong><small>{status.data.vehicles.filter(x => x.matched).length} matched to TMS</small></article>
            <article className="metric"><span>Trailers</span><strong>{status.data.trailers.length}</strong><small>{status.data.trailers.filter(x => x.matched).length} matched to TMS</small></article>
            <article className="metric"><span>Maintenance attention</span><strong>{dueAttention}</strong><small>Assets with Fleetio issues or overdue maintenance</small></article>
          </div>}

          {(maintenanceLoading || maintenance || maintenanceError) && <div className="panel">
            <div className="title-row">
              <div>
                <p className="eyebrow">Live Fleetio detail</p>
                <h2>{maintenanceName || "Asset maintenance"}</h2>
              </div>
              <button onClick={() => { setMaintenance(undefined); setMaintenanceError(undefined); setMaintenanceName(undefined); }}>Close</button>
            </div>
            {maintenanceLoading ? <div className="state">Loading defects, inspections and work orders…</div> : maintenanceError ? <div className="state error"><p>{maintenanceError}</p></div> : maintenance && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              <article>
                <p className="eyebrow">Defects / issues</p>
                <h3>{maintenance.openIssues.length} open</h3>
                {maintenance.openIssues.length === 0 ? <p className="hint">No open Fleetio issues returned.</p> : maintenance.openIssues.map(issue => <p key={issue.id}><strong>{issue.number ? `#${issue.number} ` : ""}{issue.name}</strong><br /><small>{text(issue.state)} · reported {date(issue.reportedAtUtc)}{issue.dueAtUtc ? ` · due ${date(issue.dueAtUtc)}` : ""}</small></p>)}
              </article>
              <article>
                <p className="eyebrow">Latest inspection</p>
                {maintenance.latestInspection ? <><h3>{maintenance.latestInspection.title}</h3><p>Submitted {dateTime(maintenance.latestInspection.submittedAtUtc)}</p><p><strong>{maintenance.latestInspection.failedItems ?? 0}</strong> failed item(s)</p><small>{maintenance.latestInspection.submittedBy ? `By ${maintenance.latestInspection.submittedBy}` : "Fleetio inspection"}</small></> : <p className="hint">No submitted inspection returned.</p>}
              </article>
              <article>
                <p className="eyebrow">Work orders</p>
                <h3>{maintenance.activeWorkOrders.length} active</h3>
                {maintenance.activeWorkOrders.length === 0 ? <p className="hint">No active Fleetio work orders returned.</p> : maintenance.activeWorkOrders.map(order => <p key={order.id}><strong>{order.number ? `#${order.number}` : "Work order"} · {text(order.status)}</strong><br /><small>{text(order.description)}{order.expectedCompletedAtUtc ? ` · expected ${date(order.expectedCompletedAtUtc)}` : ""}</small></p>)}
              </article>
            </div>}
          </div>}

          <div className="panel">
            <p className="eyebrow">Powered fleet</p>
            <h2>Vehicles</h2>
            <p className="hint">Registration and fleet number remain the TMS planning identity. Fleetio supplies the asset specification and maintenance/compliance position.</p>
            <div className="master-table-wrap" style={{ overflowX: "auto" }}>
              <table className="master-table" style={{ minWidth: 1780 }}>
                <thead><tr><th>Registration</th><th>Fleet no.</th><th>Fleetio ID</th><th>Vehicle</th><th>VIN</th><th>Fleetio status</th><th>Issues</th><th>Work orders</th><th>PMI / service due</th><th>MOT due</th><th>Maintenance</th><th>TMS match</th><th>Detail</th></tr></thead>
                <tbody>{(status.data?.vehicles || []).map((vehicle) => (
                  <tr key={vehicle.fleetioId}>
                    <td><strong>{vehicle.registration}</strong></td>
                    <td>{text(vehicle.fleetNumber)}</td>
                    <td><small>{text(vehicle.fleetioId)}</small></td>
                    <td>{vehicleDescription(vehicle)}<br /><small>{text(vehicle.fleetioName)}</small></td>
                    <td><small>{text(vehicle.vin)}</small></td>
                    <td><strong>{text(vehicle.fleetioStatus)}</strong></td>
                    <td><strong>{vehicle.issuesCount ?? 0}</strong></td>
                    <td>{vehicle.workOrdersCount ?? 0}</td>
                    <td>{date(vehicle.pmiDueUtc)}</td>
                    <td>{date(vehicle.motDueUtc)}</td>
                    <td>{text(vehicle.serviceStatus)}</td>
                    <td>{vehicle.matched ? "✓ Matched" : "⚠ Needs matching"}</td>
                    <td><button onClick={() => void showMaintenance(vehicle.fleetioId, vehicle.registration)}>View</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <p className="eyebrow">Trailer fleet</p>
            <h2>Trailers</h2>
            <p className="hint">The SLH trailer number remains the TMS planning identity. Fleetio C-number, specification and compliance information stay linked to the same asset.</p>
            <div className="master-table-wrap" style={{ overflowX: "auto" }}>
              <table className="master-table" style={{ minWidth: 1780 }}>
                <thead><tr><th>SLH trailer</th><th>Fleetio C-number</th><th>Fleetio ID</th><th>Specification</th><th>VIN</th><th>Type</th><th>Fleetio status</th><th>Issues</th><th>Work orders</th><th>PMI / service due</th><th>MOT due</th><th>Maintenance</th><th>TMS match</th><th>Detail</th></tr></thead>
                <tbody>{(status.data?.trailers || []).map((trailer) => (
                  <tr key={trailer.fleetioId}>
                    <td><strong>{trailer.trailerNumber}</strong></td>
                    <td>{text(trailer.fleetioCNumber)}</td>
                    <td><small>{text(trailer.fleetioId)}</small></td>
                    <td>{vehicleDescription(trailer)}<br /><small>{text(trailer.fleetioName)}</small></td>
                    <td><small>{text(trailer.vin)}</small></td>
                    <td>{text(trailer.type)}</td>
                    <td><strong>{text(trailer.fleetioStatus)}</strong></td>
                    <td><strong>{trailer.issuesCount ?? 0}</strong></td>
                    <td>{trailer.workOrdersCount ?? 0}</td>
                    <td>{date(trailer.pmiDueUtc)}</td>
                    <td>{date(trailer.motDueUtc)}</td>
                    <td>{text(trailer.serviceStatus)}</td>
                    <td>{trailer.matched ? "✓ Matched" : "⚠ Needs matching"}</td>
                    <td><button onClick={() => void showMaintenance(trailer.fleetioId, trailer.trailerNumber)}>View</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
