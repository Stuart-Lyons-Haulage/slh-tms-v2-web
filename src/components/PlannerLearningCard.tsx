import { useCallback } from "react";
import { request } from "../lib/api";
import { useTmsQuery } from "../lib/useTmsQuery";

type Preference = { customer: string; destination: string; preferredRun: string; pattern: string; confidence: number; samples: number; typicalPallets: number; weekdays: string[] };
type Insights = { generatedAtUtc: string; days: number; decisions: number; customers: number; consistency: number; preferences: Preference[] };

/**
 * What the TMS has learned from how runs are actually built: each customer/destination's
 * usual run and typical size, and how consistently the pattern is followed. Advisory — these
 * are shown as hints in Pallet Order, nothing is applied automatically.
 */
export function PlannerLearningCard() {
  const insights = useTmsQuery<Insights>(['planner', 'learning'] as const, useCallback((t: string) => request<Insights>("/api/v1/planner/learning?days=90", t), []));
  const data = insights.data && Array.isArray(insights.data.preferences) ? insights.data : undefined;

  return <details className="panel pallet-control-learning" style={{ marginTop: 16 }}>
    <summary><strong>What the planner has learned</strong>{data ? ` · ${data.preferences.length} usual patterns from ${data.decisions} decisions · ${data.consistency}% consistent` : ""}</summary>
    {insights.isLoading && !data ? <p className="hint">Loading…</p>
      : !data || data.decisions === 0 ? <p className="hint">Nothing learned yet. As you put orders on runs, the TMS learns each customer's usual run and typical size, then shows it as a hint when the same work comes round. Give it a few days of planning.</p>
      : <>
        <p className="hint">From the last {data.days} days: {data.decisions} run placements across {data.customers} customer/destination combinations. The pattern is followed {data.consistency}% of the time. These show as 💡 hints when you plan.</p>
        {data.preferences.length === 0 ? <p className="hint">No strong pattern yet — it needs a customer/destination seen at least 3 times going mostly to the same run.</p>
          : <div className="ui-table-wrap"><table className="ui-table">
            <thead><tr><th>Customer</th><th>Delivery</th><th>Usual run</th><th>How often</th><th>Typical size</th><th>Days</th></tr></thead>
            <tbody>{data.preferences.slice(0, 40).map((preference, index) => <tr key={index}>
              <td><strong>{preference.customer}</strong></td>
              <td>{preference.destination}</td>
              <td>{preference.preferredRun}</td>
              <td><span className={`ui-chip ${preference.confidence >= 80 ? "green" : "amber"}`}>{preference.confidence}%</span><small> of {preference.samples}</small></td>
              <td>{preference.typicalPallets > 0 ? `${preference.typicalPallets} plt` : "—"}</td>
              <td><small>{preference.weekdays.join(", ")}</small></td>
            </tr>)}</tbody>
          </table></div>}
      </>}
  </details>;
}
