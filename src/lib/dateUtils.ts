const UK_TIME_ZONE = "Europe/London";

function partsFor(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: byType.day ?? "01",
    month: byType.month ?? "01",
    year: byType.year ?? String(date.getFullYear()),
  };
}

export function parseApiDateTime(value?: string | Date | null) {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const hasTime = raw.includes("T");
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalised = hasTime && !hasZone ? `${raw}Z` : raw;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function todayIsoDate() {
  const { day, month, year } = partsFor(new Date());
  return `${year}-${month}-${day}`;
}

export function addDaysIso(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  const { day, month, year } = partsFor(value);
  return `${year}-${month}-${day}`;
}

export function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  const date = value instanceof Date
    ? value
    : parseApiDateTime(String(value).includes("T") ? String(value) : `${value}T12:00:00Z`);
  if (!date) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatDateLong(value?: string | Date | null) {
  if (!value) return "—";
  const date = value instanceof Date
    ? value
    : parseApiDateTime(String(value).includes("T") ? String(value) : `${value}T12:00:00Z`);
  if (!date) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(value?: string | Date | null) {
  if (!value) return "—";
  const date = parseApiDateTime(value);
  if (!date) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTime(value?: string | Date | null) {
  if (!value) return "—";
  const date = parseApiDateTime(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
