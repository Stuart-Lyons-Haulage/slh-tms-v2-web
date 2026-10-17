import { describe, expect, it } from "vitest";
import { buildHistoricalRouteAffinity, suggestJobsForRun, suggestionConfidencePercent } from "./runPlannerSuggestions";

describe("suggestionConfidencePercent", () => {
  it("converts the optimiser score to a bounded planner percentage", () => {
    expect(suggestionConfidencePercent(91)).toBe(100);
    expect(suggestionConfidencePercent(45.5)).toBe(50);
    expect(suggestionConfidencePercent(-5)).toBe(0);
    expect(suggestionConfidencePercent(200)).toBe(100);
  });
});

describe("suggestJobsForRun", () => {
  const sites = [
    { name: "Selsey", externalCode: "SEL", operationalRegion: "South East", active: true },
    { name: "Greenhouse", externalCode: "GRN", operationalRegion: "South East", active: true },
    { name: "NWF - Runcton", externalCode: "NWF", operationalRegion: "South East", active: true },
    { name: "Morrisons Stockton", externalCode: "STO", aliases: "Morrisons Fruit Stockton123", operationalRegion: "North", active: true },
    { name: "Darlington", externalCode: "DAR", operationalRegion: "North", active: true },
    { name: "Bolton", externalCode: "BOL", operationalRegion: "North", active: true },
    { name: "Atherstone", externalCode: "ATH", operationalRegion: "Midlands", active: true },
    { name: "Merston", externalCode: "MER", operationalRegion: "South East", active: true },
    { name: "Leeds", externalCode: "LDS", operationalRegion: "North", active: true },
    { name: "York", externalCode: "YRK", operationalRegion: "North", active: true },
    { name: "Newcastle", externalCode: "NCL", operationalRegion: "North", active: true },
    { name: "Bristol", externalCode: "BRI", operationalRegion: "West / Wales", active: true },
    { name: "Cardiff", externalCode: "CDF", operationalRegion: "West / Wales", active: true },
  ];

  it("puts remaining work for an existing repeated destination ahead of same-collection work", () => {
    const suggestions = suggestJobsForRun(
      [
        { orderId: "darlo", collectionSite: "Greenhouse", deliverySite: "Darlington" },
        { orderId: "stock-1", collectionSite: "Selsey", deliverySite: "Morrisons Stockton" },
        { orderId: "stock-2", collectionSite: "NWF - Runcton", deliverySite: "Morrisons Stockton" },
      ],
      [
        { id: "stock-left", reference: "STOCK", collection: "Merston", destination: "Morrisons Fruit Stockton123", outstandingPallets: 4 },
        { id: "same-collection", reference: "BOLTON", collection: "Selsey", destination: "Bolton", outstandingPallets: 1 },
        { id: "same-collection-2", reference: "ATHER", collection: "Greenhouse", destination: "Atherstone", outstandingPallets: 2 },
      ],
      sites,
      4,
    );

    expect(suggestions[0].order.id).toBe("stock-left");
    expect(suggestions[0].reasons).toContain("Already delivering this destination");
    expect(suggestions[0].reasons).toContain("Destination already appears 2 times");
  });

  it("prioritises jobs that share the current lane or collect from an existing delivery", () => {
    const suggestions = suggestJobsForRun(
      [{ orderId: "current", collectionSite: "Selsey", deliverySite: "Leeds" }],
      [
        { id: "current", reference: "CURRENT", collection: "Selsey", destination: "Leeds", outstandingPallets: 8 },
        { id: "same-lane", reference: "SAME", collection: "Selsey", destination: "York", outstandingPallets: 6 },
        { id: "chain", reference: "CHAIN", collection: "Leeds", destination: "Newcastle", outstandingPallets: 4 },
        { id: "unrelated", reference: "OTHER", collection: "Bristol", destination: "Cardiff", outstandingPallets: 3 },
      ],
      sites,
      12,
    );

    expect(suggestions.map((item) => item.order.id)).toEqual(["chain", "same-lane"]);
    expect(suggestions[0].reasons).toContain("Collects from an existing delivery");
    expect(suggestions[1].reasons).toContain("Same collection");
    expect(suggestions.every((item) => item.order.id !== "current")).toBe(true);
  });

  it("uses recent historical co-loading as a learning signal", () => {
    const history = buildHistoricalRouteAffinity([
      {
        planningDate: "2026-09-01",
        status: "Completed",
        stops: [
          { sequence: 1, name: "Collect · Selsey" },
          { sequence: 2, name: "Deliver · Leeds" },
          { sequence: 3, name: "Collect · Merston" },
          { sequence: 4, name: "Deliver · Morrisons Stockton" },
        ],
      },
      {
        planningDate: "2026-09-02",
        status: "Completed",
        stops: [
          { sequence: 1, name: "Collect · Selsey" },
          { sequence: 2, name: "Deliver · Leeds" },
          { sequence: 3, name: "Collect · Merston" },
          { sequence: 4, name: "Deliver · Morrisons Fruit Stockton123" },
        ],
      },
    ], sites, "2026-09-07", 90);

    const suggestions = suggestJobsForRun(
      [{ orderId: "current", collectionSite: "Selsey", deliverySite: "Leeds" }],
      [
        { id: "learned", reference: "LEARNED", collection: "Merston", destination: "Morrisons Stockton", outstandingPallets: 4 },
        { id: "regional", reference: "REGION", collection: "Greenhouse", destination: "Darlington", outstandingPallets: 4 },
      ],
      sites,
      10,
      6,
      history,
    );

    expect(suggestions[0].order.id).toBe("learned");
    expect(suggestions[0].reasons).toContain("Planned with this flow 2 times recently");
  });

  it("favours an order that fits the remaining run capacity", () => {
    const suggestions = suggestJobsForRun(
      [{ orderId: "current", collectionSite: "Selsey", deliverySite: "Leeds" }],
      [
        { id: "fits", reference: "FITS", collection: "Selsey", destination: "York", outstandingPallets: 4 },
        { id: "oversize", reference: "BIG", collection: "Selsey", destination: "York", outstandingPallets: 18 },
      ],
      sites,
      5,
    );

    expect(suggestions[0].order.id).toBe("fits");
    expect(suggestions[0].reasons).toContain("Fits remaining capacity");
    expect(suggestions[1].reasons).toContain("Exceeds current capacity");
  });

  it("does not suggest an unrelated one-pallet job merely because it fits", () => {
    const suggestions = suggestJobsForRun(
      [{ orderId: "current", collectionSite: "Selsey", deliverySite: "Leeds" }],
      [{ id: "tiny-detour", reference: "TINY", collection: "Bristol", destination: "Cardiff", outstandingPallets: 1 }],
      sites,
      18,
    );

    expect(suggestions).toEqual([]);
  });

  it("rejects same-collection work travelling on a different lane", () => {
    const suggestions = suggestJobsForRun(
      [{ orderId: "current", collectionSite: "Selsey", deliverySite: "Leeds" }],
      [{ id: "wrong-way", reference: "WRONG", collection: "Selsey", destination: "Cardiff", outstandingPallets: 1 }],
      sites,
      18,
    );

    expect(suggestions).toEqual([]);
  });

  it("uses mapped mileage to favour a nearby continuation and expose the reposition", () => {
    const mappedSites = sites.map(site => ({
      ...site,
      ...({
        Selsey: { latitude: 50.73, longitude: -0.79 },
        Leeds: { latitude: 53.80, longitude: -1.55 },
        York: { latitude: 53.96, longitude: -1.08 },
        Newcastle: { latitude: 54.98, longitude: -1.62 },
      } as Record<string, { latitude: number; longitude: number }>)[site.name],
    }));
    const suggestions = suggestJobsForRun(
      [{ orderId: "current", collectionSite: "Selsey", deliverySite: "Leeds" }],
      [{ id: "nearby", reference: "NEAR", collection: "York", destination: "Newcastle", outstandingPallets: 4 }],
      mappedSites,
      18,
    );

    expect(suggestions[0].connectorMiles).toBeGreaterThan(15);
    expect(suggestions[0].connectorMiles).toBeLessThan(35);
    expect(suggestions[0].reasons.some(reason => reason.includes("mile reposition from"))).toBe(true);
  });
});
