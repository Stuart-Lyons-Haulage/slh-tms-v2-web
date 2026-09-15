type UnknownRecord = Record<string, unknown>;

const LIST_ENDPOINTS = [
  "/api/v1/staging",
  "/api/v1/operational-master-data/sites/search",
  "/api/v1/operational-master-data/geofences/search",
];

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normaliseListPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["items", "records", "results", "data", "value"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function isPagedStagingQueueRequest(url: string) {
  return url.includes("/api/v1/staging/queue");
}

export function shouldRewriteListPayload(url: string) {
  if (isPagedStagingQueueRequest(url)) return false;
  return LIST_ENDPOINTS.some((endpoint) => url.includes(endpoint));
}

function shouldInspectPayload(url: string) {
  return shouldRewriteListPayload(url) || isPagedStagingQueueRequest(url);
}

function reviewIdFromLocation() {
  if (window.location.pathname !== "/staging") return undefined;
  return new URLSearchParams(window.location.search).get("reviewId") || undefined;
}

let targetReview: UnknownRecord | undefined;
let targetLookupFinished = false;
let latestStagingRows: UnknownRecord[] = [];
let stagingApiBase = "";
let stagingRequestHeaders: Headers | undefined;

function captureTargetReview(rows: unknown[]) {
  latestStagingRows = rows.filter(isRecord);
  const reviewId = reviewIdFromLocation();
  if (!reviewId) return;
  targetLookupFinished = true;
  targetReview = latestStagingRows.find((row) => String(row.id ?? "") === reviewId);
}

function parsePayloadJson(row: UnknownRecord | undefined): UnknownRecord {
  if (!row) return {};
  const raw = row.payloadJson;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function targetNeedles(row: UnknownRecord | undefined) {
  const payload = parsePayloadJson(row);
  return [payload.poNumber, payload.customerPo, payload.sourceSubject, payload.sourceSender, payload.sourceSenderName, payload.sourceAttachmentName]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length >= 4);
}

function addMissingTargetNotice() {
  if (!reviewIdFromLocation() || targetReview || !targetLookupFinished) return;
  if (document.querySelector("[data-order-review-target-missing]")) return;
  const toolbar = document.querySelector(".review-toolbar");
  if (!toolbar?.parentElement) return;
  const notice = document.createElement("div");
  notice.dataset.orderReviewTargetMissing = "true";
  notice.className = "notice inline-notice";
  notice.textContent = "This review is no longer in the pending queue or could not be loaded. It may already have been accepted or rejected.";
  toolbar.parentElement.insertBefore(notice, toolbar.nextSibling);
}

function revealTargetReview() {
  const reviewId = reviewIdFromLocation();
  if (!reviewId) return;

  const showAll = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    .find((input) => input.parentElement?.textContent?.includes("Show all pending dates"));
  if (showAll && !showAll.checked) {
    showAll.click();
    return;
  }

  if (!targetReview) {
    addMissingTargetNotice();
    return;
  }

  const needles = targetNeedles(targetReview);
  if (!needles.length) return;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".order-review-card"));
  const target = cards
    .map((card) => ({ card, score: needles.filter((needle) => card.textContent?.includes(needle)).length }))
    .sort((left, right) => right.score - left.score)[0];
  if (!target || target.score === 0) return;

  if (target.card.dataset.reviewTarget !== reviewId) {
    target.card.dataset.reviewTarget = reviewId;
    target.card.style.outline = "3px solid #63d151";
    target.card.style.outlineOffset = "4px";
    target.card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function rowForSourceLink(link: string, card?: HTMLElement | null) {
  const exact = latestStagingRows.find((row) => {
    const payload = parsePayloadJson(row);
    return [payload.sourceWebLink, payload.sourceEmailWebLink].some((value) => stringValue(value) === link);
  });
  if (exact) return exact;
  if (!card) return undefined;
  return latestStagingRows
    .map((row) => ({ row, score: targetNeedles(row).filter((needle) => card.textContent?.includes(needle)).length }))
    .sort((left, right) => right.score - left.score)[0]?.row;
}

function closeSourcePopup() {
  document.querySelector("[data-source-email-popup]")?.remove();
}

function appendMeta(list: HTMLDListElement, label: string, value: unknown) {
  const text = stringValue(value);
  if (!text) return;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = text;
  list.append(dt, dd);
}

function openSourcePopupShell(title = "Source email") {
  closeSourcePopup();
  const scrim = document.createElement("div");
  scrim.className = "source-email-scrim";
  scrim.dataset.sourceEmailPopup = "true";
  const drawer = document.createElement("aside");
  drawer.className = "source-email-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  const header = document.createElement("header");
  const heading = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Order source evidence";
  const h2 = document.createElement("h2");
  h2.textContent = title;
  heading.append(eyebrow, h2);
  const close = document.createElement("button");
  close.className = "source-email-close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close source email");
  close.addEventListener("click", closeSourcePopup);
  header.append(heading, close);
  const body = document.createElement("div");
  body.className = "state";
  body.textContent = "Loading original email evidence…";
  drawer.append(header, body);
  scrim.append(drawer);
  scrim.addEventListener("mousedown", (event) => { if (event.target === scrim) closeSourcePopup(); });
  document.body.append(scrim);
  return { drawer, body, h2 };
}

async function openSourceEmail(row: UnknownRecord | undefined, originalFetch: typeof window.fetch) {
  const stagingId = stringValue(row?.id);
  const payload = parsePayloadJson(row);
  const popup = openSourcePopupShell(stringValue(payload.sourceSubject) || "Source email");
  if (!stagingId) {
    popup.body.className = "state error";
    popup.body.textContent = "The retained source email could not be matched to this review record.";
    return;
  }

  try {
    const response = await originalFetch(`${stagingApiBase}/api/v1/order-intake/source-email/${encodeURIComponent(stagingId)}`, {
      headers: stagingRequestHeaders ? new Headers(stagingRequestHeaders) : undefined,
    });
    if (!response.ok) throw new Error(`Source email request failed (${response.status}).`);
    const evidence = await response.json() as UnknownRecord;
    popup.h2.textContent = stringValue(evidence.subject) || stringValue(payload.sourceSubject) || "Source email";
    popup.body.remove();

    const meta = document.createElement("dl");
    meta.className = "source-email-meta";
    appendMeta(meta, "From", [stringValue(evidence.senderName), stringValue(evidence.senderAddress)].filter(Boolean).join(" · "));
    appendMeta(meta, "Received", evidence.receivedAtUtc);
    appendMeta(meta, "Mailbox", evidence.mailbox);
    appendMeta(meta, "Email ID", evidence.internetMessageId || evidence.messageId);
    popup.drawer.append(meta);

    const bodySection = document.createElement("section");
    bodySection.className = "source-email-body";
    const bodyHeading = document.createElement("div");
    bodyHeading.className = "source-email-section-heading";
    const bodyLabel = document.createElement("strong");
    bodyLabel.textContent = "Email body";
    bodyHeading.append(bodyLabel);
    const pre = document.createElement("pre");
    pre.textContent = stringValue(evidence.bodyText) || stringValue(payload.sourceBodyText) || "No retained email body is available for this message.";
    bodySection.append(bodyHeading, pre);
    popup.drawer.append(bodySection);

    const attachments = Array.isArray(evidence.attachments) ? evidence.attachments.filter(isRecord) : [];
    if (attachments.length) {
      const section = document.createElement("section");
      section.className = "source-email-attachments";
      const heading = document.createElement("div");
      heading.className = "source-email-section-heading";
      const strong = document.createElement("strong");
      strong.textContent = "Attachments";
      const count = document.createElement("span");
      count.textContent = String(attachments.length);
      heading.append(strong, count);
      const ul = document.createElement("ul");
      for (const attachment of attachments) {
        if (attachment.isInline === true) continue;
        const li = document.createElement("li");
        const name = document.createElement("strong");
        name.textContent = stringValue(attachment.name) || "Unnamed attachment";
        const type = document.createElement("span");
        type.textContent = stringValue(attachment.contentType);
        li.append(name, type);
        ul.append(li);
      }
      section.append(heading, ul);
      popup.drawer.append(section);
    }

    const footer = document.createElement("footer");
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", closeSourcePopup);
    footer.append(close);
    popup.drawer.append(footer);
  } catch (error) {
    popup.body.className = "state error";
    popup.body.textContent = error instanceof Error ? error.message : "The source email could not be loaded.";
  }
}

function captureStagingRequest(url: string, input: RequestInfo | URL, init?: RequestInit) {
  const marker = url.indexOf("/api/v1/staging");
  if (marker >= 0) stagingApiBase = url.slice(0, marker);
  if (input instanceof Request) stagingRequestHeaders = new Headers(input.headers);
  else if (init?.headers) stagingRequestHeaders = new Headers(init.headers);
}

export function installOrderReviewRecovery() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const marker = window as Window & { __SLH_ORDER_REVIEW_RECOVERY__?: boolean };
  if (marker.__SLH_ORDER_REVIEW_RECOVERY__) return;
  marker.__SLH_ORDER_REVIEW_RECOVERY__ = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const input = args[0];
    const init = args[1];
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (url.includes("/api/v1/staging")) captureStagingRequest(url, input, init);
    const response = await originalFetch(...args);
    if (!response.ok || !shouldInspectPayload(url)) return response;

    try {
      const payload = await response.clone().json();
      const rows = normaliseListPayload(payload);
      if (url.includes("/api/v1/staging")) captureTargetReview(rows);
      if (Array.isArray(payload) || !shouldRewriteListPayload(url)) return response;
      return new Response(JSON.stringify(rows), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };

  document.addEventListener("click", (event) => {
    if (window.location.pathname !== "/staging") return;
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(".source-evidence a") : null;
    if (!target) return;
    event.preventDefault();
    const row = rowForSourceLink(target.href, target.closest<HTMLElement>(".order-review-card"));
    void openSourceEmail(row, originalFetch);
  });

  const observer = new MutationObserver(() => revealTargetReview());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(revealTargetReview, 0);
}
