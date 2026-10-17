export const tvPaths = new Set(["/tv", "/operations-wallboard/tv", "/live-runs/tv"]);

export function isTvRoute(pathname: string) {
  return tvPaths.has(pathname);
}

export function isPublicTvLink(pathname: string, search: string) {
  return isTvRoute(pathname) && new URLSearchParams(search).has("key");
}

export function cacheLocationForRoute(pathname: string): "memoryStorage" | "sessionStorage" {
  return isTvRoute(pathname) ? "memoryStorage" : "sessionStorage";
}
