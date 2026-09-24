import { useCallback, useMemo, useState } from "react";
import { GeofenceStatusBadge, SiteCoverageWarningPanel, useSiteGeofenceCoverage } from "../components/GeofenceCoverageWarnings";
import type { SiteCoverage } from "../components/siteGeofenceCoverageLogic";
import { api, request, type TransportOrder } from "../lib/api";
import { orderMaintenance, type OrderUpdatePayload } from "../lib/orderMaintenance";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

function tagged(notes: string | undefined, label: string) {
  if (!notes) return "";
  const prefix = `${label}:`;
  return notes.split("·").map((part) => part.trim()).find((part) => part.toLowerCase().startsWith(prefix.toLowerCase()))?.slice(prefix.length).trim() || "";
}

export function approvedOrderMarketDetail(order: TransportOrder) {
  const market = tagged(order.driverInstructions, "Market");
  const customer = tagged(order.driverInstructions, "Market customer");
  const stand = tagged(order.driverInstructions, "Stall / stand");
  const salesman = tagged(order.driverInstructions, "Salesman");
  return { market, customer, stand, salesman, isMarket: Boolean(market || customer || stand) };
}

export function approvedOrderPhysicalDestination(order: TransportOrder) {
  const detail = approvedOrderMarketDetail(order);
  if (detail.isMarket) {
    return detail.market || order.marketName || tagged(order.driverInstructions, "Depot") || "";
  }
  // For standard depot/store work the destination is the physical Site. Generic incoming
  // customer/depot labels (SAINSBURY, WAITROSE, ALDI, etc.) must not become a second Site.
  return order.stallNumber || tagged(order.driverInstructions, "Depot") || order.marketName || "";
}

function editable(order: TransportOrder): OrderUpdatePayload {
  const detail = approvedOrderMarketDetail(order);
  const physicalDestination = approvedOrderPhysicalDestination(order);
  return {
    reference: order.reference,
    customerCode: order.customerCode,
    collectionDate: order.collectionDate,
    deliveryDate: order.deliveryDate || order.collectionDate,
    pallets: order.pallets,
    collectionSite: order.sellerName || tagged(order.driverInstructions, "Collection site"),
    depotId: physicalDestination,
    destination: detail.isMarket ? (detail.stand || order.stallNumber || physicalDestination) : physicalDestination,
    deliveryAddress: tagged(order.driverInstructions, "Delivery address"),
    customerRef: tagged(order.driverInstructions, "Customer ref"),
    poRef: tagged(order.driverInstructions, "PO ref"),
    palletName: tagged(order.driverInstructions, "Pallet"),
    unitType: tagged(order.driverInstructions, "Unit type") || tagged(order.driverInstructions, "Capacity type") || "Pallets",
    notes: "",
    mapLink: order.mapLink,
  };
}

function aliases(value?: string) {
  return String(value || "").split(/[,;|\n\r]+/).map(item => item.trim()).filter(Boolean);
}

export function JobsOperational({ date }: { date: string }) {
  const token = useAccessToken();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [form, setForm] = useState<OrderUpdatePayload>();
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [aliasBusy, setAliasBusy] = useState(false);
  const orders = useApi(useCallback(async () => api.orders(date, date, await token()), [date, token]));

  const rows = useMemo(() => (orders.data || []).filter((order) => {
    if (order.status === "Cancelled") return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [order.reference, order.customerCode, order.sellerName, order.marketName, order.stallNumber, order.driverInstructions]
      .some((value) => String(value || "").toLowerCase().includes(q));
  }), [orders.data, query]);

  // Only physical collection/delivery Sites participate in geofence coverage. For normal work
  // the Depot is the same canonical Site as Destination. For market work only the physical
  // Market Site owns the geofence; trader names, stands, stalls, units and arches are detail.
  const siteLabels = useMemo(() => Array.from(new Set(rows.flatMap(order => [
    order.sellerName,
    approvedOrderPhysicalDestination(order),
  ]).map(value => String(value || "").trim()).filter(Boolean))), [rows]);
  const geofenceCoverage = useSiteGeofenceCoverage(siteLabels);

  function begin(order: TransportOrder) {
    setEditingId(order.id);
    setForm(editable(order));
    setMessage(undefined);
  }

  async function save() {
    if (!editingId || !form) return;
    setSaving(true);
    setMessage(undefined);
    try {
      await orderMaintenance.update(editingId, form, await token());
      setEditingId(undefined);
      setForm(undefined);
      await orders.refresh();
      await geofenceCoverage.refresh();
      setMessage("Job amended successfully. Planner data has been refreshed from the saved order.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The job could not be amended.");
    } finally {
      setSaving(false);
    }
  }

  async function applySuggestedAliases(items: SiteCoverage[]) {
    const applicable = items.filter(item => item.state === "unresolved" && item.suggestedSiteId);
    if (!applicable.length || aliasBusy) return;
    setAliasBusy(true);
    setMessage(undefined);
    try {
      const access = await token();
      const grouped = new Map<string, { existing: string[]; labels: string[]; siteName: string }>();
      for (const item of applicable) {
        const siteId = item.suggestedSiteId!;
        const current = grouped.get(siteId) || {
          existing: aliases(item.suggestedSiteAliases),
          labels: [],
          siteName: item.suggestedSiteName || item.suggestedSiteCode || "Site",
        };
        current.labels.push(item.sourceLabel);
        grouped.set(siteId, current);
      }

      let added = 0;
      for (const [siteId, group] of grouped) {
        const combined = Array.from(new Set([...group.existing, ...group.labels].map(value => value.trim()).filter(Boolean)));
        await request(`/api/v2/sites/${encodeURIComponent(siteId)}/aliases`, access, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aliases: combined.join("; ") }),
        });
        added += group.labels.length;
      }

      await geofenceCoverage.refresh();
      setMessage(`${added} Site alias${added === 1 ? "" : "es"} saved to Site Master. Matching orders now reuse the canonical Site/geofence instead of creating another daily warning.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The suggested Site alias could not be saved.");
    } finally {
      setAliasBusy(false);
    }
  }

  async function cancel(order: TransportOrder) {
    if (!window.confirm(`Delete ${order.reference}? The job will be cancelled for audit purposes and removed from any run.`)) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await orderMaintenance.cancel(order.id, await token());
      await orders.refresh();
      setMessage(`${order.reference} cancelled. ${result.removedStops ? `${result.removedStops} linked run stop${result.removedStops === 1 ? " was" : "s were"} removed.` : "It was not attached to a run."}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The job could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  async function clearAllOpenJobs() {
    if (!window.confirm("Clear ALL open jobs currently in the TMS? Delivered history will be retained, but every other open job will be cancelled and removed from planning.")) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await request<{ cancelled: number; removedStops: number; message: string }>("/api/v2/orders/open", await token(), { method: "DELETE" });
      setEditingId(undefined);
      setForm(undefined);
      await orders.refresh();
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Open jobs could not be cleared.");
    } finally {
      setSaving(false);
    }
  }

  const set = (name: keyof OrderUpdatePayload, value: string) => setForm((current) => current ? ({ ...current, [name]: name === "pallets" ? (value === "" ? undefined : Number(value)) : value }) : current);
  const unitLabel = form?.unitType || "Pallets";

  return <section>
    <div className="planner-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, order, market, stall, address…" />
      <span>{rows.length} active job{rows.length === 1 ? "" : "s"} for {date}</span>
      <button onClick={() => void Promise.all([orders.refresh(), geofenceCoverage.refresh()])} disabled={orders.loading || saving || aliasBusy}>Refresh jobs</button>
      <button onClick={() => void clearAllOpenJobs()} disabled={saving || aliasBusy}>Clear all open jobs</button>
    </div>
    {message && <p className="notice inline-notice">{message}</p>}
    {orders.error && <p className="notice inline-notice">{orders.error}</p>}
    {geofenceCoverage.error && <p className="notice inline-notice" style={{ borderColor: "#b42318" }}>⚠ Site/geofence coverage could not be checked. Orders remain available, but location linkage is unconfirmed.</p>}
    <SiteCoverageWarningPanel
      issues={geofenceCoverage.issues}
      title="ORDER SITE / GEOFENCE COVERAGE"
      aliasBusy={aliasBusy}
      onApplySuggestedAlias={(issue) => void applySuggestedAliases([issue])}
      onApplyAllSuggestedAliases={() => void applySuggestedAliases(geofenceCoverage.issues)}
    />
    <div className="master-table-wrap" style={{ overflowX: "auto" }}>
      <table className="master-table" style={{ minWidth: 1320 }}>
        <thead><tr><th>Order</th><th>Customer</th><th>Collection</th><th>Market / Depot</th><th>Destination / Market detail</th><th>Delivery address</th><th>Quantity</th><th>Unit</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((order) => {
          const detail = approvedOrderMarketDetail(order);
          const physicalDestination = approvedOrderPhysicalDestination(order);
          const destinationCoverage = geofenceCoverage.resultFor(physicalDestination);
          return <tr key={order.id}>
            <td><strong>{order.reference}</strong></td>
            <td>{order.customerCode}</td>
            <td>{order.sellerName || "—"}<GeofenceStatusBadge result={geofenceCoverage.resultFor(order.sellerName)} /></td>
            <td>{physicalDestination || "—"}<GeofenceStatusBadge result={destinationCoverage} /></td>
            <td>{detail.isMarket
              ? <><strong>{detail.customer || "Market customer"}</strong>{detail.stand && <small style={{ display: "block", marginTop: 3 }}>Stand / stall: {detail.stand}</small>}{detail.salesman && <small style={{ display: "block", marginTop: 2 }}>Salesman: {detail.salesman}</small>}</>
              : <>{physicalDestination || "—"}</>}</td>
            <td>{tagged(order.driverInstructions, "Delivery address") || "—"}</td>
            <td>{order.pallets ?? "—"}</td><td>{tagged(order.driverInstructions, "Unit type") || "Pallets"}</td><td>{order.status}</td>
            <td><div style={{ display: "flex", gap: 8 }}><button onClick={() => begin(order)}>Edit</button><button onClick={() => void cancel(order)} disabled={saving || aliasBusy}>Delete</button></div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!orders.loading && !rows.length && <p className="state">No active imported jobs for this date.</p>}

    {editingId && form && <div className="job-edit-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setEditingId(undefined); setForm(undefined); } }}>
      <section className="job-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit job ${form.reference}`}>
        <div className="job-edit-modal-header">
          <div><p className="eyebrow">Edit job</p><h2>{form.reference}</h2></div>
          <button onClick={() => { setEditingId(undefined); setForm(undefined); }} disabled={saving}>Close</button>
        </div>
        <div className="job-edit-modal-body">
          <div className="form-grid">
            <label>Order / reference<input value={form.reference} onChange={(e) => set("reference", e.target.value)} /></label>
            <label>Customer<input value={form.customerCode} onChange={(e) => set("customerCode", e.target.value)} /></label>
            <label>Collection date<input type="date" value={form.collectionDate} onChange={(e) => set("collectionDate", e.target.value)} /></label>
            <label>Delivery date<input type="date" value={form.deliveryDate || ""} onChange={(e) => set("deliveryDate", e.target.value)} /></label>
            <label>Collection site<input value={form.collectionSite || ""} onChange={(e) => set("collectionSite", e.target.value)} /></label>
            <label>Depot / market<input value={form.depotId || ""} onChange={(e) => set("depotId", e.target.value)} /></label>
            <label>Destination<input value={form.destination || ""} onChange={(e) => set("destination", e.target.value)} /></label>
            <label>Delivery address / postcode<input value={form.deliveryAddress || ""} onChange={(e) => set("deliveryAddress", e.target.value)} /></label>
            <label>Quantity<input inputMode="numeric" value={form.pallets ?? ""} onChange={(e) => set("pallets", e.target.value)} /></label>
            <label>Unit type<select value={unitLabel} onChange={(e) => set("unitType", e.target.value)}><option>Pallets</option><option>Trays</option><option>Trolleys</option></select></label>
            <label>Customer ref<input value={form.customerRef || ""} onChange={(e) => set("customerRef", e.target.value)} /></label>
            <label>PO ref<input value={form.poRef || ""} onChange={(e) => set("poRef", e.target.value)} /></label>
            <label>{unitLabel === "Pallets" ? "Pallet / product" : "Product / load description"}<input value={form.palletName || ""} onChange={(e) => set("palletName", e.target.value)} /></label>
          </div>
        </div>
        <div className="job-edit-modal-footer">
          <button onClick={() => { setEditingId(undefined); setForm(undefined); }} disabled={saving}>Cancel</button>
          <button className="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save job changes"}</button>
        </div>
      </section>
    </div>}
  </section>;
}
