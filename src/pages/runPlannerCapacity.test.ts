import { describe, expect, it } from "vitest";
import { calculateRunCapacity, candidateFitsCapacity } from "./runPlannerCapacity";

describe("calculateRunCapacity", () => {
  it("shows alternative Standard and Euro space remaining for a mixed load", () => {
    const orders = [
      { id: "std", reference: "STD", collection: "A", destination: "B", outstandingPallets: 0, palletType: "Standard" },
      { id: "euro", reference: "EUR", collection: "A", destination: "B", outstandingPallets: 0, palletType: "Euro" },
    ];
    const capacity = calculateRunCapacity([
      { orderId: "std", collectionSite: "A", deliverySite: "B", pallets: "10" },
      { orderId: "euro", collectionSite: "A", deliverySite: "B", pallets: "10" },
    ], orders);

    expect(capacity.status).toBe("Green");
    expect(capacity.utilisationPercent).toBe(68.8);
    expect(capacity.standardRemaining).toBe(8);
    expect(capacity.euroRemaining).toBe(10);
  });

  it("raises a red status when the mixed pallet footprint exceeds capacity", () => {
    const orders = [
      { id: "std", reference: "STD", collection: "A", destination: "B", outstandingPallets: 0, palletType: "Standard" },
      { id: "euro", reference: "EUR", collection: "A", destination: "B", outstandingPallets: 0, palletType: "Euro" },
    ];
    const capacity = calculateRunCapacity([
      { orderId: "std", collectionSite: "A", deliverySite: "B", pallets: "20" },
      { orderId: "euro", collectionSite: "A", deliverySite: "B", pallets: "10" },
    ], orders);

    expect(capacity.status).toBe("Red");
    expect(capacity.utilisationPercent).toBeGreaterThan(100);
    expect(capacity.standardRemaining).toBe(0);
    expect(capacity.euroRemaining).toBe(0);
    expect(capacity.overStandardEquivalent).toBeGreaterThan(0);
  });

  it("flags missing pallet types as amber and will not claim the candidate fits", () => {
    const orders = [
      { id: "unknown", reference: "UNKNOWN", collection: "A", destination: "B", outstandingPallets: 2 },
    ];
    const capacity = calculateRunCapacity([
      { orderId: "unknown", collectionSite: "A", deliverySite: "B", pallets: "2" },
    ], orders);

    expect(capacity.status).toBe("Amber");
    expect(capacity.unknownPallets).toBe(2);
    expect(candidateFitsCapacity(orders[0], capacity)).toBe(false);
  });

  it("uses Euro capacity instead of treating Euro pallets as Standard pallets", () => {
    const orders = [
      { id: "euro", reference: "EUR", collection: "A", destination: "B", outstandingPallets: 20, palletType: "Euro" },
    ];
    const capacity = calculateRunCapacity([
      { orderId: "euro", collectionSite: "A", deliverySite: "B", pallets: "20" },
    ], orders);

    expect(capacity.euroPallets).toBe(20);
    expect(capacity.standardPallets).toBe(0);
    expect(capacity.utilisationPercent).toBe(60.6);
    expect(capacity.standardEquivalentUsed).toBe(15.76);
  });

  it("does not consume pallet capacity for trays or crates until a footprint rule exists", () => {
    const orders = [
      { id: "trays", reference: "TRAY", collection: "A", destination: "B", outstandingPallets: 20, loadUnitType: "Trays" },
    ];
    const capacity = calculateRunCapacity([
      { orderId: "trays", collectionSite: "A", deliverySite: "B", pallets: "20" },
    ], orders);

    expect(capacity.nonPalletUnits).toBe(20);
    expect(capacity.utilisationPercent).toBe(0);
    expect(capacity.status).toBe("Green");
    expect(candidateFitsCapacity(orders[0], capacity)).toBe(true);
  });

  it("uses the trolley footprint when trolley work is mixed with pallets", () => {
    const orders = [
      { id: "std", reference: "STD", collection: "A", destination: "B", outstandingPallets: 20, palletType: "Standard" },
      { id: "trolley", reference: "TROLLEY", collection: "A", destination: "B", outstandingPallets: 10, loadUnitType: "Trolley" },
    ];
    const capacity = calculateRunCapacity([
      { orderId: "std", collectionSite: "A", deliverySite: "B", pallets: "20" },
      { orderId: "trolley", collectionSite: "A", deliverySite: "B", pallets: "10" },
    ], orders);

    expect(capacity.trolleys).toBe(10);
    expect(capacity.utilisationPercent).toBe(76.9);
  });
});
