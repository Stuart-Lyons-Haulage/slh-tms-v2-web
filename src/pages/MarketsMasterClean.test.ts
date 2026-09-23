import { describe, expect, it } from "vitest";
import type { MarketContact } from "../lib/api";
import { marketRowsForTab, marketTabs } from "./MarketsMasterLogic";

function contact(id: string, market: string, name: string): MarketContact {
  return { id, market, name, active: true } as MarketContact;
}

describe("Markets master tabs", () => {
  const rows = [
    contact("1", "Covent", "Seller A"),
    contact("2", "Spit", "Seller B"),
    contact("3", "Sender", "Sender C"),
    contact("4", "Brighton", "Seller D"),
  ];

  it("keeps the standard markets and adds any live custom market", () => {
    expect(marketTabs(rows)).toEqual(["Covent", "Spit", "Western", "Sender", "Brighton"]);
  });

  it("filters an individual market without losing the all-markets view", () => {
    expect(marketRowsForTab(rows, "Spit").map(row => row.id)).toEqual(["2"]);
    expect(marketRowsForTab(rows, "__all__").map(row => row.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("matches market names without depending on punctuation or case", () => {
    const variants = [contact("5", "Western Market", "Seller E"), contact("6", "WESTERN-MARKET", "Seller F")];
    expect(marketRowsForTab(variants, "western market")).toHaveLength(2);
  });
});
