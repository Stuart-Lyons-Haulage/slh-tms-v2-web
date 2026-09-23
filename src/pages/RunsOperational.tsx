import { useCallback, useEffect, useState } from "react";
import { intelligenceApi } from "../lib/intelligenceApi";
import { useAccessToken } from "../lib/auth";
import { formatDate, formatDateTime, todayIsoDate } from "../lib/dateUtils";
import { useApi } from "../lib/useApi";
import { RunsCapacityAllocation } from "./RunsCapacityAllocation";

function ukLocalDateTimeFromUtcFields(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(`${value}:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function RunsOperational() {
  const token = useAccessToken();
  const [lockDate, setLockDate] = useState(todayIsoDate());
  const [locking, setLocking] = useState(false);
  const [lockMessage, setLockMessage] = useState<string>();
  const readiness = useApi(useCallback(async () => intelligenceApi.readiness(lockDate, await token()), [lockDate, token]));

  useEffect(() => {
    const correctInputs = () => {
      document.querySelectorAll<HTMLInputElement>('.runs-operational-page input[type="datetime-local"]').forEach(input => {
        if (document.activeElement === input || !input.value) return;
        if (input.dataset.slhCorrectedDisplay === input.value) return;
        const corrected = ukLocalDateTimeFromUtcFields(input.value);
        if (corrected !== input.value) {
          input.dataset.slhCorrectedDisplay = corrected;
          input.value = corrected;
        }
      });
    };
    correctInputs();
    const timer = window.setInterval(correctInputs, 400);
    return () => window.clearInterval(timer);
  }, []);

  async function lockPlan() {
    if (locking || readiness.data?.planLock) return;
    if (!window.confirm(`Lock the operational run baseline for ${formatDate(lockDate)}?\n\nChanges can still be made afterwards, but they will be recorded against the locked plan.`)) return;
    setLocking(true); setLockMessage(undefined);
    try {
      const result = await intelligenceApi.lockPlan(lockDate, await token());
      setLockMessage(`Plan locked with ${result.baselineRuns} baseline run${result.baselineRuns === 1 ? "" : "s"}.`);
      await readiness.refresh();
    } catch (error) {
      setLockMessage(error instanceof Error ? error.message : "The plan could not be locked.");
    } finally { setLocking(false); }
  }

  return (
    <div className="runs-operational-page">
      <section className="panel run-workflow-panel">
        <div className="title-row"><div><p className="eyebrow">Run control</p><h1>Planned runs & dispatch</h1></div></div>
        <p className="intro">This is the handover point between planning and live operations. Allocate the driver, vehicle and trailer, check the run, then preview and send the driver text before dispatch.</p>
        <div className="metrics run-workflow-steps">
          <article className="metric"><span>1</span><strong>Run built</strong><small>Accepted orders grouped into the run</small></article>
          <article className="metric"><span>2</span><strong>Allocate</strong><small>Driver · vehicle · trailer · start time</small></article>
          <article className="metric"><span>3</span><strong>Driver text</strong><small>Copy the driver brief or send SMS from the run card</small></article>
          <article className="metric"><span>4</span><strong>Dispatch</strong><small>Copy/send after checking the run, then move into live operations</small></article>
        </div>
        <p className="hint">Run times are shown in UK local time (Europe/London), including BST/GMT automatically. Location and ETA calculations use the UK postcode in the stop address first.</p>
      </section>

      <section className="panel run-lock-control">
        <div className="title-row"><div><p className="eyebrow">Operational baseline</p><h2>Lock plan</h2><p className="hint">Lock the run plan here once allocations and routes are ready. Later changes remain possible and are audited in Plan Stability.</p></div><label>Planning date <input type="date" value={lockDate} onChange={(event) => { setLockDate(event.target.value); setLockMessage(undefined); }} disabled={locking} /></label></div>
        {readiness.error && <p className="notice inline-notice">Plan status could not refresh: {readiness.error}</p>}
        {readiness.data && <div className="run-lock-status"><div><strong>{readiness.data.planLock ? "✓ PLAN LOCKED" : "PLAN OPEN"}</strong><span>{readiness.data.runs} runs · {readiness.data.missingAllocations} missing allocation{readiness.data.missingAllocations === 1 ? "" : "s"}</span>{readiness.data.planLock && <small>Locked {formatDateTime(readiness.data.planLock.lockedAtUtc)} · {readiness.data.planLock.baselineRuns} baseline runs</small>}</div>{!readiness.data.planLock && <button className="primary" type="button" onClick={() => void lockPlan()} disabled={locking || readiness.loading || readiness.data.runs === 0}>{locking ? "Locking…" : "Lock plan"}</button>}</div>}
        {lockMessage && <p className="notice inline-notice">{lockMessage}</p>}
      </section>

      <RunsCapacityAllocation />
    </div>
  );
}
