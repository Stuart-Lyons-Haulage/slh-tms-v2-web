import { jitteredDelay } from './visiblePolling';

function manualOnlyRoute(path: string) {
  return path.startsWith('/master-data')
    || path.startsWith('/drivers')
    || path.startsWith('/fleet-assets')
    || path.startsWith('/customers')
    || path.startsWith('/sites')
    || path.startsWith('/markets')
    || path.startsWith('/fuel')
    || path.startsWith('/reporting')
    || path.startsWith('/run-performance')
    || path.startsWith('/driver-assignments');
}

export function effectivePollingDelay(pathname: string, requestedMs: number) {
  const path = pathname.toLowerCase();
  if (manualOnlyRoute(path) && requestedMs >= 10_000) return 0;
  if (path === '/' && requestedMs === 20_000) return 30_000;
  if ((path.startsWith('/operations-wallboard') || path.startsWith('/live-runs') || path === '/tv') && requestedMs === 20_000) return 600_000;
  if (path.startsWith('/tracking') && requestedMs >= 10_000) return 300_000;
  if (path.startsWith('/warehouse') && requestedMs >= 10_000) return 120_000;
  if (path.startsWith('/communications') && requestedMs >= 10_000) return 120_000;
  if (path.startsWith('/staging') && requestedMs >= 10_000) return 60_000;
  if (path.startsWith('/driver-dispatch') && requestedMs >= 10_000) return 60_000;
  if (path.startsWith('/dashboard') && requestedMs >= 10_000) return 60_000;
  if ((path.startsWith('/attention') || path.startsWith('/exceptions')) && requestedMs >= 10_000) return 60_000;
  if ((path.startsWith('/compliance') || path.startsWith('/night-outs')) && requestedMs >= 10_000) return 900_000;
  if ((path.startsWith('/control-centre') || path.startsWith('/operations-control') || path.startsWith('/admin')) && requestedMs >= 10_000) return 600_000;
  return requestedMs;
}

type ManagedInterval = {
  handler: TimerHandler;
  args: unknown[];
  delayMs: number;
  timerId?: number;
  active: boolean;
};

export function installPollingPolicy() {
  if (typeof window === 'undefined') return;
  const marker = window as Window & { __SLH_POLLING_POLICY__?: boolean };
  if (marker.__SLH_POLLING_POLICY__) return;
  marker.__SLH_POLLING_POLICY__ = true;

  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const managed = new Map<number, ManagedInterval>();
  let nextManagedId = -1;
  let lastResumeAt = 0;

  const invoke = (entry: ManagedInterval) => {
    if (!entry.active || entry.delayMs <= 0 || document.visibilityState !== 'visible') return;
    if (typeof entry.handler === 'function') {
      const callback = entry.handler as (...values: unknown[]) => void;
      callback(...entry.args);
    } else {
      nativeSetTimeout(entry.handler, 0, ...entry.args);
    }
  };

  const schedule = (id: number) => {
    const entry = managed.get(id);
    if (!entry?.active || entry.delayMs <= 0 || document.visibilityState !== 'visible') return;
    if (entry.timerId !== undefined) nativeClearTimeout(entry.timerId);
    entry.timerId = nativeSetTimeout(() => {
      entry.timerId = undefined;
      invoke(entry);
      schedule(id);
    }, jitteredDelay(entry.delayMs));
  };

  const suspendAll = () => {
    for (const entry of managed.values()) {
      if (entry.timerId !== undefined) nativeClearTimeout(entry.timerId);
      entry.timerId = undefined;
    }
  };

  const resumeAll = () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastResumeAt < 750) return;
    lastResumeAt = now;
    for (const [id, entry] of managed) {
      if (entry.delayMs <= 0) continue;
      invoke(entry);
      schedule(id);
    }
  };

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const requested = Number(timeout || 0);
    if (requested < 10_000) return nativeSetInterval(handler, timeout, ...args);
    const id = nextManagedId--;
    managed.set(id, {
      handler,
      args,
      delayMs: effectivePollingDelay(window.location.pathname, requested),
      active: true,
    });
    schedule(id);
    return id;
  }) as typeof window.setInterval;

  window.clearInterval = ((id?: number) => {
    if (typeof id === 'number') {
      const entry = managed.get(id);
      if (entry) {
        entry.active = false;
        if (entry.timerId !== undefined) nativeClearTimeout(entry.timerId);
        managed.delete(id);
        return;
      }
    }
    nativeClearInterval(id);
  }) as typeof window.clearInterval;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeAll();
    else suspendAll();
  });
  window.addEventListener('focus', resumeAll);
}
