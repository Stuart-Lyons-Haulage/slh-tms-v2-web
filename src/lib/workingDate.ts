import { useSyncExternalStore } from "react";
import { todayIsoDate, tomorrowIsoDate } from "./dateUtils";

/**
 * One working date for the whole tool. Pick Monday once in the header (or on any
 * page) and every screen shows Monday. The choice is remembered for the rest of the
 * day on this device, then falls back to tomorrow (the normal planning day).
 */
const STORAGE_KEY = "slh.workingDate";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Stored = { date: string; chosenOn: string };

function readStored(): string | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<Stored>;
    if (value && value.chosenOn === todayIsoDate() && typeof value.date === "string" && ISO.test(value.date)) return value.date;
  } catch { /* storage can be unavailable (private windows, previews); fall back to the default */ }
  return undefined;
}

function initialDate(): string {
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search || "").get("date");
    if (fromUrl && ISO.test(fromUrl)) return fromUrl;
  } catch { /* no location in tests */ }
  return readStored() ?? tomorrowIsoDate();
}

let current = initialDate();
const listeners = new Set<() => void>();

function emit() { listeners.forEach(listener => listener()); }

export function getWorkingDate() { return current; }

export function setWorkingDate(next: string) {
  if (!next || !ISO.test(next) || next === current) return;
  current = next;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ date: next, chosenOn: todayIsoDate() } satisfies Stored)); } catch { /* best effort */ }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const stored = readStored();
    if (stored && stored !== current) { current = stored; emit(); }
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => { listeners.delete(listener); globalThis.removeEventListener?.("storage", onStorage); };
}

/** The shared working date and its setter. Every page uses this instead of its own date state. */
export function useWorkingDate(): [string, (date: string) => void] {
  const date = useSyncExternalStore(subscribe, getWorkingDate, getWorkingDate);
  return [date, setWorkingDate];
}

export function shiftIsoDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function workingDateLabel(date: string) {
  const today = todayIsoDate();
  const prefix = date === today ? "Today · " : date === tomorrowIsoDate() ? "Tomorrow · " : date === shiftIsoDate(today, -1) ? "Yesterday · " : "";
  return prefix + new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
