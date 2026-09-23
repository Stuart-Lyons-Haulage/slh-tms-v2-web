import { useCallback, useMemo, useState } from "react";
import { request, type Load, type LoadStop } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { displayRunReference } from "../lib/runDisplay";
import { listRuns, updateRunStops } from '../api/runs';

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function runNumber(reference?: string) {
  const value = String(reference || "");
  for (const pattern of [/^PLAN-\d{8}-(\d+)$/i, /^RUN-\d{8}-(\d+)$/i, /^L0*(\d+)$/i, /(?:^|[-_\s])0*(\d+)$/]) {
    const match = value.match(pattern);
    if (match) return Number(match[1]);
  }
  return Number.MAX_SAFE_INTEGER;
}

function plannerPeriod(notes?: string) {
  const match = String(notes || "").match(/(?:^|·)\s*Planner period:\s*(AM|PM)\b/i);
  return match?.[1]?.toUpperCase() as "AM" | "PM" | undefined;
}

function withPlannerPeriod(notes: string | undefined, period: "AM" | "PM") {
  const parts = String(notes || "").split("·").map((part) => part.trim()).filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith("planner period:"));
  return [`Planner period: ${period}`, ...parts].join(" · ");
}

function toLocalInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toUtc(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stopDraft(stop: LoadStop) {
  return {
    orderId: stop.orderId,
    name: stop.name,
    address: stop.address,
    latitude: stop.latitude,
    longitude: stop.longitude,
    plannedArrivalUtc: stop.plannedArrivalUtc,
    plannerNote: stop.plannerNote,
  };
}

type ImportedJobLine = {
  key: string;
  collection: string;
  delivery: string;
  pallets: string;
  reference: string;
};

function importedJobLines(load: Load): ImportedJobLine[] {
  const result: ImportedJobLine[] = [];
  for (const [index, stop] of (load.stops || []).entries()) {
    if (!/^collect\s*·/i.test(stop.name || "")) continue;
    const collectionFromName = String(stop.name || "").replace(/^collect\s*·\s*/i, "").trim();
    const note = String(stop.plannerNote || "");
    const sourceMatch = note.match(/(?:Source\s+(?:row|sequence)\s+[^·]+·\s*)?([\d.]+)\s+pallets\s*·\s*(.*?)\s*→\s*(.*?)(?:\s*·\s*Ref\s+(.+))?$/i);
    const addressMatch = String(stop.address || "").match(/^([\d.]+)\s+pallets(?:\s*·\s*for\s+(.*?))?(?:\s*·\s*Ref\s+(.*?))?(?:\s*·\s*collect\s+.*)?$/i);
    result.push({
      key: `${load.id}-${index}`,
      collection: sourceMatch?.[2]?.trim() || collectionFromName,
      delivery: sourceMatch?.[3]?.trim() || addressMatch?.[2]?.trim() || "",
      pallets: sourceMatch?.[1]?.trim() || addressMatch?.[1]?.trim() || "",
      reference: sourceMatch?.[4]?.trim() || addressMatch?.[3]?.trim() || "",
    });
  }
  return result;
}

export function ImportedPlanRuns() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const [expanded, setExpanded] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, ReturnType<typeof stopDraft>[]>>({});
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const loadsApi = useApi(useCallback(async () => listRuns(date, await token()), [date, token]));

  const loads = useMemo(() => [...(loadsApi.data || [])].sort((left, right) => {
    const numeric = runNumber(left.reference) - runNumber(right.reference);
    return numeric || String(left.reference).localeCompare(String(right.reference), undefined, { numeric: true, sensitivity: "base" });
  }), [loadsApi.data]);

  async function setPeriod(load: Load, period: "AM" | "PM") {
    setBusy(load.id); setMessage(undefined);
    try {
      await request(`/api/v1/loads/${load.id}/utilisation`, await token(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          palletSpacesUsed: load.palletSpacesUsed ?? 0,
          totalPalletSpaces: load.totalPalletSpaces ?? 26,
          capacityType: load.capacityType ?? "Standard pallets",
          depotSplits: load.depotSplits,
          temperatureC: load.temperatureC,
          plannerNotes: withPlannerPeriod(load.plannerNotes, period),
        }),
      });
      setMessage(`${displayRunReference(load.reference, load.plannerNotes, load.stops?.[0]?.plannedArrivalUtc)} set to ${period}.`);
      await loadsApi.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Run period could not be saved."); }
    finally { setBusy(undefined); }
  }

  function openEditor(load: Load) {
    setExpanded((current) => current === load.id ? undefined : load.id);
    setDrafts((current) => ({ ...current, [load.id]: (load.stops || []).map(stopDraft) }));
  }

  async function saveStops(load: Load) {
    const draft = drafts[load.id];
    if (!draft?.length) return;
    setBusy(load.id); setMessage(undefined);
    try {
      await updateRunStops(load.id, draft, await token());
      setMessage(`${displayRunReference(load.reference, load.plannerNotes, load.stops?.[0]?.plannedArrivalUtc)} route updated.`);
      await loadsApi.refresh();
      setExpanded(undefined);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Run stops could not be saved."); }
    finally { setBusy(undefined); }
  }

  return <section className="panel" style={{ marginBottom: 14 }}>
    <div className="title-row">
      <div>
        <p className="eyebrow">Imported plan</p>
        <h2>Imported jobs by run</h2>
        <p className="hint">Every imported source job is shown under the run it belongs to. Collection-to-delivery pallet provenance is retained even when the source line has not matched an existing TMS order.</p>
      </div>
      <label>Plan date <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setExpanded(undefined); }} /></label>
    </div>
    {message && <p className="notice inline-notice">{message}</p>}
    {loadsApi.error && <p className="notice inline-notice">{loadsApi.error}</p>}
    <div style={{ display: "grid", gap: 10 }}>
      {loads.map((load) => {
        const firstTime = load.stops?.[0]?.plannedArrivalUtc;
        const label = displayRunReference(load.reference, load.plannerNotes, firstTime);
        const period = plannerPeriod(load.plannerNotes);
        const draft = drafts[load.id] || [];
        const jobs = importedJobLines(load);
        const totalPallets = jobs.reduce((sum, line) => sum + (Number(line.pallets) || 0), 0);
        return <article key={load.id} className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <strong>{label}</strong>
              <div className="hint">{jobs.length ? `${jobs.length} job line${jobs.length === 1 ? "" : "s"} · ${totalPallets} pallets` : (load.stops || []).map((stop) => stop.name).join(" → ") || "No stops"}</div>
            </div>
            <div className="actions">
              <button type="button" className={period === "AM" ? "primary" : ""} disabled={busy === load.id} onClick={() => void setPeriod(load, "AM")}>AM</button>
              <button type="button" className={period === "PM" ? "primary" : ""} disabled={busy === load.id} onClick={() => void setPeriod(load, "PM")}>PM</button>
              <button type="button" disabled={busy === load.id} onClick={() => openEditor(load)}>{expanded === load.id ? "Close amendments" : "Amend run"}</button>
            </div>
          </div>

          {jobs.length > 0 && <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,1fr) 90px minmax(160px,1fr) minmax(120px,.7fr)", gap: 8, fontWeight: 700 }}>
              <span>Collection</span><span>Pallets</span><span>Delivery</span><span>Reference</span>
            </div>
            {jobs.map((job) => <div key={job.key} style={{ display: "grid", gridTemplateColumns: "minmax(160px,1fr) 90px minmax(160px,1fr) minmax(120px,.7fr)", gap: 8, alignItems: "center" }}>
              <span>{job.collection}</span><strong>{job.pallets || "—"}</strong><span>{job.delivery || "—"}</span><span>{job.reference || "—"}</span>
            </div>)}
          </div>}

          {expanded === load.id && <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <p className="hint" style={{ margin: 0 }}>Amend individual collection/delivery stops and timings here. Saving updates this live run; it does not create a duplicate.</p>
            {draft.map((stop, index) => <div key={`${load.id}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(190px, .5fr)", gap: 8 }}>
              <input value={stop.name} onChange={(event) => setDrafts((current) => ({ ...current, [load.id]: current[load.id].map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} />
              <input type="datetime-local" value={toLocalInput(stop.plannedArrivalUtc)} onChange={(event) => setDrafts((current) => ({ ...current, [load.id]: current[load.id].map((item, itemIndex) => itemIndex === index ? { ...item, plannedArrivalUtc: toUtc(event.target.value) } : item) }))} />
            </div>)}
            <div className="actions"><button className="primary" type="button" disabled={busy === load.id} onClick={() => void saveStops(load)}>{busy === load.id ? "Saving…" : "Save run amendments"}</button></div>
          </div>}
        </article>;
      })}
      {!loadsApi.loading && !loads.length && <p className="hint">No imported/live runs found for this date.</p>}
    </div>
  </section>;
}
