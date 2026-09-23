import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Driver,
  type Load,
  type LoadDispatch,
  type Site,
  type Trailer,
  type Vehicle,
} from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { signalPlanningChange, subscribePlanningChanges } from "../lib/planningEvents";
import { displayRunReference } from "../lib/runDisplay";
import { useApi } from "../lib/useApi";
import "../runs-capacity-allocation.css";
import { allocateRun, getRunDispatch, getRunRoute, listRuns, updateRunOperational, updateRunStops } from '../api/runs';

const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

type CapacityType = "Standard pallets" | "Euro pallets" | "Trays" | "Trolleys" | "Mixed load";
type EditableStop = Omit<Load["stops"][number], "latitude" | "longitude"> & { latitude: string; longitude: string; postcode: string };
type StructuralDispatchReadiness = {
  classification: "Recommended" | "Unverified" | "Blocked";
  requiresAcknowledgement: boolean;
  checks: Array<{ code: string; passed: boolean; severity: string; message: string }>;
};
type DispatchReadiness = {
  canDispatch: boolean;
  status: string;
  explanation: string;
  routeDrivingMinutes: number;
  breakMinutesIncluded: number;
  tachoDriverName?: string;
  driveAvailableTodayMinutes?: number;
  structuralReadiness?: StructuralDispatchReadiness;
  acknowledgedUnverified?: boolean;
};

const normalise = (value?: string) => (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const spaceLabel = (type?: string) => (type || "").toLowerCase() === "euro pallets" ? "Euro spaces" : "floor spaces";
const postcodePattern = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

function loadTypeLabel(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "euro pallets": return "Euro pallet load";
    case "trays": return "Tray load";
    case "trolleys": return "Trolley load";
    case "mixed load": return "Mixed-unit load";
    default: return "Standard pallet load";
  }
}

function capacityTypeFromLoad(value?: string): CapacityType {
  const allowed: CapacityType[] = ["Standard pallets", "Euro pallets", "Trays", "Trolleys", "Mixed load"];
  return allowed.includes(value as CapacityType) ? value as CapacityType : "Mixed load";
}

function trailerCapacity(trailer: Trailer | undefined, type: string) {
  if (!trailer) return undefined;
  return type.toLowerCase() === "euro pallets"
    ? trailer.euroCapacity ?? trailer.standardCapacity
    : trailer.standardCapacity ?? trailer.euroCapacity;
}

function stopSiteName(value: string) {
  return value.replace(/^\s*(collect|deliver)\s*[·:\-]\s*/i, "").replace(/\s*→.*$/, "").trim();
}

function siteAliases(site: Site) {
  return [site.name, site.driverTextName, ...(site.aliases || "").split(/[,;|]/)]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function matchSite(sites: Site[], stopName: string) {
  const target = normalise(stopSiteName(stopName));
  if (!target) return undefined;
  return sites.find(site => siteAliases(site).some(alias => normalise(alias) === target)) ||
    sites.find(site => siteAliases(site).some(alias => {
      const candidate = normalise(alias);
      return candidate.length > 4 && (target.includes(candidate) || candidate.includes(target));
    }));
}

function usefulAddress(value?: string) {
  return Boolean(value && (postcodePattern.test(value) || /\d+\s+[A-Za-z]/.test(value)));
}

function postcodeFrom(value?: string) {
  const match = value?.match(postcodePattern);
  return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : "";
}

function formatPostcode(value?: string) {
  if (!value) return "";
  const compact = value.toUpperCase().replace(/\s+/g, "").trim();
  const match = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return match ? `${match[1]} ${match[2]}` : value.toUpperCase().trim();
}

async function checkDispatchReadiness(loadId: string, routeDrivingMinutes: number, access?: string, acknowledgeUnverified = false): Promise<DispatchReadiness> {
  const response = await fetch(`/tms-api/api/v1/loads/${encodeURIComponent(loadId)}/dispatch-readiness`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    body: JSON.stringify({ routeDrivingMinutes, acknowledgeUnverified }),
  });
  const body = await response.text();
  let parsed: Partial<DispatchReadiness> & { message?: string } = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { message: body }; }
  if (!response.ok) throw new Error(parsed.message || parsed.explanation || `TachoMaster dispatch check failed (${response.status}).`);
  if (parsed.canDispatch) return { ...(parsed as DispatchReadiness), acknowledgedUnverified: acknowledgeUnverified };

  const structural = parsed.structuralReadiness;
  if (!acknowledgeUnverified && structural?.classification === "Unverified" && structural.requiresAcknowledgement) {
    const warnings = structural.checks.filter(item => !item.passed).map(item => `• ${item.message}`).join("\n");
    const confirmed = window.confirm(`Pre-dispatch evidence needs planner acknowledgement before live TachoMaster can approve this run.\n\n${warnings}\n\nAcknowledge these warnings and continue to the live TachoMaster check?`);
    if (!confirmed) throw new Error("Dispatch cancelled. The unverified pre-dispatch evidence was not acknowledged.");
    return checkDispatchReadiness(loadId, routeDrivingMinutes, access, true);
  }

  throw new Error(parsed.explanation || "TachoMaster has not confirmed this run is achievable.");
}

function addressWithPostcode(address: string | undefined, postcode: string) {
  const current = (address || "").trim();
  const formatted = formatPostcode(postcode);
  if (!formatted) return current;
  return postcodePattern.test(current)
    ? current.replace(postcodePattern, formatted)
    : [current, formatted].filter(Boolean).join(", ");
}

function filteredPlannerNotes(value?: string) {
  if (!value) return "";
  const exclude = /^(run type|planner run|reconciliation|source|capacity)\s*:/i;
  return value.split("|").map(part => part.trim()).filter(part => part && !exclude.test(part)).join(" | ");
}

function firstPlannedTime(load: Load) {
  return [...(load.stops || [])].sort((left, right) => left.sequence - right.sequence).find(stop => stop.plannedArrivalUtc)?.plannedArrivalUtc;
}

function buildDriverText(load: Load, dispatch: LoadDispatch) {
  const plannerNotes = filteredPlannerNotes(load.plannerNotes);
  const runLabel = displayRunReference(load.reference, load.plannerNotes, firstPlannedTime(load));
  const loadLine = load.palletSpacesUsed != null
    ? `Load: ${load.palletSpacesUsed}${load.totalPalletSpaces ? ` / ${load.totalPalletSpaces}` : ""} ${load.capacityType || "pallet spaces"}`
    : "";
  const header = [
    `SLH ${runLabel}`,
    dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "Driver: Unallocated",
    dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : "Vehicle: Unallocated",
    dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : "",
    loadLine,
    load.temperatureC != null ? `Temperature: ${load.temperatureC > 0 ? "+" : ""}${load.temperatureC}°C` : "",
    plannerNotes ? `Planner notes: ${plannerNotes}` : "",
  ].filter(Boolean).join("\n");

  const stops = dispatch.stops.map(stop => {
    const order = stop.order;
    return [
      `${stop.sequence}. ${stop.name}`,
      order?.marketName ? `Market: ${order.marketName}${order.stallNumber ? ` · Stall ${order.stallNumber}` : ""}` : "",
      order?.sellerName ? `Seller: ${order.sellerName}` : "",
      stop.address ? `Address: ${stop.address}` : "",
      order?.driverInstructions ? `Notes: ${order.driverInstructions}` : "",
      order?.mapLink ? `Map: ${order.mapLink}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return [header, stops, "Please reply to this message to confirm acceptance"].filter(Boolean).join("\n\n");
}

function editableStops(load: Load, sites: Site[]): EditableStop[] {
  return load.stops.map(stop => {
    const site = matchSite(sites, stop.name);
    return {
      ...stop,
      address: usefulAddress(stop.address) ? stop.address : site?.collectionAddress || stop.address,
      latitude: stop.latitude?.toString() || site?.latitude?.toString() || "",
      longitude: stop.longitude?.toString() || site?.longitude?.toString() || "",
      postcode: postcodeFrom(stop.address) || postcodeFrom(site?.collectionAddress),
    };
  });
}

function RunAllocationCard({ load, vehicles, drivers, trailers, sites, onSaved }: {
  load: Load;
  vehicles: Vehicle[];
  drivers: Driver[];
  trailers: Trailer[];
  sites: Site[];
  onSaved: () => Promise<void>;
}) {
  const token = useAccessToken();
  const [vehicleId, setVehicleId] = useState(load.vehicleId || "");
  const [driverId, setDriverId] = useState(load.driverId || "");
  const [trailerId, setTrailerId] = useState(load.trailerId || "");
  const [capacityType, setCapacityType] = useState<CapacityType>(capacityTypeFromLoad(load.capacityType));
  const [used, setUsed] = useState(load.palletSpacesUsed?.toString() || "0");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [routeSummary, setRouteSummary] = useState<string>();
  const [stops, setStops] = useState<EditableStop[]>(() => editableStops(load, sites));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [freeTextOpen, setFreeTextOpen] = useState(false);
  const [freeText, setFreeText] = useState("");

  useEffect(() => {
    setVehicleId(load.vehicleId || "");
    setDriverId(load.driverId || "");
    setTrailerId(load.trailerId || "");
    setCapacityType(capacityTypeFromLoad(load.capacityType));
    setUsed(load.palletSpacesUsed?.toString() || "0");
    setStops(editableStops(load, sites));
  }, [load, sites]);

  const selectedTrailer = trailers.find(item => item.id === trailerId);
  const selectedDriver = drivers.find(item => item.id === driverId);
  const effectiveCapacity = trailerCapacity(selectedTrailer, capacityType) ?? load.totalPalletSpaces;
  const numericUsed = Number(used || 0);
  const utilisation = effectiveCapacity && effectiveCapacity > 0 ? numericUsed / effectiveCapacity * 100 : undefined;
  const runLabel = displayRunReference(load.reference, load.plannerNotes, firstPlannedTime(load));

  const stopPayload = (source: EditableStop[]) => source.map(stop => ({
    orderId: stop.orderId,
    name: stop.name,
    address: addressWithPostcode(stop.address, stop.postcode),
    latitude: stop.latitude.trim() ? Number(stop.latitude) : undefined,
    longitude: stop.longitude.trim() ? Number(stop.longitude) : undefined,
    plannedArrivalUtc: stop.plannedArrivalUtc ? new Date(stop.plannedArrivalUtc).toISOString() : undefined,
  }));

  async function saveAllocation() {
    setSaving(true); setMessage(undefined);
    try {
      const access = await token();
      await allocateRun(load.id, { vehicleId: vehicleId || undefined, driverId: driverId || undefined, trailerId: trailerId || undefined }, access);
      await updateRunOperational(load.id, {
        palletSpacesUsed: Number.isFinite(numericUsed) ? numericUsed : undefined,
        totalPalletSpaces: effectiveCapacity,
        capacityType,
        depotSplits: load.depotSplits,
        temperatureC: load.temperatureC,
        plannerNotes: load.plannerNotes,
      }, access);
      await onSaved();
      signalPlanningChange();
      setMessage(`Allocation saved · ${loadTypeLabel(capacityType)} · ${effectiveCapacity ?? "capacity pending"} ${spaceLabel(capacityType)} from trailer matrix.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Allocation could not be saved.");
    } finally { setSaving(false); }
  }

  async function resolveLocations(access: string, source: EditableStop[] = stops) {
    const next = source.map(stop => ({ ...stop }));
    const failed: string[] = [];
    let resolved = 0;
    for (const stop of next) {
      const site = matchSite(sites, stop.name);
      const masterPostcode = postcodeFrom(site?.collectionAddress);
      const stopPostcode = postcodeFrom(stop.postcode) || postcodeFrom(stop.address) || masterPostcode;
      if (stopPostcode) stop.postcode = stopPostcode;

      if (site?.collectionAddress) {
        if (!usefulAddress(stop.address)) stop.address = site.collectionAddress;
        else if (stopPostcode && !postcodeFrom(stop.address)) stop.address = addressWithPostcode(stop.address, stopPostcode);
      } else if (stopPostcode && !postcodeFrom(stop.address)) {
        stop.address = addressWithPostcode(stop.address, stopPostcode);
      }

      if (site?.latitude != null && site.longitude != null) {
        stop.latitude = String(site.latitude); stop.longitude = String(site.longitude);
        resolved++; continue;
      }

      const label = stopSiteName(stop.name);
      const query = site?.collectionAddress || (stopPostcode ? `${stopPostcode}, United Kingdom` : usefulAddress(stop.address) ? stop.address! : `${label}, United Kingdom`);
      try {
        const response = await api.geocode(query, access) as { results?: Array<{ position?: { lat?: number; lon?: number } }> };
        const position = response.results?.[0]?.position;
        if (position?.lat == null || position.lon == null) throw new Error("No point returned");
        stop.latitude = String(position.lat); stop.longitude = String(position.lon);
        resolved++;
      } catch { failed.push(stop.name); }
    }
    setStops(next);
    setMessage(failed.length
      ? `${resolved} stop${resolved === 1 ? "" : "s"} located. Check the Site Master postcode for: ${failed.join(", ")}.`
      : `${resolved} stop${resolved === 1 ? "" : "s"} located from Site Master postcode/address data.`);
    return next;
  }

  function promptForMissingPostcodes(source: EditableStop[]) {
    const next = source.map(stop => ({ ...stop }));
    const missing: string[] = [];
    for (const stop of next) {
      const site = matchSite(sites, stop.name);
      const existing = postcodeFrom(stop.postcode) || postcodeFrom(stop.address) || postcodeFrom(site?.collectionAddress);
      if (existing) {
        stop.postcode = existing;
        continue;
      }

      const entered = window.prompt(`Postcode needed for ${stop.name}`, stop.postcode || "");
      if (entered === null) throw new Error("Dispatch cancelled. The route needs a postcode before it can be sent.");
      const formatted = postcodeFrom(entered) || formatPostcode(entered);
      if (!postcodeFrom(formatted)) {
        missing.push(stop.name);
        continue;
      }
      stop.postcode = formatted;
      stop.address = addressWithPostcode(stop.address, formatted);
    }
    if (missing.length) throw new Error(`Add a valid postcode before dispatching: ${missing.join(", ")}.`);
    setStops(next);
    return next;
  }

  async function saveConfirmedPostcodesToSites(source: EditableStop[], access: string) {
    const updated = new Set<string>();
    for (const stop of source) {
      const site = matchSite(sites, stop.name);
      if (!site || postcodeFrom(site.collectionAddress)) continue;
      const stopPostcode = postcodeFrom(stop.postcode) || postcodeFrom(stop.address);
      if (!stopPostcode) continue;
      await api.updateSite(site.id, {
        externalCode: site.externalCode,
        name: site.name,
        driverTextName: site.driverTextName,
        aliases: site.aliases,
        collectionAddress: addressWithPostcode(site.collectionAddress || stop.address || stopSiteName(stop.name), stopPostcode),
        collectionInstructions: site.collectionInstructions,
        mapLink: site.mapLink,
        latitude: site.latitude,
        longitude: site.longitude,
        customField1: site.customField1,
        customField2: site.customField2,
        customField3: site.customField3,
        active: site.active,
      }, access);
      updated.add(site.name);
    }
    return [...updated];
  }

  async function dispatchRun() {
    if (!driverId || !vehicleId) {
      setMessage("Allocate both a driver and vehicle before dispatch.");
      return;
    }

    setSaving(true); setMessage(undefined); setRouteSummary(undefined);
    try {
      const access = await token();
      await allocateRun(load.id, { vehicleId, driverId, trailerId: trailerId || undefined }, access);
      await updateRunOperational(load.id, {
        palletSpacesUsed: Number.isFinite(numericUsed) ? numericUsed : undefined,
        totalPalletSpaces: effectiveCapacity,
        capacityType,
        depotSplits: load.depotSplits,
        temperatureC: load.temperatureC,
        plannerNotes: load.plannerNotes,
      }, access);

      const promptedStops = promptForMissingPostcodes(stops);
      const updatedSites = await saveConfirmedPostcodesToSites(promptedStops, access);
      let routeStops = promptedStops;
      if (routeStops.filter(stop => stop.latitude.trim() && stop.longitude.trim()).length < 2) routeStops = await resolveLocations(access, promptedStops);
      if (routeStops.filter(stop => stop.latitude.trim() && stop.longitude.trim()).length < 2)
        throw new Error("At least two stops need a valid postcode or Site Master location before dispatch.");

      await updateRunStops(load.id, stopPayload(routeStops), access);
      const result = await getRunRoute(load.id, access) as {
        routes?: Array<{ summary?: { lengthInMeters?: number; travelTimeInSeconds?: number } }>;
        approximate?: boolean;
      };
      const summary = result.routes?.[0]?.summary;
      if (!summary) throw new Error("The route service did not return a route, so this run was not dispatched.");

      const minutes = Math.max(1, Math.round((summary.travelTimeInSeconds || 0) / 60));
      const readiness = await checkDispatchReadiness(load.id, minutes, access);
      const dispatchMinutes = minutes + Math.max(0, readiness.breakMinutesIncluded || 0);
      const firstPlanned = routeStops.find(stop => stop.plannedArrivalUtc)?.plannedArrivalUtc;
      const firstTime = firstPlanned ? new Date(firstPlanned).getTime() : Number.NaN;
      const baseTime = Number.isFinite(firstTime) && firstTime > Date.now() ? firstTime : Date.now();
      const finalEta = new Date(baseTime + dispatchMinutes * 60_000).toISOString();
      const withEta = routeStops.map((stop, index) => index === routeStops.length - 1 ? { ...stop, plannedArrivalUtc: finalEta } : stop);
      await updateRunStops(load.id, stopPayload(withEta), access);
      const driverText = buildDriverText(load, await getRunDispatch(load.id, access));
      const response = await fetch(`/tms-api/api/v1/loads/${encodeURIComponent(load.id)}/driver-message/sms`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
        body: JSON.stringify({ message: driverText, dispatch: true, routeDrivingMinutes: minutes, acknowledgeUnverified: readiness.acknowledgedUnverified === true }),
      });
      if (!response.ok) {
        const body = await response.text();
        let detail = body;
        try { detail = (JSON.parse(body) as { message?: string }).message || body; } catch { /* keep response body */ }
        throw new Error(detail || `Driver text failed (${response.status}).`);
      }
      const receipt = await response.json() as { provider?: string; mobileSuffix?: string; status?: string };

      setStops(withEta); await onSaved(); signalPlanningChange();
      const structuralNote = readiness.acknowledgedUnverified ? " Structural warnings were explicitly acknowledged before the live TachoMaster check." : "";
      setMessage(`Dispatched and driver text sent${receipt.mobileSuffix ? ` to mobile ending ${receipt.mobileSuffix}` : ""}. ${readiness.explanation}${structuralNote} ETA calculated${result.approximate ? " using the resilient road estimate" : ""}.${updatedSites.length ? ` Saved postcode to Site Master for ${updatedSites.join(", ")}.` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The run could not be dispatched.");
    } finally { setSaving(false); }
  }

  async function prepareDriverText(openModal = true) {
    setSaving(true); setMessage(undefined);
    try {
      const text = buildDriverText(load, await getRunDispatch(load.id, await token()));
      setPreviewText(text); if (openModal) setPreviewOpen(true); return text;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The driver text could not be prepared."); return undefined;
    } finally { setSaving(false); }
  }

  async function copyDriverText() {
    const text = previewText || await prepareDriverText(false);
    if (!text) return;
    await navigator.clipboard.writeText(text); setMessage("Driver text copied.");
  }

  async function sendDriverText(messageOverride?: string) {
    const text = messageOverride ?? (previewText || (await prepareDriverText(false)));
    if (!text) return;
    setSaving(true); setMessage(undefined);
    try {
      const access = await token();
      const response = await fetch(`/tms-api/api/v1/loads/${encodeURIComponent(load.id)}/driver-message/sms`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
        body: JSON.stringify({ message: text }),
      });
      if (!response.ok) {
        const body = await response.text();
        let detail = body;
        try { detail = (JSON.parse(body) as { message?: string }).message || body; } catch { /* keep response body */ }
        throw new Error(detail || `SMS failed (${response.status}).`);
      }
      const receipt = await response.json() as { provider?: string; mobileSuffix?: string };
      await onSaved(); setPreviewOpen(false); setFreeTextOpen(false);
      setMessage(`${receipt.provider || "SMS provider"} accepted the driver text${receipt.mobileSuffix ? ` for the mobile ending ${receipt.mobileSuffix}` : ""}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The driver SMS could not be sent."); }
    finally { setSaving(false); }
  }

  return (
    <article className="order-card allocation-card">
      <div className="title-row">
        <div><strong>{runLabel}</strong><small>{load.stops.length} stop{load.stops.length === 1 ? "" : "s"} · {load.stops.map(stop => stop.name).join(" → ") || "Stops pending"}</small></div>
        <span className={utilisation != null && utilisation > 100 ? "capacity-warning" : ""}>
          {numericUsed} / {effectiveCapacity ?? "—"} {spaceLabel(capacityType)} · {loadTypeLabel(capacityType)}{utilisation != null ? ` · ${utilisation.toFixed(1)}%` : ""}
        </span>
      </div>

      <div className="allocation-fields">
        <select value={vehicleId} onChange={event => setVehicleId(event.target.value)}><option value="">Vehicle</option>{vehicles.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.registration}</option>)}</select>
        <select value={driverId} onChange={event => setDriverId(event.target.value)}><option value="">Driver</option>{drivers.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select>
        <select value={trailerId} onChange={event => setTrailerId(event.target.value)}><option value="">Trailer</option>{trailers.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.trailerNumber} · Std {item.standardCapacity ?? "—"} / Euro {item.euroCapacity ?? "—"}</option>)}</select>
        <select value={capacityType} onChange={event => setCapacityType(event.target.value as CapacityType)}><option>Standard pallets</option><option>Euro pallets</option><option>Trays</option><option>Trolleys</option><option>Mixed load</option></select>
        <label>Floor spaces used<input type="number" min="0" step="1" value={used} onChange={event => setUsed(event.target.value)} /></label>
        <button className="primary" type="button" onClick={() => void saveAllocation()} disabled={saving}>{saving ? "Saving…" : "Save allocation & capacity"}</button>
      </div>

      <div className="run-card-actions">
        <button className="primary" type="button" onClick={() => void dispatchRun()} disabled={saving || !driverId || !vehicleId}>{saving ? "Dispatching…" : "Dispatch"}</button>
        <button type="button" onClick={() => void prepareDriverText(true)} disabled={saving}>Preview driver text</button>
        <button type="button" onClick={() => { setFreeText(""); setFreeTextOpen(true); }} disabled={saving || !driverId || !vehicleId}>Free type text</button>
      </div>

      {routeSummary && <p className="run-route-summary">{routeSummary}</p>}

      {selectedTrailer ? <p className="hint">Trailer matrix: {selectedTrailer.trailerNumber} · Standard {selectedTrailer.standardCapacity ?? "not set"} · Euro {selectedTrailer.euroCapacity ?? "not set"}.</p> : <p className="hint">Select the trailer to apply its capacity matrix.</p>}
      {selectedDriver && <p className="hint">Driver text recipient: {selectedDriver.displayName} · {selectedDriver.mobileNumber || "mobile number needs approval in Master Data"}</p>}
      {message && <p className="notice inline-notice run-location-warning">{message}</p>}

      {previewOpen && <div className="run-text-modal-backdrop" onClick={() => setPreviewOpen(false)}>
        <div className="run-text-modal" role="dialog" aria-modal="true" aria-label={`Driver text preview for ${runLabel}`} onClick={event => event.stopPropagation()}>
          <div className="title-row"><div><p className="eyebrow">Driver text preview</p><h2>{runLabel}</h2></div><button type="button" onClick={() => setPreviewOpen(false)}>Close</button></div>
          <textarea readOnly value={previewText} />
          <div className="run-text-modal-actions"><button type="button" onClick={() => void copyDriverText()}>Copy text</button><button className="primary" type="button" onClick={() => setPreviewOpen(false)}>Close preview</button></div>
        </div>
      </div>}
      {freeTextOpen && <div className="run-text-modal-backdrop" onClick={() => setFreeTextOpen(false)}>
        <div className="run-text-modal" role="dialog" aria-modal="true" aria-label={`Free type driver text for ${runLabel}`} onClick={event => event.stopPropagation()}>
          <div className="title-row"><div><p className="eyebrow">Free type text</p><h2>{runLabel}</h2></div><button type="button" onClick={() => setFreeTextOpen(false)}>Close</button></div>
          <textarea value={freeText} onChange={event => setFreeText(event.target.value)} placeholder="Type the message to send to this driver..." />
          <div className="run-text-modal-actions"><button type="button" onClick={() => setFreeTextOpen(false)}>Cancel</button><button className="primary" type="button" onClick={() => void sendDriverText(freeText)} disabled={saving || !driverId || !vehicleId || !freeText.trim()}>Send free text</button></div>
        </div>
      </div>}
    </article>
  );
}

export function RunsCapacityAllocation() {
  const token = useAccessToken();
  const [date, setDate] = useState(localDate());
  const loads = useApi(useCallback(async () => listRuns(date, await token()), [date, token]));
  const vehicles = useApi(useCallback(async () => api.vehicles(await token()), [token]));
  const drivers = useApi(useCallback(async () => api.drivers(await token()), [token]));
  const trailers = useApi(useCallback(async () => api.trailers(await token()), [token]));
  const sites = useApi(useCallback(async () => api.sites(await token()), [token]));
  const rows = loads.data || [];
  const refreshLoads = loads.refresh;
  const refreshVehicles = vehicles.refresh;
  const refreshDrivers = drivers.refresh;
  const refreshTrailers = trailers.refresh;
  const refreshSites = sites.refresh;

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshLoads(), refreshVehicles(), refreshDrivers(), refreshTrailers(), refreshSites()]);
  }, [refreshDrivers, refreshLoads, refreshSites, refreshTrailers, refreshVehicles]);

  useEffect(() => subscribePlanningChanges(() => void refreshAll()), [refreshAll]);

  const error = loads.error || vehicles.error || drivers.error || trailers.error || sites.error;
  return <section>
    <div className="title-row"><div><p className="eyebrow">Run allocation</p><h2>Driver, vehicle, trailer & load capacity</h2><p className="intro">Capacity remains visible on the run card. Driver text is kept operational and concise.</p></div><button type="button" onClick={() => void refreshAll()}>Refresh allocation</button></div>
    <div className="planner-toolbar"><label>Plan date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><span>{rows.length} run{rows.length === 1 ? "" : "s"}</span></div>
    {error && <p className="notice inline-notice">{error}</p>}
    {!error && !rows.length && <div className="state">No runs are available for this planning date.</div>}
    <div className="allocation-load-list">{rows.map(load => <RunAllocationCard key={load.id} load={load} vehicles={vehicles.data || []} drivers={drivers.data || []} trailers={trailers.data || []} sites={sites.data || []} onSaved={refreshAll} />)}</div>
  </section>;
}