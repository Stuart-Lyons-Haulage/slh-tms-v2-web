import type { RunSuggestionLine, RunSuggestionOrder } from "./runPlannerSuggestions";

export type RunCapacitySnapshot = {
  standardPallets: number;
  euroPallets: number;
  trolleys: number;
  nonPalletUnits: number;
  unknownPallets: number;
  standardCapacity: number;
  euroCapacity: number;
  utilisation: number;
  utilisationPercent: number;
  standardEquivalentUsed: number;
  standardRemaining: number;
  euroRemaining: number;
  overStandardEquivalent: number;
  status: "Green" | "Amber" | "Red";
};

function palletKind(palletType?: string, loadUnitType?: string) {
  const type = `${loadUnitType || ""} ${palletType || ""}`.trim().toLowerCase();
  if (type.includes("trolley") || type.includes("dolly")) return "Trolley" as const;
  if (type.includes("tray") || type.includes("crate")) return "NonPallet" as const;
  if (type.includes("euro")) return "Euro" as const;
  if (type.includes("std") || type.includes("standard")) return "Standard" as const;
  return "Unknown" as const;
}

function lineQuantity(line: RunSuggestionLine) {
  const value = Number(line.pallets || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateRunCapacity(
  lines: RunSuggestionLine[],
  orders: RunSuggestionOrder[],
  standardCapacity = 26,
  euroCapacity = 33,
): RunCapacitySnapshot {
  if (standardCapacity <= 0 || euroCapacity <= 0) throw new Error("Pallet capacities must be positive.");
  const byId = new Map(orders.map((order) => [order.id, order]));
  let standardPallets = 0;
  let euroPallets = 0;
  let trolleys = 0;
  let nonPalletUnits = 0;
  let unknownPallets = 0;

  for (const line of lines) {
    if (!line.orderId) continue;
    const quantity = lineQuantity(line);
    if (!quantity) continue;
    const order = byId.get(line.orderId);
    const kind = palletKind(order?.palletType, order?.loadUnitType);
    if (kind === "Standard") standardPallets += quantity;
    else if (kind === "Euro") euroPallets += quantity;
    else if (kind === "Trolley") trolleys += quantity;
    else if (kind === "NonPallet") nonPalletUnits += quantity;
    else unknownPallets += quantity;
  }

  const palletUtilisation = (standardPallets / standardCapacity) + (euroPallets / euroCapacity);
  const trolleyUtilisation = (trolleys + standardPallets + euroPallets) / 41;
  const utilisation = Math.max(palletUtilisation, trolleyUtilisation);
  const remainingFraction = Math.max(1 - utilisation, 0);
  const standardRemaining = Math.max(Math.floor((remainingFraction * standardCapacity) + 1e-9), 0);
  const euroRemaining = Math.max(Math.floor((remainingFraction * euroCapacity) + 1e-9), 0);
  const overStandardEquivalent = utilisation > 1
    ? Math.ceil(((utilisation - 1) * standardCapacity) * 10) / 10
    : 0;
  const status = unknownPallets > 0 ? "Amber" : utilisation > 1 ? "Red" : "Green";

  return {
    standardPallets,
    euroPallets,
    trolleys,
    nonPalletUnits,
    unknownPallets,
    standardCapacity,
    euroCapacity,
    utilisation,
    utilisationPercent: Math.round(utilisation * 1000) / 10,
    standardEquivalentUsed: Math.round(utilisation * standardCapacity * 100) / 100,
    standardRemaining,
    euroRemaining,
    overStandardEquivalent,
    status,
  };
}

export function candidateFitsCapacity(order: RunSuggestionOrder, capacity: RunCapacitySnapshot) {
  const quantity = Math.max(order.outstandingPallets, 0);
  const kind = palletKind(order.palletType, order.loadUnitType);
  if (kind === "Euro") return quantity <= capacity.euroRemaining;
  if (kind === "Standard") return quantity <= capacity.standardRemaining;
  if (kind === "Trolley") return quantity <= Math.max(41 - capacity.trolleys - capacity.standardPallets - capacity.euroPallets, 0);
  if (kind === "NonPallet") return true;
  return false;
}
