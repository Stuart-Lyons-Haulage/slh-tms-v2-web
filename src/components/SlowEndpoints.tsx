import { useCallback } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";

type Row = { endpoint: string; count: number; avgMs: number; p95Ms: number; maxMs: number };
type SlowCall = { atUtc: string; method: string; route: string; ms: number; statusCode: number };
type Summary = { generatedAtUtc: string; windowMinutes: number; endpoints: Row[]; recentSlow: SlowCall[] };

const ms = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
const tone = (value: number) => value >= 3000 ? "amber" : value >= 1500 ? "" : "green";

/** Where the API's time went recently, so "it's slow" can be pinned to specific endpoints. */
export function SlowEndpoints() {
  const token = useAccessToken();
  const perf = useApi(useCallback(async () => request<Summary>("/api/v1/diagnostics/slow-endpoints", await token()), [token]));
  const data = perf.data && Array.isArray(perf.data.endpoints) ? perf.data : undefined;

  return <details className="ui-card" style={{ marginTop: 16 }}>
    <summary><strong>What's slow (API response times)</strong>{data ? ` · last ${data.windowMinutes} min` : ""}</summary>
    <p className="hint">Server response time per screen/endpoint over the last {data?.windowMinutes ?? 15} minutes. High numbers here mean the server or database is the bottleneck; if these are low but a screen still feels slow, it's the browser or the network. Use the TMS normally for a few minutes, then press Refresh.</p>
    <div className="ui-page-actions"><button type="button" disabled={perf.loading} onClick={() => void perf.refresh()}>Refresh</button></div>
    {!data ? <p className="hint">{perf.loading ? "Loading…" : "No timing yet — use the TMS for a few minutes and refresh."}</p>
      : data.endpoints.length === 0 ? <p className="hint">No traffic recorded yet in this window.</p>
      : <div className="ui-table-wrap"><table className="ui-table">
          <thead><tr><th>Endpoint</th><th>Calls</th><th>Average</th><th>95th percentile</th><th>Slowest</th></tr></thead>
          <tbody>{data.endpoints.map((row, index) => <tr key={index}>
            <td><small>{row.endpoint}</small></td>
            <td>{row.count}</td>
            <td>{ms(row.avgMs)}</td>
            <td><span className={`ui-chip ${tone(row.p95Ms)}`}>{ms(row.p95Ms)}</span></td>
            <td>{ms(row.maxMs)}</td>
          </tr>)}</tbody>
        </table></div>}
    {data && data.recentSlow.length > 0 && <p className="hint" style={{ marginTop: 8 }}><strong>Slowest individual calls:</strong> {data.recentSlow.slice(0, 8).map((call, index) => <span key={index}>{index > 0 ? " · " : ""}{call.route} {ms(call.ms)}</span>)}</p>}
  </details>;
}
