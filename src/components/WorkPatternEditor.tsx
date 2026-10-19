import { useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { todayIsoDate } from "../lib/dateUtils";

export type WorkPattern = { driverId: string; name: string; blocks: string; cycleStart: string; source: string; updatedBy?: string; updatedAtUtc: string; description: string; working?: boolean; day?: number; blockLength?: number };
export type PatternLibraryItem = { name: string; blocks: string; cycleStart: string; drivers: number };
export type PatternData = { patterns: WorkPattern[]; library: PatternLibraryItem[] };

/** Sage HR work pattern for one driver ("5-2,6-1" from a start date, or fixed weekdays). */
export function WorkPatternEditor({ driverId, current, library, onDone }: { driverId: string; current?: WorkPattern; library: PatternLibraryItem[]; onDone: (saved: boolean) => void }) {
  const token = useAccessToken();
  const [name, setName] = useState(current?.name || "");
  const [blocks, setBlocks] = useState(current?.blocks || "5-2,6-1");
  const [cycleStart, setCycleStart] = useState(current?.cycleStart || todayIsoDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const weekdays = /[a-z]/i.test(blocks);
  async function save(clear = false) {
    setBusy(true); setError(undefined);
    try {
      await request(`/api/v1/driver-work-patterns/${driverId}`, await token(), { method: "PUT", body: JSON.stringify(clear ? { blocks: "" } : { name: name || null, blocks, cycleStart }) });
      onDone(true);
    } catch (exception) { setError(exception instanceof Error ? exception.message : "Could not save."); }
    finally { setBusy(false); }
  }
  return <div className="work-pattern-editor">
    {library.length > 0 && <label>Same as<select value="" onChange={event => { const item = library[Number(event.target.value)]; if (item) { setName(item.name); setBlocks(item.blocks); setCycleStart(item.cycleStart); } }}>
      <option value="">Pick a pattern already used…</option>
      {library.map((item, index) => <option key={`${item.name}-${item.blocks}-${item.cycleStart}`} value={index}>{item.name} (from {item.cycleStart}, {item.drivers} driver{item.drivers === 1 ? "" : "s"})</option>)}
    </select></label>}
    <label>Name in Sage HR<input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. 5 on 2 off / 6 on 1 off" /></label>
    <label>Pattern<input value={blocks} onChange={event => setBlocks(event.target.value)} placeholder="5-2,6-1 or Mon,Tue,Wed,Thu,Fri" /></label>
    {!weekdays && <label>First day of the first block<input type="date" value={cycleStart} onChange={event => setCycleStart(event.target.value)} /></label>}
    <small className="hint">Days on-off in order, e.g. 5-2,6-1 is 5 on, 2 off, then 6 on, 1 off. Or list fixed days: Mon,Tue,Wed,Thu,Fri.</small>
    {error && <p className="ui-error">{error}</p>}
    <div className="ui-page-actions">
      <button type="button" className="primary" disabled={busy || !blocks.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
      {current && <button type="button" disabled={busy} onClick={() => void save(true)}>Remove</button>}
      <button type="button" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
    </div>
  </div>;
}
