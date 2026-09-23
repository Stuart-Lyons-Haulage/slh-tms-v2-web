import type { RunDispatchDto } from "../../types/dto/dispatch";

export type DriverMessageMode = "initial" | "amendment" | "update";

export function dispatchActionForStatus(lockedToDriver: boolean, status?: string): "allocate" | "dispatch" | "amend" {
  if (!lockedToDriver) return "allocate";
  if (status === "Sent Awaiting Response" || status === "Confirmed") return "amend";
  return "dispatch";
}

export function canUnassignDispatchRun(lockedToDriver: boolean, status?: string): boolean {
  return lockedToDriver && status !== "No Run";
}

function compactTime(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function messageLines(reference: string, dispatch: RunDispatchDto, plannedStart?: string, amendment = false): string[] {
  const lines = [
    amendment ? `SLH AMENDMENT · ${reference}` : `SLH ${reference}`,
    dispatch.driver ? `Driver: ${dispatch.driver.displayName}` : "",
    plannedStart ? `${amendment ? "Revised planned start" : "Planned start"}: ${plannedStart}` : "",
    dispatch.vehicle ? `Vehicle: ${dispatch.vehicle.registration}` : "",
    dispatch.vehicle?.fuelPin ? `Fuel PIN: ${dispatch.vehicle.fuelPin}` : "",
    dispatch.trailer ? `Trailer: ${dispatch.trailer.trailerNumber}` : "",
    "",
    ...dispatch.stops.flatMap(stop => [
      `${stop.sequence}. ${stop.name}`,
      stop.address ? `Address: ${stop.address}` : "",
      stop.order?.reference ? `Ref: ${stop.order.reference}` : "",
      stop.order?.pallets != null ? `Pallets: ${stop.order.pallets}` : "",
      stop.order?.marketName ? `Market: ${stop.order.marketName}${stop.order.stallNumber ? ` · Stall ${stop.order.stallNumber}` : ""}` : "",
      stop.order?.driverInstructions ? `Notes: ${stop.order.driverInstructions}` : "",
      stop.order?.mapLink ? `Map: ${stop.order.mapLink}` : "",
      ""
    ]),
    amendment ? "Please reply to confirm the amendment." : "Please reply to confirm receipt."
  ];
  return lines.filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
}

export function buildDispatchText(reference: string, dispatch: RunDispatchDto, plannedStart?: string): string {
  return messageLines(reference, dispatch, plannedStart).join("\n").trim();
}

export function buildAmendmentText(reference: string, dispatch: RunDispatchDto, plannedStart?: string): string {
  return messageLines(reference, dispatch, plannedStart, true).join("\n").trim();
}

export function buildUpdateText(reference: string): string {
  return `SLH UPDATE · ${reference}\n\n`;
}

export function routeDrivingMinutes(route: Record<string, unknown>): number | undefined {
  const routes = route.routes as Array<{ summary?: { travelTimeInSeconds?: number } }> | undefined;
  const seconds = routes?.[0]?.summary?.travelTimeInSeconds;
  return typeof seconds === "number" && seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : undefined;
}

export function plannedStartLocal(value?: string): string | undefined {
  return compactTime(value);
}
