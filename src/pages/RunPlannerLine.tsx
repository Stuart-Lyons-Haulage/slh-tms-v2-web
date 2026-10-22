import { memo, type Dispatch, type SetStateAction } from "react";
import type { Site } from "../lib/api";

export type RunLinePeriod = "" | "AM" | "PM";
export type RunLineAllocation = { loadId: string; loadReference?: string; pallets: number };
export type RunLineOrder = {
  id: string;
  reference: string;
  lineNote?: string;
  customerCode: string;
  orderedPallets: number;
  plannedPallets: number;
  outstandingPallets: number;
  collection: string;
  destination: string;
  originalDestination?: string;
  source?: string;
  temperature?: string;
  palletType?: string;
  loadUnitType?: string;
  allocations: RunLineAllocation[];
};
export type RunLineModel = {
  key: string;
  orderId?: string;
  orderIds?: string[];
  orderAllocations?: Record<string, number>;
  collectionSite: string;
  deliverySite: string;
  pallets: string;
  note: string;
  collectionTime: string;
};
export type RunLineRun = {
  key: string;
  loadId?: string;
  period: RunLinePeriod;
  nightOut: boolean;
  doubleStackingApproved: boolean;
  operationalAmendment: string;
  relayEnabled: boolean;
  handoverSite: string;
  handoverAfterStopSequence: string;
  lines: RunLineModel[];
};

export type RunLineProps = {
  run: RunLineRun;
  line: RunLineModel;
  lineIndex: number;
  effectiveOrders: RunLineOrder[];
  sites: Site[];
  liveCollections: string[];
  availableOrders: RunLineOrder[];
  busyKey?: string;
  openPicker?: string;
  setOpenPicker: Dispatch<SetStateAction<string | undefined>>;
  changeLineLocation: (runKey: string, line: RunLineModel, field: "collectionSite" | "deliverySite", value: string) => void;
  scheduleQuantity: (run: RunLineRun, line: RunLineModel, value: string) => void;
  chooseCollection: (runKey: string, lineKey: string, collection: string) => void;
  chooseDelivery: (runKey: string, lineKey: string, collection: string, destination: string) => void;
  updateLine: (runKey: string, lineKey: string, patch: Partial<RunLineModel>) => void;
  persistLineNote: (run: RunLineRun, line: RunLineModel, note: string) => Promise<void>;
  clearLine: (run: RunLineRun, line: RunLineModel) => Promise<void>;
};

const normalise = (value: unknown) => String(value ?? "").trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
const lineOrderIds = (line: RunLineModel) => line.orderIds?.length ? line.orderIds : line.orderId ? [line.orderId] : [];

function RunPlannerLineView({
  run, line, lineIndex, effectiveOrders, liveCollections, availableOrders,
  busyKey, openPicker, setOpenPicker, changeLineLocation, scheduleQuantity,
  chooseCollection, chooseDelivery, updateLine, persistLineNote, clearLine,
}: RunLineProps) {
  const refs = lineOrderIds(line).map((id) => effectiveOrders.find((order) => order.id === id)?.reference).filter(Boolean);
  const collectionKey = normalise(line.collectionSite);
  const matches = effectiveOrders.filter((order) =>
    normalise(order.collection) === collectionKey && normalise(order.destination) === normalise(line.deliverySite));
  const completeRoute = Boolean(line.collectionSite.trim() && line.deliverySite.trim());
  const collectionSuggestions = liveCollections
    .filter((collection) => !line.collectionSite || normalise(collection).includes(collectionKey))
    .slice(0, 8);
  const deliveryByName = new Map<string, { destination: string; pallets: number }>();
  availableOrders.filter((order) => normalise(order.collection) === collectionKey).forEach((order) => {
    const destination = order.destination.trim();
    const key = normalise(destination);
    const current = deliveryByName.get(key);
    deliveryByName.set(key, { destination, pallets: (current?.pallets || 0) + Math.max(order.outstandingPallets, 0) });
  });
  const deliverySuggestions = [...deliveryByName.values()].sort((left, right) => left.destination.localeCompare(right.destination));
  const collectionPickerKey = `${run.key}:${line.key}:collection`;
  const deliveryPickerKey = `${run.key}:${line.key}:delivery`;
  const orderIds = lineOrderIds(line);

  return (
    <div className="simple-run-line" title={refs.length > 1 ? `${refs.length} source orders: ${refs.join(", ")}` : refs[0]}>
      <span className="simple-line-number">{lineIndex + 1}</span>
      <div className="simple-picker">
        <input autoComplete="off" inputMode="search" enterKeyHint="next" value={line.collectionSite}
          onFocus={() => setOpenPicker(collectionPickerKey)}
          onBlur={() => window.setTimeout(() => setOpenPicker((current) => current === collectionPickerKey ? undefined : current), 180)}
          onChange={(event) => changeLineLocation(run.key, line, "collectionSite", event.target.value)}
          placeholder="Start typing live collection…" />
        {openPicker === collectionPickerKey && line.collectionSite && (() => {
          if (collectionSuggestions.length > 0 && normalise(collectionSuggestions[0]) !== collectionKey)
            return <div className="simple-picker-options">{collectionSuggestions.map((collection) =>
              <button type="button" key={collection} onPointerDown={(event) => event.preventDefault()}
                onClick={() => { chooseCollection(run.key, line.key, collection); setOpenPicker(undefined); }}>{collection}</button>)}</div>;
          return <div className="simple-picker-options simple-picker-empty">No live collection orders for this date</div>;
        })()}
      </div>
      <input className="simple-pallet-input" type="number" min="0" inputMode="numeric" value={line.pallets}
        onChange={(event) => scheduleQuantity(run, line, event.target.value)} placeholder="0" />
      <div className="simple-picker">
        <input autoComplete="off" inputMode="search" enterKeyHint="next" value={line.deliverySite}
          onFocus={() => setOpenPicker(deliveryPickerKey)}
          onBlur={() => window.setTimeout(() => setOpenPicker((current) => current === deliveryPickerKey ? undefined : current), 180)}
          onChange={(event) => changeLineLocation(run.key, line, "deliverySite", event.target.value)}
          placeholder="Choose delivery from this collection…" />
        {openPicker === deliveryPickerKey && (() => {
          if (deliverySuggestions.length > 0)
            return <div className="simple-picker-options delivery-options">{deliverySuggestions.map((choice) =>
              <button type="button" key={choice.destination} onPointerDown={(event) => event.preventDefault()}
                onClick={() => { chooseDelivery(run.key, line.key, line.collectionSite, choice.destination); setOpenPicker(undefined); }}>
                <span>{choice.destination}</span><small>{choice.pallets} pallet{choice.pallets === 1 ? "" : "s"}</small>
              </button>)}</div>;
          return line.collectionSite ? <div className="simple-picker-options simple-picker-empty">No deliveries available from this collection</div> : null;
        })()}
      </div>
      <input className="simple-time-input" type="time" value={line.collectionTime}
        onChange={(event) => updateLine(run.key, line.key, { collectionTime: event.target.value })}
        title="Collection time (leave blank to use site master)" />
      <input value={line.note} onChange={(event) => updateLine(run.key, line.key, { note: event.target.value })}
        onBlur={(event) => void persistLineNote(run, line, event.currentTarget.value)}
        placeholder={refs.length > 1 ? `${refs.length} orders consolidated` : "Facility / load-line note"} />
      <button type="button" className="simple-clear-line" aria-label={`Clear line ${lineIndex + 1}`}
        disabled={busyKey === `${run.key}:${line.key}`}
        onClick={(event) => { event.stopPropagation(); void clearLine(run, line); }}>×</button>
      {completeRoute && <small className={`simple-line-match ${orderIds.length || matches.length ? "matched" : "unmatched"}`}>
        {orderIds.length
          ? `Linked to ${orderIds.length} live order${orderIds.length === 1 ? "" : "s"}`
          : matches.length
            ? `${matches.length} live order${matches.length === 1 ? "" : "s"} · ${matches.reduce((sum, order) => sum + order.outstandingPallets, 0)} available`
            : "No live order matches this collection and delivery for the selected date"}
      </small>}
    </div>
  );
}

function propsEqual(previous: RunLineProps, next: RunLineProps) {
  const pickerPrefix = `${previous.run.key}:${previous.line.key}:`;
  const previousPicker = previous.openPicker?.startsWith(pickerPrefix) ? previous.openPicker : undefined;
  const nextPicker = next.openPicker?.startsWith(pickerPrefix) ? next.openPicker : undefined;
  return previous.run.key === next.run.key
    && previous.run.loadId === next.run.loadId
    && previous.line === next.line
    && previous.lineIndex === next.lineIndex
    && previous.effectiveOrders === next.effectiveOrders
    && previous.sites === next.sites
    && previous.liveCollections === next.liveCollections
    && previous.availableOrders === next.availableOrders
    && (previous.busyKey === `${previous.run.key}:${previous.line.key}`) === (next.busyKey === `${next.run.key}:${next.line.key}`)
    && previousPicker === nextPicker;
}

export const RunPlannerLine = memo(RunPlannerLineView, propsEqual);
