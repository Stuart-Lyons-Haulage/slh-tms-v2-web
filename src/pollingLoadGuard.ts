// Reduce unnecessary background polling across the TMS without affecting short UI timers.
// Operational polling should pause while a tab is hidden. The wallboard's cadence is left
// exactly as each screen requests it: the API and the on-screen footer both advertise a
// 20-second refresh, so the client must not silently poll at a different rate (previously
// this file rewrote every 20s wallboard timer to 60s, which meant the wallboard was three
// times slower than the "Refreshes every 20 seconds" text it was showing operators).

const nativeSetInterval = window.setInterval.bind(window);
const operationalPollThresholdMs = 15_000;

window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const requestedMs = Number(timeout ?? 0);

  if (typeof handler !== 'function' || requestedMs < operationalPollThresholdMs) {
    return nativeSetInterval(handler, requestedMs, ...args);
  }

  const guardedHandler = () => {
    // Hidden browser tabs do not need to keep hitting RoadTech, ETA, geofence or
    // intelligence endpoints. The next visible interval will refresh normally.
    if (document.visibilityState === 'hidden') return;
    handler(...args);
  };

  return nativeSetInterval(guardedHandler, requestedMs);
}) as typeof window.setInterval;
