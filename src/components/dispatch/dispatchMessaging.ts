export function dispatchActionForStatus(lockedToDriver: boolean, _status?: string): "allocate" | "dispatch" {
  if (!lockedToDriver) return "allocate";
  return "dispatch";
}

export function canUnassignDispatchRun(lockedToDriver: boolean, status?: string): boolean {
  return lockedToDriver && status !== "No Run";
}
