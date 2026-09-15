type OrderDates = {
  collectionDate?: unknown;
  deliveryDate?: unknown;
};

const text = (value: unknown) => String(value ?? "").trim();

/**
 * A staged booking can be planned from either its collection or delivery date.
 * Keep the date-strip, bubbles and selected-day list on the same definition so
 * an inbound order cannot be present in the queue but invisible to planners.
 */
export function planningDates(order: OrderDates): string[] {
  return Array.from(new Set([
    text(order.collectionDate),
    text(order.deliveryDate),
  ].filter(Boolean)));
}

export function matchesPlanningDate(order: OrderDates, date: string): boolean {
  return planningDates(order).includes(date);
}
