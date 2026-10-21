import { useCallback, useEffect } from "react";
import { IntakeHealthPanel } from "../components/IntakeHealthPanel";
import { api } from "../lib/api";
import { todayIsoDate } from "../lib/dateUtils";
import { useTmsQuery } from "../lib/useTmsQuery";

export function OperationsControlClean() {
  const date = todayIsoDate();
  const sage = useTmsQuery(['ops-status', 'sage'] as const, useCallback((t: string) => api.sageHrStatus(t), []));
  const tacho = useTmsQuery(['ops-status', 'tacho'] as const, useCallback((t: string) => api.tachoMasterStatus(t), []));
  const road = useTmsQuery(['ops-status', 'road'] as const, useCallback((t: string) => api.roadTechStatus(t), []));
  const fleetio = useTmsQuery(['ops-status', 'fleetio'] as const, useCallback((t: string) => api.fleetioStatus(t), []));
  const fleet = useTmsQuery(['ops-status', 'fleet'] as const, useCallback((t: string) => api.fleetStatus(t), []));

  const reconciliation = useTmsQuery(['ops-reconciliation', date] as const, useCallback((t: string) => api.operationsReconciliation(date, t), [date]));

  const refreshSage = sage.refetch;
  const refreshTacho = tacho.refetch;
  const refreshRoad = road.refetch;
  const refreshFleetio = fleetio.refetch;
  const refreshFleet = fleet.refetch;
  const refreshReconciliation = reconciliation.refetch;

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
      {reconciliation.error ? <p className="notice inline-notice">{reconciliation.error.message}</p> : reconciliation.isLoading ? <p>Reconciling operational data…</p> : reconciliation.data && <div className="metrics"><article><span>Orders</span><strong>{reconciliation.data.orders.total}</strong><small>{reconciliation.data.orders.readyToPlan} ready to plan</small></article><article><span>Runs</span><strong>{reconciliation.data.loads.total}</strong><small>{reconciliation.data.loads.unallocated} unallocated</small></article><article><span>Drivers</span><strong>{reconciliation.data.fleet.assignedDrivers}/{reconciliation.data.fleet.activeDrivers}</strong><small>assigned / active</small></article><article><span>Vehicles</span><strong>{reconciliation.data.fleet.assignedVehicles}/{reconciliation.data.fleet.activeVehicles}</strong><small>assigned / active</small></article><article><span>Vehicles seen today</span><strong>{reconciliation.data.fleet.vehiclesSeenToday}</strong><small>{reconciliation.data.fleet.vehiclesNoSignal} with no signal</small></article><article><span>Pending review</span><strong>{reconciliation.data.staging.pendingReview}</strong><small>staged records awaiting decision</small></article><article className={reconciliation.data.staging.mappingExceptions ? "attention" : ""}><span>Mapping exceptions</span><strong>{reconciliation.data.staging.mappingExceptions ?? 0}</strong><small>need a customer/site decision</small></article><article className={reconciliation.data.staging.failed ? "attention" : ""}><span>Failed staging</span><strong>{reconciliation.data.staging.failed ?? 0}</strong><small>require replay or investigation</small></article><article><span>Audit backlog</span><strong>{reconciliation.data.audit?.pendingOutbox ?? 0}</strong><small>events awaiting archive/export</small></article></div>}
    </section>

    <IntakeHealthPanel />
  </section>;
}
