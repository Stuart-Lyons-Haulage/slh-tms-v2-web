import type { MarketContact } from "../lib/api";

export const ALL_MARKETS = "__all__";
const preferredMarkets = ["Covent", "Spit", "Western", "Sender"];

function clean(value?: string) { return String(value || "").trim(); }
function normal(value?: string) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

export function marketTabs(rows: MarketContact[]) {
  const discovered = Array.from(new Set(rows.map(row => clean(row.market)).filter(Boolean)));
  const extras = discovered.filter(market => !preferredMarkets.some(preferred => normal(preferred) === normal(market))).sort((left, right) => left.localeCompare(right));
  return [...preferredMarkets, ...extras];
}

export function marketRowsForTab(rows: MarketContact[], activeMarket: string) {
  if (activeMarket === ALL_MARKETS) return rows;
  return rows.filter(row => normal(row.market) === normal(activeMarket));
}
