import { useCallback, useMemo, useState } from "react";
import { apiBaseUrl, request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { SourceEmailEvidenceDrawer } from "./SourceEmailEvidenceDrawer";

type ControlRow = {
  evidenceId: string; messageId: string; sender?: string; subject?: string; receivedAtUtc: string;
  direction: string; attachmentCount: number; accountedRows: number; expectedRows: number;
  pendingReview: number; failed: number; linkedOrders: number; plannedOrders: number; status: string; detail: string;
};
type Snapshot = {
  generatedAtUtc: string; sourcesReceived: number; outboundPlansExcluded: number; ordersCaptured: number;
  awaitingReview: number; parserFailures: number; duplicateCandidates: number; missingSourceRows: number;
  approvedAwaitingPlanning: number; plannerGaps: number; records: ControlRow[];
};

const displayTime = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });

export function OrderIntakeControlCentre() {
  const token = useAccessToken();
  const [days, setDays] = useState(14);
  const [status, setStatus] = useState("Exceptions");
  const [sourceId, setSourceId] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const fromUtc = useMemo(() => new Date(Date.now() - days * 86_400_000).toISOString(), [days]);
  const data = useApi(useCallback(async () => request<Snapshot>(`/api/v1/order-intake/control-centre?fromUtc=${encodeURIComponent(fromUtc)}`, await token()), [fromUtc, token]));
  const records = (data.data?.records ?? []).filter(row => status === "All" || (status === "Exceptions" ? !["Captured", "Excluded"].includes(row.status) : row.status === status));

  async function exportReconciliation() {
    setExporting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/order-intake/control-centre/export.csv?fromUtc=${encodeURIComponent(fromUtc)}`, { headers: { Authorization: `Bearer ${await token()}` } });
      if (!response.ok) throw new Error(`Export failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `order-intake-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  }

  return <section className="panel">
    <div className="title-row" style={{ alignItems: "end", gap: 12 }}>
      <div><p className="eyebrow">Independent source-to-plan check</p><h2>Order Intake Control Centre</h2><p className="hint">Inbound evidence is compared with staged rows, live orders and saved runs. Outbound Lyons plans are comparison evidence only.</p></div>
      <div className="title-actions" style={{ gap: 8 }}>
        <label>Window <select value={days} onChange={event => setDays(Number(event.currentTarget.value))}><option value={2}>2 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label>
        <button type="button" onClick={() => void data.refresh()} disabled={data.loading}>{data.loading ? "Checking…" : "Refresh"}</button>
        <button type="button" onClick={() => void exportReconciliation()} disabled={exporting}>{exporting ? "Exporting…" : "Excel reconciliation"}</button>
      </div>
    </div>
    {data.error && <div className="state error">{data.error}</div>}
    {data.data && <>
      <div className="review-metrics" style={{ marginTop: 14 }}>
        <article><span>Sources</span><strong>{data.data.sourcesReceived}</strong><small>{data.data.outboundPlansExcluded} outbound plans excluded</small></article>
        <article><span>Rows captured</span><strong>{data.data.ordersCaptured}</strong><small>Accounted source rows</small></article>
        <article className={data.data.awaitingReview ? "attention" : ""}><span>Awaiting review</span><strong>{data.data.awaitingReview}</strong><small>Action required</small></article>
        <article className={data.data.parserFailures ? "attention" : ""}><span>Parser failures</span><strong>{data.data.parserFailures}</strong><small>No silent failures</small></article>
        <article className={data.data.missingSourceRows ? "attention" : ""}><span>Missing rows</span><strong>{data.data.missingSourceRows}</strong><small>Source count mismatch</small></article>
        <article className={data.data.duplicateCandidates ? "attention" : ""}><span>Duplicates</span><strong>{data.data.duplicateCandidates}</strong><small>Ambiguous active matches</small></article>
        <article className={data.data.approvedAwaitingPlanning ? "attention" : ""}><span>Not promoted</span><strong>{data.data.approvedAwaitingPlanning}</strong><small>Approved without live order</small></article>
        <article className={data.data.plannerGaps ? "attention" : ""}><span>Planner gaps</span><strong>{data.data.plannerGaps}</strong><small>Live order missing from run</small></article>
      </div>
      <div style={{ margin: "14px 0 8px" }}><label>Show <select value={status} onChange={event => setStatus(event.currentTarget.value)}><option>Exceptions</option><option>All</option><option>ParserFailure</option><option>AwaitingReview</option><option>DuplicateCandidate</option><option>MissingSourceRows</option><option>ApprovedAwaitingPlanning</option><option>PlannerGap</option><option>Captured</option><option>Excluded</option></select></label></div>
      {records.length === 0 ? <div className="state">No records match this view.</div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Received</th><th>Source</th><th>Classification</th><th>Rows</th><th>Orders / runs</th><th>Reason</th><th /></tr></thead><tbody>{records.map(row => <tr key={row.evidenceId}><td>{displayTime(row.receivedAtUtc)}</td><td><strong>{row.subject || "No subject"}</strong><br/><span className="hint">{row.sender || "Unknown sender"}</span></td><td><span className={`status ${["Captured", "Excluded"].includes(row.status) ? "approved" : "warning"}`}>{row.status}</span><br/><small>{row.direction}</small></td><td>{row.accountedRows} / {row.expectedRows}</td><td>{row.linkedOrders} / {row.plannedOrders}</td><td>{row.detail}</td><td><button type="button" onClick={() => setSourceId(row.evidenceId)}>Open source</button></td></tr>)}</tbody></table></div>}
      <p className="hint" style={{ marginTop: 10 }}>Last compared {displayTime(data.data.generatedAtUtc)}. The scheduled comparison runs every two hours, 06:00–20:00 on weekdays.</p>
    </>}
    {sourceId && <SourceEmailEvidenceDrawer stagingId={sourceId} onClose={() => setSourceId(undefined)} />}
  </section>;
}
