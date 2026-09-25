export function dispatchActionForStatus(lockedToDriver: boolean, _status?: string): "allocate" | "dispatch" {
  if (!lockedToDriver) return "allocate";
  return "dispatch";
}

export function canUnassignDispatchRun(lockedToDriver: boolean, status?: string): boolean {
  return lockedToDriver && status !== "No Run";
}

export function routeDrivingMinutes(route: Record<string, unknown>): number | undefined {
  const routes = route.routes as Array<{ summary?: { travelTimeInSeconds?: number } }> | undefined;
  const seconds = routes?.[0]?.summary?.travelTimeInSeconds;
  return typeof seconds === "number" && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : undefined;
}
