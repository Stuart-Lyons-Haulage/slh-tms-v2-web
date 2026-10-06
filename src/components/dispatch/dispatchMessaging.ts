export function dispatchActionForStatus(lockedToDriver: boolean, status?: string): "allocate" | "dispatch" {
  if (!lockedToDriver) return "allocate";
  void status;
  return "dispatch";
}

export function canUnassignDispatchRun(lockedToDriver: boolean, status?: string): boolean {
  return lockedToDriver && status !== "No Run";
}
