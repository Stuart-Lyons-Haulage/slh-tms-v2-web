export const TV_DISPLAY_STORAGE_KEY = "slh-tv-display-key";

export function readStoredDisplayKey() {
  try { return localStorage.getItem(TV_DISPLAY_STORAGE_KEY)?.trim() || ""; } catch { return ""; }
}

export function storeDisplayKey(value: string) {
  try { localStorage.setItem(TV_DISPLAY_STORAGE_KEY, value); } catch { /* TV browser storage can be restricted */ }
}

export function clearDisplayKey() {
  try { localStorage.removeItem(TV_DISPLAY_STORAGE_KEY); } catch { /* keep rendering even if storage is restricted */ }
}
