/**
 * How much an order is, in the words a planner uses. Pallet (space) counts and
 * tray / crate counts are kept apart: customers often say "8,316 trays" or "600 crates"
 * without saying how many pallet spaces that takes, and "0 pallets" would be wrong.
 */
export type QuantityInput = {
  pallets?: number | string | null;
  unitCount?: number | string | null;
  unitCountType?: string | null;
  loadUnitType?: string | null;
  palletType?: string | null;
};

export type QuantityText = { main: string; detail?: string; palletsStated: boolean; unitsStated: boolean };

const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

/** "Trays" / "Crates" / "Shippers" / "Trolleys" when the job isn't plain pallets. */
export function itemWord(input: QuantityInput): string | undefined {
  const value = `${input.unitCountType || ""} ${input.loadUnitType || ""} ${input.palletType || ""}`.toLowerCase();
  if (value.includes("shipper")) return "shippers";
  if (value.includes("tray") || value.includes("euro pool")) return "trays";
  if (value.includes("crate") || value.includes("ifco")) return "crates";
  if (value.includes("trolley") || value.includes("dolly")) return "trolleys";
  return undefined;
}

export function describeQuantity(input: QuantityInput): QuantityText {
  const pallets = number(input.pallets);
  const units = number(input.unitCount);
  const word = itemWord(input);
  const unitText = units ? `${units.toLocaleString("en-GB")} ${word || "units"}` : undefined;
  if (pallets) {
    // Trolleys are counted as trolleys, not pallets.
    if (word === "trolleys" && !units) return { main: `${pallets} trolleys`, palletsStated: true, unitsStated: false };
    return {
      main: `${pallets} plt`,
      detail: unitText ?? (word && word !== "trolleys" ? `pallets of ${word}` : undefined),
      palletsStated: true,
      unitsStated: Boolean(units),
    };
  }
  if (unitText) return { main: unitText, detail: "pallet spaces not stated", palletsStated: false, unitsStated: true };
  return { main: "Count not stated", detail: word ? `${word}: ask the customer` : undefined, palletsStated: false, unitsStated: false };
}

export function quantityLabel(input: QuantityInput) {
  const value = describeQuantity(input);
  return value.detail ? `${value.main} · ${value.detail}` : value.main;
}

/** The same, read from a staged order payload (Order review cards). */
export function payloadQuantity(payload: Record<string, unknown>): QuantityInput {
  const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
  const declared = text(payload.unitCountType) || text(payload.handlingUnitType) || text(payload.unitType);
  const pallets = number(payload.pallets);
  let unitCount = number(payload.unitCount);
  const handling = number(payload.handlingUnitQuantity);
  if (!unitCount && handling && handling !== pallets && /tray|crate|ifco|shipper|euro\s*pool/i.test(declared)) unitCount = handling;
  return { pallets, unitCount, unitCountType: declared || undefined, loadUnitType: text(payload.loadUnitType) || undefined, palletType: text(payload.palletType) || undefined };
}
