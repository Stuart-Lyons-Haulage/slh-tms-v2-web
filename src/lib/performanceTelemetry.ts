type TelemetryClient = {
  trackEvent?: (event: { name: string }, properties?: Record<string, string>, measurements?: Record<string, number>) => void;
  trackException?: (exception: { exception: Error }, properties?: Record<string, string>) => void;
};

declare global {
  interface Window {
    appInsights?: TelemetryClient;
  }
}

function track(name: string, properties: Record<string, string> = {}, measurements: Record<string, number> = {}) {
  window.appInsights?.trackEvent?.({ name }, properties, measurements);
}

export function trackFrontendException(error: unknown, context = 'unknown') {
  const exception = error instanceof Error ? error : new Error(String(error));
  window.appInsights?.trackException?.({ exception }, { context, route: window.location.pathname });
}

export function trackApiRequest(path: string, method: string, durationMs: number, status: number, failed = false) {
  track(failed ? 'tms.api.failure' : 'tms.api.request', { endpoint: path, method, status: String(status) }, { durationMs });
}

function observeMetric(type: string, value: number) {
  track('tms.web.vital', { metric: type, route: window.location.pathname }, { value });
}

export function installPerformanceTelemetry() {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

  const observe = (entryType: string, callback: (entry: PerformanceEntry) => number) => {
    try {
      const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => observeMetric(entryType.toUpperCase(), callback(entry))));
      observer.observe({ type: entryType, buffered: true });
    } catch { /* Browser does not support this metric. */ }
  };

  observe('largest-contentful-paint', entry => entry.startTime);
  observe('first-input', entry => {
    const input = entry as PerformanceEventTiming;
    return input.processingStart - input.startTime;
  });
  let cumulativeLayoutShift = 0;
  try {
    const clsObserver = new PerformanceObserver(list => {
      cumulativeLayoutShift += list.getEntries().reduce((total, entry) => total + ((entry as PerformanceEntry & { value?: number }).value ?? 0), 0);
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
    const reportCls = () => {
      if (cumulativeLayoutShift > 0) observeMetric('CLS', cumulativeLayoutShift);
    };
    window.addEventListener('pagehide', reportCls, { once: true });
    window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reportCls(); }, { once: true });
  } catch { /* Browser does not support layout-shift. */ }

  let routeStarted = performance.now();
  const reportRoute = () => {
    track('tms.route.load', { route: window.location.pathname }, { durationMs: performance.now() - routeStarted });
    routeStarted = performance.now();
  };
  window.addEventListener('popstate', reportRoute);
  window.addEventListener('error', event => trackFrontendException(event.error || event.message, 'window.error'));
  window.addEventListener('unhandledrejection', event => trackFrontendException(event.reason, 'unhandledrejection'));
  track('tms.route.load', { route: window.location.pathname }, { durationMs: performance.now() });
}
