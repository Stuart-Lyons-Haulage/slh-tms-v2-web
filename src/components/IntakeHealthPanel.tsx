import { useCallback } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type IntakeHealth = {
  fromUtc: string;
  generatedAtUtc: string;
  evidenceEmails: number;
  orderRecords: number;
  pendingReview: number;
  promoted: number;
  rejected: number;
  failed: number;
  mappingExceptions: number;
  fastPathOrders: number;
  lastEmailReceivedUtc?: string;
  lastOrderStagedUtc?: string;
  lastPromotedUtc?: string;
  healthy: boolean;
  warnings: string[];
  note: string;
};

function time(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

export function IntakeHealthPanel() {
  const token = useAccessToken();
  const health = useApi(useCallback(async () => request<IntakeHealth>("/api/v1/intake-health", await token()), [token]));

  return <section className="panel" style={{ marginBottom: 18 }}>
    <div className="title-row" style={{ alignItems: "end" }}>
      <div>
        <p className="eyebrow">Info mailbox health · last 24 hours</p>
        <h2 style={{ marginBottom: 4 }}>Order intake health</h2>
        <p className="hint" style={{ marginBottom: 0 }}>Shows retained inbound evidence, staged orders and anything needing mapping attention.</p>
      </div>
      <button type="button" onClick={() => void health.refresh()} disabled={health.loading}>{health.loading ? "Checking…" : "Refresh health"}</button>
    </div>

    {health.error && <div className="state error" style={{ marginTop: 12 }}>{health.error}</div>}
    {health.data && <>
      <div className="review-metrics" style={{ marginTop: 14 }}>
        <article><span>Email evidence</span><strong>{health.data.evidenceEmails}</strong><small>Retained inbound messages</small></article>
        <article><span>Orders extracted</span><strong>{health.data.orderRecords}</strong><small>Mailbox order records</small></article>
        <article className={health.data.mappingExceptions ? "attention" : ""}><span>Mapping exceptions</span><strong>{health.data.mappingExceptions}</strong><small>Need customer/site mapping</small></article>
        <article><span>Waiting</span><strong>{health.data.pendingReview}</strong><small>Still in Load Review</small></article>
        <article><span>Promoted</span><strong>{health.data.promoted}</strong><small>Approved into operations</small></article>
        <article className={health.data.failed ? "attention" : ""}><span>Failed</span><strong>{health.data.failed}</strong><small>Require investigation</small></article>
      </div>
      <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
        <small>Last retained email: <b>{time(health.data.lastEmailReceivedUtc)}</b> · Last staged order: <b>{time(health.data.lastOrderStagedUtc)}</b> · Last promoted: <b>{time(health.data.lastPromotedUtc)}</b></small>
        <small>Known sender fast-path orders: <b>{health.data.fastPathOrders}</b></small>
      </div>
      {health.data.warnings.length > 0 && <div className="warning-list" style={{ marginTop: 12 }}>{health.data.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
    </>}
  </section>;
}
