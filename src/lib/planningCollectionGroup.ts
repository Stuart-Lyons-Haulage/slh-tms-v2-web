/** Use the canonical planning group without changing the physical collection site. */
export function planningCollectionGroup(order: { planningGroup?: string; collection: string }) { return order.planningGroup?.trim() || order.collection.trim(); }
