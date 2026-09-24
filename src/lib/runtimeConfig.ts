const fallbackApiBaseUrl = '/tms-api';

export function normaliseApiBaseUrl(input: string) {
  const value = String(input || '').trim() || fallbackApiBaseUrl;

  if (value.startsWith('/') && !value.startsWith('//')) {
    return value.length > 1 ? value.replace(/\/+$/, '') : value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('VITE_API_BASE_URL must be a same-origin path or an absolute HTTP(S) URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use http: or https:.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('VITE_API_BASE_URL must not contain credentials, a query string or a fragment.');
  }

  return parsed.toString().replace(/\/$/, '');
}

let apiBaseUrlConfigurationError: Error | undefined;

export const apiBaseUrl = (() => {
  try {
    return normaliseApiBaseUrl(import.meta.env.VITE_API_BASE_URL || fallbackApiBaseUrl);
  } catch (error) {
    apiBaseUrlConfigurationError = error instanceof Error ? error : new Error(String(error));
    // Never expose an unsafe configured value to fetch callers. Core API requests use
    // requireApiBaseUrl(), which surfaces the configuration error instead of falling back.
    return fallbackApiBaseUrl;
  }
})();

export function requireApiBaseUrl() {
  if (apiBaseUrlConfigurationError) throw apiBaseUrlConfigurationError;
  return apiBaseUrl;
}
