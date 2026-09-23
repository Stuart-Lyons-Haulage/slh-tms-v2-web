export function jitteredDelay(baseMs: number, ratio = 0.075) {
  const variance = baseMs * ratio;
  return Math.max(1000, Math.round(baseMs - variance + Math.random() * variance * 2));
}

export function startVisiblePolling(refresh: () => void | Promise<void>, baseMs: number, options: { focus?: boolean; visibility?: boolean } = {}) {
  let timer: number | undefined;
  let stopped = false;
  let refreshing = false;
  let lastResumeAt = Number.NEGATIVE_INFINITY;
  const focusEnabled = options.focus !== false;
  const visibilityEnabled = options.visibility !== false;

  const run = async () => {
    if (stopped || document.visibilityState !== 'visible' || refreshing) return;
    refreshing = true;
    try { await refresh(); } finally { refreshing = false; }
  };

  const schedule = () => {
    if (stopped) return;
    if (timer) window.clearTimeout(timer);
    timer = undefined;
    if (document.visibilityState !== 'visible') return;
    timer = window.setTimeout(async () => {
      timer = undefined;
      await run();
      schedule();
    }, jitteredDelay(baseMs));
  };

  const resume = () => {
    if (document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastResumeAt < 750) return;
    lastResumeAt = now;
    void run();
    schedule();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') resume();
    else if (timer) { window.clearTimeout(timer); timer = undefined; }
  };
  const onFocus = () => resume();

  schedule();
  if (visibilityEnabled) document.addEventListener('visibilitychange', onVisibility);
  if (focusEnabled) window.addEventListener('focus', onFocus);

  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
    if (visibilityEnabled) document.removeEventListener('visibilitychange', onVisibility);
    if (focusEnabled) window.removeEventListener('focus', onFocus);
  };
}