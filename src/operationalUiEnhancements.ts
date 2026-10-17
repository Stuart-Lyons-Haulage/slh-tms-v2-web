function cleanTitleLine(value: string) {
  return value.replace(/^\s*\d+\.\s*/, "").trim();
}

function compactRunNumber(value: string) {
  const match = value.match(/\b(?:RUN[-\s]*)?(\d{1,3})\b/i);
  return match?.[1] || value.trim();
}

function setTextIfChanged(element: HTMLElement | undefined | null, value: string) {
  if (!element || element.textContent === value) return;
  element.textContent = value;
}

function plannerPeriodFromCard(card: Element) {
  const selected = card.querySelector<HTMLButtonElement>(".run-period-selector button.selected");
  const value = selected?.textContent?.trim().toUpperCase();
  return value === "AM" || value === "PM" ? value : "";
}

function refreshPlannerRunLabels() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".simple-run-card"));
  cards.forEach((card, index) => {
    const strong = card.querySelector<HTMLElement>(".simple-run-header > div:first-child > strong");
    if (!strong) return;
    const period = plannerPeriodFromCard(card);
    setTextIfChanged(strong, `RUN ${index + 1}${period ? ` ${period}` : ""}`);
  });
}

function periodFromPlannerNotes(value?: string | null) {
  const match = String(value || "").match(/Planner\s*period\s*:\s*(AM|PM)/i);
  return match?.[1]?.toUpperCase() || "";
}

function refreshDispatchRunQueue() {
  const queue = document.querySelector<HTMLElement>('[data-testid="built-runs-queue"]');
  if (!queue) return;
  const cards = Array.from(queue.querySelectorAll<HTMLElement>(':scope > div:last-child > span[title]'));
  for (const card of cards) {
    const lines = (card.getAttribute("title") || "").split("\n").map(cleanTitleLine).filter(Boolean);
    if (!lines.length) continue;
    const strong = card.querySelector<HTMLElement>("strong");
    const details = card.querySelectorAll<HTMLElement>("small");
    if (strong) {
      const raw = strong.textContent || "";
      const period = periodFromPlannerNotes(card.getAttribute("data-planner-notes"));
      const existingPeriod = raw.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() || period;
      setTextIfChanged(strong, `RUN ${compactRunNumber(raw)}${existingPeriod ? ` ${existingPeriod}` : ""}`);
    }
    const routeSummary = lines.length === 1 ? lines[0] : `${lines[0]} → ${lines.at(-1)}`;
    setTextIfChanged(details[0], routeSummary);
  }
}

function refreshRunLabels() {
  refreshPlannerRunLabels();
  refreshDispatchRunQueue();
}

export function installOperationalUiEnhancements() {
  if (typeof document === "undefined") return;
  const marker = window as Window & { __SLH_OPERATIONAL_UI_ENHANCEMENTS__?: boolean };
  if (marker.__SLH_OPERATIONAL_UI_ENHANCEMENTS__) return;
  marker.__SLH_OPERATIONAL_UI_ENHANCEMENTS__ = true;

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>(".top-nav-menu a");
    if (link) link.closest<HTMLDetailsElement>("details")?.removeAttribute("open");

    if (target?.closest(".run-period-selector button")) window.setTimeout(refreshPlannerRunLabels, 0);
  });

  let refreshQueued = false;
  const queueRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      refreshRunLabels();
    });
  };

  const observer = new MutationObserver(queueRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.setTimeout(refreshRunLabels, 0);
}
