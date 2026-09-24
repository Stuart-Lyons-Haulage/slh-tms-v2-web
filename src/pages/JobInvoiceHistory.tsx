import { useCallback, useMemo, useState } from "react";
import { listRuns } from "../api/runs";
import { api, type DriverAssignment, type Load, type TransportOrder } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";

type HistoryRow = {
  id: string;
  date: string;
  customer: string;
  orderReference: string;
  poNumber: string;
  jobType: string;
  collection: string;
  delivery: string;
  pallets: number | "";
  status: string;
  loadReference: string;
  loadStatus: string;
  driver: string;
  vehicle: string;
  trailer: string;
  source: string;
  invoiceReadiness: "Ready" | "Review" | "Not ready";
  invoiceReason: string;
};

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const fmtDate = (value?: string) => {
  if (!value) return "—";
  const parsed = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
};
const addDays = (date: string, days: number) => {
  const parsed = new Date(`${date}T12:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
};

function statusClass(value: string) {
  const normalised = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (normalised.includes("complete") || normalised.includes("deliver") || normalised.includes("ready")) return "approved";
  if (normalised.includes("cancel") || normalised.includes("reject") || normalised.includes("failed")) return "failed";
  if (normalised.includes("review") || normalised.includes("draft")) return "pendingreview";
  return normalised || "pendingreview";
}

function orderReference(order: TransportOrder) {
  return order.poNumber || order.purchaseOrderNumber || order.sourceOrderReference || order.reference || "—";
}

function runDateInRange(run: Load, from: string, to: string) {
  return run.planningDate >= from && run.planningDate <= to;
}

function buildRows(orders: TransportOrder[], runs: Load[], assignments: DriverAssignment[]): HistoryRow[] {
  const runByOrderId = new Map<string, Load>();
  for (const run of runs) {
    for (const stop of run.stops || []) {
      if (stop.orderId && !runByOrderId.has(stop.orderId)) runByOrderId.set(stop.orderId, run);
    }
  }
  const assignmentByRunId = new Map(assignments.map(item => [item.loadId, item]));

  return orders.map(order => {
    const run = runByOrderId.get(order.id);
    const assignment = run ? assignmentByRunId.get(run.id) : undefined;
    const isDelivered = /delivered|completed/i.test(`${order.status} ${run?.status || ""}`);
    const hasAllocation = Boolean(assignment?.driver || run?.driverId) && Boolean(assignment?.vehicle || run?.vehicleId);
    const invoiceReadiness: HistoryRow["invoiceReadiness"] = isDelivered && hasAllocation ? "Ready" : run ? "Review" : "Not ready";
    const invoiceReason = invoiceReadiness === "Ready"
      ? "Delivered/completed with driver and vehicle evidence"
      : run
        ? "Planned job exists; confirm completion/allocation before invoice"
        : "No planned run linked yet";
    return {
      id: order.id,
      date: order.collectionDate || order.deliveryDate || order.createdAtUtc || "",
      customer: order.customerName || order.customerCode,
      orderReference: order.reference || orderReference(order),
      poNumber: orderReference(order),
      jobType: order.jobType || order.customerSupplier || "Transport",
      collection: order.collectionLocation || order.collectionAddress || "—",
      delivery: order.deliveryLocation || order.deliveryAddress || "—",
      pallets: order.pallets ?? "",
      status: order.status,
      loadReference: run?.reference || "—",
      loadStatus: run?.status || "Unplanned",
      driver: assignment?.driver?.displayName || "—",
      vehicle: assignment?.vehicle?.registration || "—",
      trailer: assignment?.trailerNumber || "—",
      source: order.sourceSubject || order.sourceAttachmentName || order.sourceEmail || "TMS",
      invoiceReadiness,
      invoiceReason,
    };
  }).sort((left, right) => right.date.localeCompare(left.date) || left.customer.localeCompare(right.customer) || left.poNumber.localeCompare(right.poNumber));
}

export function JobInvoiceHistory() {
  const token = useAccessToken();
  const today = todayIsoDate();
  const [from, setFrom] = useState(addDays(today, -14));
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [readiness, setReadiness] = useState("all");
  const orders = useApi(useCallback(async () => api.orders(from, to, await token()), [from, to, token]));
  const runs = useApi(useCallback(async () => (await listRuns(undefined, await token())).filter(run => runDateInRange(run, from, to)), [from, to, token]));
  const assignments = useApi(useCallback(async () => api.driverAssignments(from, to, await token()), [from, to, token]));
  const rows = useMemo(() => buildRows(orders.data || [], runs.data || [], assignments.data || []), [assignments.data, orders.data, runs.data]);
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (readiness !== "all" && row.invoiceReadiness !== readiness) return false;
      if (!q) return true;
      return `${row.customer} ${row.poNumber} ${row.orderReference} ${row.loadReference} ${row.driver} ${row.vehicle} ${row.collection} ${row.delivery} ${row.source}`.toLowerCase().includes(q);
    });
  }, [readiness, rows, search]);
  const ready = visibleRows.filter(row => row.invoiceReadiness === "Ready").length;
  const review = visibleRows.filter(row => row.invoiceReadiness === "Review").length;
  const notReady = visibleRows.filter(row => row.invoiceReadiness === "Not ready").length;
  const loading = orders.loading || runs.loading || assignments.loading;
  const error = orders.error || runs.error || assignments.error;

  function refresh() {
    void orders.refresh();
    void runs.refresh();
    void assignments.refresh();
  }

  function exportCsv() {
    const header = ["Date", "Customer", "Order Ref", "PO", "Job Type", "Collection", "Delivery", "Pallets", "Order Status", "Run", "Run Status", "Driver", "Vehicle", "Trailer", "Invoice Readiness", "Reason", "Source"];
    const lines = [header, ...visibleRows.map(row => [row.date, row.customer, row.orderReference, row.poNumber, row.jobType, row.collection, row.delivery, row.pallets, row.status, row.loadReference, row.loadStatus, row.driver, row.vehicle, row.trailer, row.invoiceReadiness, row.invoiceReason, row.source])];
    const blob = new Blob([lines.map(line => line.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `slh-job-invoice-history-${from}-to-${to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return <section>
    <div className="title-row">
      <div>
        <p className="eyebrow">Accounts / operational history</p>
        <h1>Invoice / Job History</h1>
        <p className="intro">Search historic jobs by order, customer, run, driver or vehicle. The invoice-readiness flag is based on TMS job status plus run allocation/completion evidence.</p>
      </div>
      <button className="primary" type="button" onClick={exportCsv} disabled={!visibleRows.length}>Export CSV</button>
    </div>

    <div className="panel" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      <label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>To<input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
      <label>Invoice readiness<select value={readiness} onChange={event => setReadiness(event.target.value)}><option value="all">All jobs</option><option value="Ready">Ready</option><option value="Review">Review</option><option value="Not ready">Not ready</option></select></label>
      <label style={{ minWidth: 280 }}>Search<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Customer, PO, run, driver, vehicle…" /></label>
      <button type="button" onClick={refresh}>Refresh</button>
    </div>

    <div className="metrics">
      <article className="metric"><span>Jobs shown</span><strong>{visibleRows.length}</strong><small>{from} to {to}</small></article>
      <article className="metric"><span>Invoice ready</span><strong>{ready}</strong><small>Completed with allocation evidence</small></article>
      <article className="metric"><span>Review</span><strong>{review}</strong><small>Planned but needs final evidence</small></article>
      <article className="metric"><span>Not ready</span><strong>{notReady}</strong><small>No linked run yet</small></article>
    </div>

    {loading && !rows.length && <div className="state">Loading job and invoice history…</div>}
    {error && <p className="notice">{error}</p>}
    {!loading && !error && !visibleRows.length && <div className="state">No jobs match this range/search yet.</div>}

    {visibleRows.length > 0 && <div className="panel" style={{ overflowX: "auto" }}>
      <table>
        <thead><tr><th>Date</th><th>Customer / order</th><th>Collection</th><th>Delivery</th><th>Run</th><th>Driver / vehicle</th><th>Status</th><th>Invoice</th></tr></thead>
        <tbody>{visibleRows.map(row => <tr key={row.id}>
          <td><strong>{fmtDate(row.date)}</strong></td>
          <td><strong>{row.customer}</strong><br/><small>PO {row.poNumber} · {row.jobType}</small><br/><small>{row.source}</small></td>
          <td>{row.collection}</td>
          <td>{row.delivery}</td>
          <td><strong>{row.loadReference}</strong><br/><small>{row.loadStatus}</small></td>
          <td><strong>{row.driver}</strong><br/><small>{row.vehicle}{row.trailer !== "—" ? ` · ${row.trailer}` : ""}</small></td>
          <td><span className={`status ${statusClass(row.status)}`}>{row.status}</span><br/><small>{row.pallets || "—"} pallets</small></td>
          <td><span className={`status ${statusClass(row.invoiceReadiness)}`}>{row.invoiceReadiness}</span><br/><small>{row.invoiceReason}</small></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
