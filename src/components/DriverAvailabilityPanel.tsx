import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccessToken } from "../lib/auth";
import { request } from "../lib/api";
import type { DriverAvailabilityItem, DriverAvailabilitySnapshot } from "./dispatch/types";

const groups = ["Employed available", "Agency confirmed", "Agency unconfirmed", "Casual confirmed", "Casual unconfirmed", "Unavailable/blocked"] as const;

function localInput(value?: string, fallback = "") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function displayWindow(driver: DriverAvailabilityItem) {
  if (!driver.availableFromUtc || !driver.availableUntilUtc) return "No confirmed window";
  const format = (value: string) => new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${format(driver.availableFromUtc)} → ${format(driver.availableUntilUtc)}`;
}

export function DriverAvailabilityPanel({ planningDate, compact = false, onChanged }: { planningDate: string; compact?: boolean; onChanged?: () => void }) {
  const token = useAccessToken();
  const [snapshot, setSnapshot] = useState<DriverAvailabilitySnapshot>();
  const [editing, setEditing] = useState<DriverAvailabilityItem>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dayStart = `${planningDate}T00:00`;
  const dayEnd = `${planningDate}T23:59`;
  const [form, setForm] = useState({ from: dayStart, until: dayEnd, confirmed: true, longTerm: false, placementEnd: "", usualDays: "", notes: "", bookingReference: "" });

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await request<DriverAvailabilitySnapshot>(`/api/v1/driver-availability?date=${encodeURIComponent(planningDate)}`, await token()));
      setError(undefined);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Driver availability could not be loaded.");
    }
  }, [planningDate, token]);

  useEffect(() => { void refresh(); }, [refresh]);
  const byGroup = useMemo(() => new Map(groups.map(group => [group, snapshot?.drivers.filter(driver => driver.group === group) || []])), [snapshot]);

  function edit(driver: DriverAvailabilityItem) {
    setEditing(driver);
    setForm({
      from: localInput(driver.availableFromUtc, dayStart),
      until: localInput(driver.availableUntilUtc, dayEnd),
      confirmed: driver.availabilityConfirmed,
      longTerm: driver.longTermPlacement,
      placementEnd: driver.placementEndDate || "",
      usualDays: driver.usualDays || "",
      notes: driver.notes || "",
      bookingReference: driver.bookingReference || ""
    });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await request(editing.availabilityWindowId ? `/api/v1/driver-availability/${editing.availabilityWindowId}` : "/api/v1/driver-availability", await token(), {
        method: editing.availabilityWindowId ? "PUT" : "POST",
        body: JSON.stringify({
          driverId: editing.driverId,
          availableFromUtc: new Date(form.from).toISOString(),
          availableUntilUtc: new Date(form.until).toISOString(),
          confirmed: form.confirmed,
          longTermPlacement: form.longTerm,
          placementEndDate: form.longTerm ? form.placementEnd || null : null,
          usualDays: form.longTerm ? form.usualDays : null,
          notes: form.notes || null,
          bookingReference: form.bookingReference || null
        })
      });
      setEditing(undefined);
      await refresh();
      onChanged?.();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Availability could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) return <section className="driver-availability-panel"><strong>Driver availability</strong><p>{error || "Loading workforce forecast…"}</p></section>;
  const balance = snapshot.summary.surplusShortfall;
  return <section className={`driver-availability-panel${compact ? " compact" : ""}`} aria-label="Driver availability">
    <header>
      <div><span className="smart-eyebrow">Shared Planner &amp; Dispatch decision</span><h3>Driver availability · {new Date(`${planningDate}T12:00:00`).toLocaleDateString("en-GB")}</h3></div>
      <button type="button" onClick={() => void refresh()}>Refresh availability</button>
    </header>
    <div className="driver-availability-summary">
      <span><strong>{snapshot.summary.employedAvailable}</strong> employed</span>
      <span><strong>{snapshot.summary.agencyConfirmed}</strong> agency confirmed</span>
      <span><strong>{snapshot.summary.casualConfirmed}</strong> casual confirmed</span>
      <span><strong>{snapshot.summary.driversRequired}</strong> runs require drivers</span>
      <span className={balance < 0 ? "shortfall" : "surplus"}><strong>{Math.abs(balance)}</strong> {balance < 0 ? "shortfall" : "surplus"}</span>
      {snapshot.classificationMismatchCount > 0 && <span className="review"><strong>{snapshot.classificationMismatchCount}</strong> Master Data review</span>}
    </div>
    {error && <p className="smart-inline-error">{error}</p>}
    <div className="driver-availability-groups">
      {groups.map(group => <details key={group} open={!compact && (group === "Agency unconfirmed" || group === "Casual unconfirmed" || group === "Unavailable/blocked")}>
        <summary>{group}<b>{byGroup.get(group)?.length || 0}</b></summary>
        <div className="driver-availability-list">{byGroup.get(group)?.map(driver => <article key={driver.driverId}>
          <div><strong>{driver.displayName}</strong><small>{driver.employeeNumber} · {driver.employmentType}{driver.agencyName ? ` · ${driver.agencyName}` : ""}</small></div>
          <div><span>{displayWindow(driver)}</span><small>{driver.skills || "Skills not recorded"}{driver.placementEndDate ? ` · placement ends ${driver.placementEndDate}` : ""}</small></div>
          <div><span>{driver.blockReasons.join(" · ") || (driver.currentAllocationReference ? `Allocated · ${driver.currentAllocationReference}` : "Available")}</span><small>{driver.driveAvailableTodayMinutes != null ? `${Math.floor(driver.driveAvailableTodayMinutes / 60)}h ${driver.driveAvailableTodayMinutes % 60}m drive remaining` : "Legal hours shown after Tacho refresh"}</small></div>
          {driver.classificationMismatch && <small className="smart-inline-warning">Master Data review · {driver.classificationReviewReason}</small>}
          {(driver.employmentType === "Agency" || driver.employmentType === "Casual") && <button type="button" onClick={() => edit(driver)}>Add / edit availability</button>}
        </article>)}</div>
      </details>)}
    </div>
    {editing && <div className="driver-availability-editor" role="dialog" aria-label={`Availability for ${editing.displayName}`}>
      <header><strong>{editing.displayName} · {editing.employmentType}</strong><button type="button" onClick={() => setEditing(undefined)}>Close</button></header>
      <label>Available from<input type="datetime-local" value={form.from} onChange={event => setForm(current => ({ ...current, from: event.target.value }))} /></label>
      <label>Available until<input type="datetime-local" value={form.until} onChange={event => setForm(current => ({ ...current, until: event.target.value }))} /></label>
      <label><input type="checkbox" checked={form.confirmed} onChange={event => setForm(current => ({ ...current, confirmed: event.target.checked }))} /> Booking confirmed</label>
      {editing.employmentType === "Agency" && <label><input type="checkbox" checked={form.longTerm} onChange={event => setForm(current => ({ ...current, longTerm: event.target.checked }))} /> Long-term placement</label>}
      {form.longTerm && <><label>Placement end<input type="date" value={form.placementEnd} onChange={event => setForm(current => ({ ...current, placementEnd: event.target.value }))} /></label><label>Usual days / pattern<input value={form.usualDays} placeholder="Mon,Tue,Wed,Thu,Fri" onChange={event => setForm(current => ({ ...current, usualDays: event.target.value }))} /></label></>}
      <label>Booking reference<input value={form.bookingReference} onChange={event => setForm(current => ({ ...current, bookingReference: event.target.value }))} /></label>
      <label>Notes<textarea value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} /></label>
      <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save availability"}</button>
      <small>Employment type is read-only here and remains controlled by Master Data.</small>
    </div>}
  </section>;
}
