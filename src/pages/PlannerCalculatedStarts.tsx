import { useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange } from "../lib/planningEvents";

type StartSuggestion = {
  loadId: string;
  runReference: string;
  suggestedStartUtc?: string;
};
type Response = { planningDate: string; rows: StartSuggestion[] };

function normaliseResponse(value: unknown, planningDate: string): Response {
  if (!value || typeof value !== "object") return { planningDate, rows: [] };
  const record = value as Partial<Response>;
  return {
    planningDate: typeof record.planningDate === "string" ? record.planningDate : planningDate,
    rows: Array.isArray(record.rows) ? record.rows : [],
  };
}

export function PlannerCalculatedStarts({ planningDate }: { planningDate: string }) {
  const token = useAccessToken();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function calculate() {
    setBusy(true);
    setMessage(undefined);
    try {
      const access = await token();
      const payload = await request<unknown>(`/api/v1/planner-starts?date=${encodeURIComponent(planningDate)}`, access);
      const data = normaliseResponse(payload, planningDate);
      const applicable = data.rows.filter((row) => Boolean(row.suggestedStartUtc));
      if (!applicable.length) {
        setMessage("No calculated starts available yet.");
        return;
      }
      await Promise.all(applicable.map((row) => request(`/api/v1/planner-starts/${row.loadId}/apply`, access, { method: "PUT" })));
      signalPlanningChange();
      setMessage(`${applicable.length} start time${applicable.length === 1 ? "" : "s"} populated for Dispatch.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Start times could not be calculated.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="planner-calculated-starts-compact">
    <button type="button" onClick={() => void calculate()} disabled={busy} title="Calculate legal start times from Tacho rest, walkaround allowance and route time to the first collection.">
      {busy ? "Calculating…" : "Calculate Starts"}
    </button>
    {message && <span className="hint" title={message}>{message}</span>}
  </div>;
}
