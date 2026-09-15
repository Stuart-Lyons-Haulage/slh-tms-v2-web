type OrderDates = {
  collectionDate?: unknown;
  deliveryDate?: unknown;
  requestedTime?: unknown;
  routeTiming?: unknown;
  overnightRoute?: unknown;
  planningWindow?: unknown;
  suggestedPlanningWindow?: unknown;
  runsOvernight?: unknown;
  suggestedRouteType?: unknown;
  customerCode?: unknown;
  customer?: unknown;
  sellerName?: unknown;
  stallNumber?: unknown;
  marketName?: unknown;
  jobType?: unknown;
  driverInstructions?: unknown;
  sourceSubject?: unknown;
  sourceAttachmentName?: unknown;
};

const text = (value: unknown) => String(value ?? "").trim();
const normalise = (value: unknown) => ` ${text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;

function isTrue(value: unknown) {
  return value === true || text(value).toLowerCase() === "true";
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + days);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function isCrossDate(order: OrderDates) {
  const collection = text(order.collectionDate);
  const delivery = text(order.deliveryDate);
  return Boolean(collection && delivery && collection < delivery);
}

export function runsOvernight(order: OrderDates): boolean {
  return isTrue(order.runsOvernight)
    || isTrue(order.overnightRoute)
    || normalise(order.routeTiming).includes(" overnight ")
    || normalise(order.suggestedRouteType).includes(" overnight ")
    || isCrossDate(order);
}

export function inferredPlanningWindow(order: OrderDates): "AM" | "PM" | "Market" | "Transfer" | "Unknown" {
  const explicit = text(order.suggestedPlanningWindow || order.planningWindow);
  if (["AM", "PM", "Market", "Transfer", "Unknown"].includes(explicit)) return explicit as "AM" | "PM" | "Market" | "Transfer" | "Unknown";

  const haystack = normalise([
    order.customerCode,
    order.customer,
    order.sellerName,
    order.stallNumber,
    order.marketName,
    order.jobType,
    order.driverInstructions,
    order.sourceSubject,
    order.sourceAttachmentName,
    order.requestedTime,
  ].map(text).join(" "));

  if ([" market ", " covent ", " spitalfields ", " spit ", " western international "].some((term) => haystack.includes(term))) return "Market";
  if (haystack.includes(" transfer ")) return "Transfer";
  if (isCrossDate(order)) return "PM";
  if ([" pm ", " afternoon ", " evening ", " night ", " overnight ", " backhaul ", " backload "].some((term) => haystack.includes(term))) return "PM";
  if (haystack.includes(" barefoots ") && !haystack.includes(" am ")) return "PM";
  return "AM";
}

/**
 * PM routes that run overnight belong to the PM run build on the collection date.
 * Do not show the same customer instruction as a second selectable order on the next-day delivery board.
 */
export function planningDates(order: OrderDates): string[] {
  const collection = text(order.collectionDate);
  const delivery = text(order.deliveryDate);
  const window = inferredPlanningWindow(order);

  if (collection && delivery && collection < delivery) return [collection];
  if ((window === "PM" || window === "Market") && runsOvernight(order) && collection) return [collection];
  if ((window === "PM" || window === "Market") && !collection && delivery) return [addDays(delivery, -1) || delivery, delivery];

  return Array.from(new Set([
    collection,
    delivery,
  ].filter(Boolean)));
}

export function matchesPlanningDate(order: OrderDates, date: string): boolean {
  return planningDates(order).includes(date);
}
