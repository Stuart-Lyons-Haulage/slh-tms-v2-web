import { useCallback, useEffect } from "react";
import { IntakeHealthPanel } from "../components/IntakeHealthPanel";
import { api } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

export function OperationsControlClean() {
  const token = useAccessToken();
  const date = todayIsoDate();
  const sage = useApi(useCallback(async () => api.sageHrStatus(await token()), [token]));
  const tacho = useApi(useCallback(async () => api.tachoMasterStatus(await token()), [token]));
  const road = useApi(useCallback(async () => api.roadTechStatus(await token()), [token]));
  const fleetio = useApi(useCallback(async () => api.fleetioStatus(await token()), [token]));
  const fleet = useApi(useCallback(async () => api.fleetStatus(await token()), [token]));

  const reconciliation = useApi(useCallback(async () => api.operationsReconciliation(date, await token()), [date, token]));

  const refreshSage = sage.refresh;
  const refreshTacho = tacho.refresh;
  const refreshRoad = road.refresh;
  const refreshFleetio = fleetio.refresh;
  const refreshFleet = fleet.refresh;
  const refreshReconciliation = reconciliation.refresh;

  const refresh = useCallback(() => {
    void refreshSage();
    void refreshTacho();
    void refreshRoad();
    void refreshFleetio();
    void refreshFleet();
    void refreshReconciliation();
  }, [refreshSage, refreshTacho, refreshRoad, refreshFleetio, refreshFleet, refreshReconciliation]);

  useEffect(() => {
    const interval = window.setInterval(refresh, 60_000);
    const onFocus = () => refresh();
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return <section>
    <div className="title-row"><div><p className="eyebrow">Control & insight</p><h1>Operations control</h1><p className="hint">Operational reconciliation refreshes every 60 seconds and whenever this screen regains focus, so today’s plan and actual coverage stay aligned.</p></div><button onClick={refresh}>Refresh reconciliation</button></div>

    <section className="panel">
      <div className="title-row"><div><p className="eyebrow">Today’s reconciliation</p><h2>Plan versus operational coverage</h2></div></div>
      {reconciliation.error ? <p className="notice inline-notice">{reconciliation.error}</p> : reconciliation.loading ? <p>Reconciling operational data…</p> : reconciliation.data && <div className="metrics"><article><span>Orders</span><strong>{reconciliation.data.orders.total}</strong><small>{reconciliation.data.orders.readyToPlan} ready to plan</small></article><article><span>Runs</span><strong>{reconciliation.data.loads.total}</strong><small>{reconciliation.data.loads.unallocated} unallocated</small></article><article><span>Drivers</span><strong>{reconciliation.data.fleet.assignedDrivers}/{reconciliation.data.fleet.activeDrivers}</strong><small>assigned / active</small></article><article><span>Vehicles</span><strong>{reconciliation.data.fleet.assignedVehicles}/{reconciliation.data.fleet.activeVehicles}</strong><small>assigned / active</small></article><article><span>Vehicles seen today</span><strong>{reconciliation.data.fleet.vehiclesSeenToday}</strong><small>{reconciliation.data.fleet.vehiclesNoSignal} with no signal</small></article><article><span>Pending review</span><strong>{reconciliation.data.staging.pendingReview}</strong><small>staged records awaiting decision</small></article></div>}
    </section>

    <IntakeHealthPanel />
  </section>;
}
