export const agencyStatusCodes = new Set([
  "AV", "AVAILABLE", "A", "REST", "REST DAY", "RESTDAY", "RES", "R", "R?",
  "HOL", "HOLIDAY", "LEAVE", "SICK", "OFF", "N", "N?", "D", "D?", "C", "X",
  "N/A", "NA", "UNAVAILABLE", "NOT AVAILABLE", "CANCELLED", "CANCELED",
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
]);


export function isIgnorableAgencyStatus(value: unknown) {
  const status = String(value || "").trim().toUpperCase();
  if (!status || agencyStatusCodes.has(status)) return true;
  // Some providers export the date/weekday label into the status grid. It is
  // structural workbook data, not an availability decision, so do not turn it
  // into a false import exception.
  if (/^(MON|TUE|WED|THU|FRI|SAT|SUN)\b/.test(status)) return true;
  if (/^(?:\d+\s*[ND])(?:\s+\d+\s*[ND])*$/i.test(status)) return true;
  if (/\b(?:NOT\s*REQ|CANX|CANC|CANCEL(?:LED|ED)?|NOT\s+AVAILABLE|D\s+NA|LICENCE\s+EXP|DAY\s+SHIFT\s+ONLY)\b/i.test(status)) return true;
  if (status === "?" || status.length > 40) return true;
  if (!Number.isNaN(new Date(status).getTime())) return true;
  return false;
}

