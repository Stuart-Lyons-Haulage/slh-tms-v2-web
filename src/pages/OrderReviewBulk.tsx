import { useCallback, useEffect, useMemo, useState } from "react";
import { api, request, type StagedImport } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import { useApi } from "../lib/useApi";
import { matchesPlanningDate } from "../lib/orderReviewDates";
import { SourceEmailEvidenceDrawer } from "../components/SourceEmailEvidenceDrawer";
import { resolveSourceEvidence } from "../sourceEvidence";
import "../order-control.css";

type RouteAlternative = {
  id?: string;
  score?: number;
  customerCode?: string;
  originSiteCode?: string;
  originSiteName?: string;
  retailerCode?: string;
  destinationSiteCode?: string;
  destinationCode?: string;
  destinationName?: string;
  destinationPostcode?: string;
};

type Payload = Record<string, unknown> & {
  poNumber?: string;
  customerPo?: string;
  customerRef?: string;
  poRef?: string;
  productPo?: string;
  cratePo?: string;
  transportPo?: string;
  customerCode?: string;
  collectionDate?: string;
  deliveryDate?: string;
  pallets?: number | string;
  sellerName?: string;
  stallNumber?: string;
  requestedTime?: string;
  overnightRoute?: boolean;
  wave?: number | string;
  routeTiming?: string;
  jobType?: string;
  driverInstructions?: string;
  plannerReady?: boolean;
  intakeStatus?: string;
  intakeConfidence?: string;
  intakeWarnings?: string[];
  intakeParser?: string;
  sourceSubject?: string;
  sourceWebLink?: string;
  sourceAttachmentName?: string;
  orderIntakeRouteRuleId?: string;
  orderIntakeRouteConfidenceScore?: number;
  orderIntakeRouteMatchedDimensions?: number;
  orderIntakeRouteRequiresReview?: boolean;
  orderIntakeRouteExplanation?: string[];
  orderIntakeRouteAlternatives?: RouteAlternative[];
};

type ParsedRow = {
  item: StagedImport;
  payload: Payload;
  parseError?: string;
};

type StagingQueuePage = {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  records: StagedImport[];
};

type BulkApproveResponse = {
  date: string;
  requested: number;
  approved: number;
  skipped: number;
  failed: number;
  missing: number;
  message: string;
};

type AmendmentChange = {
  field: string;
  from: string;
  to: string;
};

type ApprovalComparison = {
  classification: "New order" | "Amendment/update" | "Exact duplicate" | string;
  reference?: string;
  liveOrderId?: string;
  changes?: AmendmentChange[];
};

const text = (value: unknown) => String(value ?? "").trim();
const numberText = (value: unknown) => value == null || value === "" ? "" : String(value);
const queuePageSize = 100;

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function parse(item: StagedImport): ParsedRow {
  try {
    const payload = JSON.parse(item.payloadJson || "{}") as Payload;
    return { item, payload };
  } catch (error) {
    return {
      item,
      payload: {},
      parseError: error instanceof Error ? error.message : "Invalid staged JSON",
    };
  }
}

function palletCount(payload: Payload) {
  const value = Number(payload.pallets ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function isBackhaul(payload: Payload) {
  const normal = text(payload.jobType).toLowerCase().replace(/[^a-z0-9]/g, "");
  return normal.includes("backhaul") || normal.includes("backload");
}

function isPalletQuantityWarning(value: string) {
  const lower = value.toLowerCase();
  if (!lower.includes("pallet")) return false;
  return lower.includes("missing")
    || lower.includes("zero")
    || lower.includes("not supplied")
    || lower.includes("not provided")
    || lower.includes("not given")
    || lower.includes("blank")
    || lower.includes("quantity is not");
}

function warnings(payload: Payload) {
  return Array.isArray(payload.intakeWarnings) ? payload.intakeWarnings.map(text).filter(Boolean) : [];
}

function isPoReferenceWarning(value: string) {
  const lower = value.toLowerCase();
  return lower.includes("po") && (lower.includes("missing") || lower.includes("blank") || lower.includes("not found") || lower.includes("no customer"));
}

function driverReference(payload: Payload) {
  return text(payload.customerPo)
    || text(payload.poRef)
    || text(payload.customerRef)
    || text(payload.productPo)
    || text(payload.cratePo)
    || text(payload.transportPo);
}

function needsDriverReference(payload: Payload) {
  const haystack = [payload.jobType, payload.driverInstructions, payload.sourceSubject]
    .map((value) => text(value).toLowerCase())
    .join(" ");
  return /\b(crate|crates|tray|trays|trolley|trolleys)\b/.test(haystack);
}

function isPmOvernightCarryIn(payload: Payload, planningDate: string) {
  if (text(payload.deliveryDate) !== planningDate || !text(payload.collectionDate)) return false;

  if (payload.overnightRoute === true) return true;

  const collection = new Date(`${text(payload.collectionDate)}T12:00:00`);
  collection.setDate(collection.getDate() + 1);
  if (dateKey(collection) !== planningDate) return false;

  const time = text(payload.requestedTime).toLowerCase();
  const match = time.match(/(?:^|\s)(\d{1,2})(?::(\d{2}))?\s*(pm)?(?:\s|$)/);
  if (!match) return false;

  const rawHour = Number(match[1]);
  const isPm = Boolean(match[3]);
  const hour = isPm && rawHour < 12 ? rawHour + 12 : rawHour;
  return hour >= 12;
}

function reviewWarnings(payload: Payload) {
  const sourceWarnings = warnings(payload).filter((warning) =>
    !isPoReferenceWarning(warning) && !(isBackhaul(payload) && isPalletQuantityWarning(warning)));
  if (needsDriverReference(payload) && !driverReference(payload)) {
    return ["Tray/crate reference is missing for the driver text.", ...sourceWarnings];
  }
  return sourceWarnings;
}

function blockingReason(row: ParsedRow, date: string) {
  if (row.parseError) return "Payload cannot be read";
  const payload = row.payload;
  if (text(payload.collectionDate) !== date && !isPmOvernightCarryIn(payload, date)) return "Collection date does not match the selected planning date";
  if (!text(payload.poNumber)) return "TMS reference is missing";
  if (!text(payload.customerCode)) return "Customer is missing";
  if (!isBackhaul(payload) && palletCount(payload) <= 0) return "Zero or missing pallets";
  if (payload.plannerReady === false && !payload.orderIntakeRouteRequiresReview) return "Pre-order / not planner-ready";
  if (text(payload.intakeStatus).toLowerCase() === "preorder") return "Pre-order awaiting instruction";
  return undefined;
}

function reviewFlagReason(row: ParsedRow) {
  const payload = row.payload;
  const sourceWarnings = reviewWarnings(payload);
  if (sourceWarnings.length) return sourceWarnings[0];
  if (payload.orderIntakeRouteRequiresReview) return "Route match needs planner review";
  const confidence = text(payload.intakeConfidence);
  if (confidence && confidence.toLowerCase() !== "high" && warnings(payload).length > 0 && sourceWarnings.length === 0) return undefined;
  if (!confidence || confidence.toLowerCase() !== "high") return confidence ? `${confidence} confidence — check source` : "Source confidence not set — check source";
  return undefined;
}

function displayReference(payload: Payload) {
  return text(payload.customerPo) || text(payload.poNumber) || "Reference missing";
}

function routeAlternativeLabel(value: RouteAlternative) {
  const origin = text(value.originSiteCode) || text(value.originSiteName) || "origin not specified";
  const destination = text(value.destinationCode) || text(value.destinationSiteCode) || text(value.destinationName) || text(value.destinationPostcode) || "destination not specified";
  const retailer = text(value.retailerCode);
  return `${origin} → ${destination}${retailer ? ` · ${retailer}` : ""}`;
}

function amendmentPrompt(items: Array<{ row: ParsedRow; comparison: ApprovalComparison }>) {
  const sections = items.map(({ row, comparison }) => {
    const reference = comparison.reference || displayReference(row.payload);
    const changes = (comparison.changes || []).map((change) => `• ${change.field}: ${change.from || "—"} → ${change.to || "—"}`);
    return [`Approve amendment for ${reference}?`, ...changes].join("\n");
  });
  return `${sections.join("\n\n")}\n\nOK = approve the amendment. Cancel = keep the existing live order unchanged.`;
}

export function OrderReviewBulk({ date }: { date: string }) {
  const token = useAccessToken();
  const [queuePage, setQueuePage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<Payload>();
  const [sourceEmailStagingId, setSourceEmailStagingId] = useState<string>();

  const queue = useApi(useCallback(async () =>
    request<StagingQueuePage>(
      `/api/v1/staging/queue?status=PendingReview&entityType=order&page=${queuePage}&pageSize=${queuePageSize}&planningDate=${encodeURIComponent(date)}`,
      await token(),
    ), [date, queuePage, token]));

  const rows = useMemo(() => (queue.data?.records || []).map(parse), [queue.data]);
  const datedRows = useMemo(() => rows.filter((row) => matchesPlanningDate(row.payload, date)), [date, rows]);
  const selectableRows = useMemo(() => datedRows.filter((row) => !blockingReason(row, date)), [date, datedRows]);
  const cleanRows = useMemo(() => selectableRows.filter((row) => !reviewFlagReason(row)), [selectableRows]);
  const flaggedRows = useMemo(() => selectableRows.filter((row) => Boolean(reviewFlagReason(row))), [selectableRows]);
  const blockedRows = datedRows.length - selectableRows.length;
  const selectableIds = useMemo(() => new Set(selectableRows.map((row) => row.item.id)), [selectableRows]);
  const selectedRows = useMemo(() => selectableRows.filter((row) => selectedIds.has(row.item.id)), [selectableRows, selectedIds]);
  const selectedPallets = selectedRows.reduce((sum, row) => sum + palletCount(row.payload), 0);
  const allCleanSelected = cleanRows.length > 0 && cleanRows.every((row) => selectedIds.has(row.item.id));

  useEffect(() => {
    setQueuePage(1);
    setSelectedIds(new Set());
    setEditingId(undefined);
    setDraft(undefined);
    setSourceEmailStagingId(undefined);
  }, [date]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => selectableIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [selectableIds]);

  function changeQueuePage(nextPage: number) {
    if (nextPage < 1 || busy || busyId) return;
    setQueuePage(nextPage);
    setSelectedIds(new Set());
    setEditingId(undefined);
    setDraft(undefined);
    setSourceEmailStagingId(undefined);
  }

  function toggleRow(id: string) {
    if (!selectableIds.has(id) || busy || busyId) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllClean() {
    if (busy || busyId) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allCleanSelected) cleanRows.forEach((row) => next.delete(row.item.id));
      else cleanRows.forEach((row) => next.add(row.item.id));
      return next;
    });
  }

  async function beginEdit(row: ParsedRow) {
    setBusyId(row.item.id);
    setNotice(undefined);
    try {
      const detail = await request<StagedImport>(`/api/v1/staging/${row.item.id}`, await token());
      const parsedDetail = parse(detail);
      if (parsedDetail.parseError) throw new Error("The complete staged order could not be read.");
      setEditingId(row.item.id);
      setDraft(parsedDetail.payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The complete staged order could not be loaded for editing.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function saveEdit(row: ParsedRow) {
    if (!draft) return;
    setBusyId(row.item.id);
    setNotice(undefined);
    try {
      const next: Payload = {
        ...row.payload,
        ...draft,
        pallets: numberText(draft.pallets) === "" ? undefined : Number(draft.pallets),
      };
      await request<StagedImport>(`/api/v1/staging/${row.item.id}/payload`, await token(), {
        method: "PUT",
        body: JSON.stringify({ payload: next, note: "Corrected directly in Order Control before approval." }),
      });
      setEditingId(undefined);
      setDraft(undefined);
      await queue.refresh();
      setNotice(`${displayReference(next)} updated and kept waiting for approval.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The staged order could not be saved.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function rejectRow(row: ParsedRow) {
    setBusyId(row.item.id);
    setNotice(undefined);
    try {
      await api.review(row.item.id, false, "Rejected from Order Control before planning.", await token());
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(row.item.id);
        return next;
      });
      if (editingId === row.item.id) {
        setEditingId(undefined);
        setDraft(undefined);
      }
      if (sourceEmailStagingId === row.item.id) setSourceEmailStagingId(undefined);
      await queue.refresh();
      setNotice(`${displayReference(row.payload)} rejected. The source evidence remains in the audit history.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The order could not be rejected.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function approveSelectedOrders() {
    if (!selectedRows.length || busy || busyId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const approvalChecks = await Promise.all(selectedRows.map(async (row) => ({
        row,
        comparison: await request<ApprovalComparison>(
          `/api/v1/order-intake/duplicate-check/staging/${encodeURIComponent(row.item.id)}/comparison`,
          await token(),
        ),
      })));

      const duplicates = approvalChecks.filter(({ comparison }) => comparison.classification === "Exact duplicate");
      const amendments = approvalChecks.filter(({ comparison }) => comparison.classification === "Amendment/update");
      const approvable = approvalChecks.filter(({ comparison }) => comparison.classification !== "Exact duplicate");

      if (amendments.length > 0 && !window.confirm(amendmentPrompt(amendments))) {
        setNotice("Amendment approval cancelled. The existing live order has not been changed. You can review the source email before deciding.");
        return;
      }

      if (approvable.length === 0) {
        setSelectedIds(new Set());
        setNotice(`${duplicates.length} selected order${duplicates.length === 1 ? " is" : "s are"} already received with no changes to apply.`);
        return;
      }

      const result = await request<BulkApproveResponse>(
        "/api/v1/staging/orders/bulk-approve",
        await token(),
        {
          method: "POST",
          body: JSON.stringify({
            date,
            ids: approvable.map(({ row }) => row.item.id),
            acknowledgeReviewFlags: true,
          }),
        },
        120000,
      );
      const duplicateNote = duplicates.length > 0
        ? ` ${duplicates.length} exact duplicate${duplicates.length === 1 ? " was" : "s were"} left unchanged because there were no differences to apply.`
        : "";
      setNotice(`${result.message}${result.skipped || result.failed ? ` ${result.skipped} skipped and ${result.failed} failed remain for review.` : ""}${duplicateNote}`);
      setSelectedIds(new Set());
      setEditingId(undefined);
      setDraft(undefined);
      setSourceEmailStagingId(undefined);
      await queue.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Selected approval failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel order-selection-panel">
    <div className="review-metrics" style={{ marginTop: 2 }}>
      <article><span>Waiting</span><strong>{datedRows.length}</strong><small>Pending on {date}</small></article>
      <article><span>Clean</span><strong>{cleanRows.length}</strong><small>Can be selected together</small></article>
      <article className={flaggedRows.length ? "attention" : ""}><span>Check then approve</span><strong>{flaggedRows.length}</strong><small>Individually selectable after review</small></article>
      {blockedRows > 0 && <article className="attention"><span>Blocked</span><strong>{blockedRows}</strong><small>Must be corrected first</small></article>}
    </div>

    {notice && <p className="notice inline-notice">{notice}</p>}
    {queue.error && <p className="review-error">{queue.error}</p>}

    {queue.data && queue.data.total > queue.data.pageSize && <div className="order-date-history-controls" aria-label="Order review queue pages">
      <button type="button" onClick={() => changeQueuePage(queuePage - 1)} disabled={queuePage <= 1 || busy || Boolean(busyId)}>Previous 100</button>
      <small>Queue page {queue.data.page} · showing {((queue.data.page - 1) * queue.data.pageSize) + 1}–{Math.min(queue.data.page * queue.data.pageSize, queue.data.total)} of {queue.data.total} for {date}</small>
      <button type="button" onClick={() => changeQueuePage(queuePage + 1)} disabled={!queue.data.hasMore || busy || Boolean(busyId)}>Next 100</button>
    </div>}

    <div className="bulk-selection-toolbar">
      <label className="bulk-select-all">
        <input type="checkbox" checked={allCleanSelected} onChange={toggleAllClean} disabled={busy || Boolean(busyId) || cleanRows.length === 0} />
        <span>{allCleanSelected ? "All clean orders selected" : `Select all ${cleanRows.length} clean orders`}</span>
      </label>
      <span className="bulk-selection-count"><strong>{selectedRows.length}</strong> selected · {selectedPallets} pallets</span>
      <button onClick={() => setSelectedIds(new Set())} disabled={busy || Boolean(busyId) || selectedRows.length === 0}>Clear selection</button>
      <button className="primary" onClick={() => void approveSelectedOrders()} disabled={busy || Boolean(busyId) || selectedRows.length === 0}>
        {busy ? "Checking changes…" : `Approve selected (${selectedRows.length})`}
      </button>
    </div>

    {flaggedRows.length > 0 && <p className="order-review-explainer">The {flaggedRows.length} amber jobs are <strong>not locked</strong>. Use Review source email to compare the booking with the original message, then Edit if a field needs correcting. They are deliberately excluded from “Select all clean”.</p>}

    {queue.loading && !queue.data && <div className="state">Loading orders waiting for approval…</div>}
    {!queue.loading && datedRows.length === 0 && <div className="state">No orders are waiting for approval for this planning date.</div>}

    {datedRows.length > 0 && <div className="bulk-order-list" role="list" aria-label="Orders waiting for approval">
      {datedRows.map((row) => {
        const blocked = blockingReason(row, date);
        const reviewFlag = !blocked ? reviewFlagReason(row) : undefined;
        const selectable = !blocked;
        const selected = selectedIds.has(row.item.id);
        const isEditing = editingId === row.item.id;
        const rowBusy = busyId === row.item.id;
        const sourceWarnings = reviewWarnings(row.payload);
        const payload = isEditing && draft ? draft : row.payload;
        const sourceEvidence = resolveSourceEvidence(row.payload);
        const sourceLink = sourceEvidence.webLink;
        const hasSourceIdentity = Boolean(sourceEvidence.messageId || sourceEvidence.internetMessageId || sourceLink);
        const statusClass = blocked ? "blocked" : reviewFlag ? "review" : "ready";
        const statusText = blocked ? blocked : reviewFlag ? `Check: ${reviewFlag}` : "Ready to approve";
        const routeScore = row.payload.orderIntakeRouteConfidenceScore;
        const routeExplanation = Array.isArray(row.payload.orderIntakeRouteExplanation) ? row.payload.orderIntakeRouteExplanation : [];
        const routeAlternatives = Array.isArray(row.payload.orderIntakeRouteAlternatives) ? row.payload.orderIntakeRouteAlternatives : [];
        const hasRouteEvidence = Boolean(row.payload.orderIntakeRouteRuleId || routeScore != null || routeExplanation.length || routeAlternatives.length);

        return <article className={`bulk-order-row ${selectable ? "selectable" : "held"} ${selected ? "selected" : ""} ${isEditing ? "editing" : ""}`} key={row.item.id} role="listitem">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleRow(row.item.id)}
            disabled={!selectable || busy || Boolean(busyId)}
            aria-label={`Select ${displayReference(row.payload)}`}
          />
          <span className="bulk-order-ref"><strong>{displayReference(row.payload)}</strong><small>{text(row.payload.poNumber) || "TMS reference missing"}</small></span>
          <span><strong>{text(row.payload.customerCode) || "Customer missing"}</strong><small>{text(row.payload.sellerName) || "Collection site missing"} → {text(row.payload.stallNumber) || "Destination missing"}</small></span>
          <span className="bulk-order-pallets"><strong>{isBackhaul(row.payload) && palletCount(row.payload) <= 0 ? "—" : palletCount(row.payload)}</strong><small>{isBackhaul(row.payload) && palletCount(row.payload) <= 0 ? "backhaul" : "pallets"}</small></span>
          <span className={`bulk-order-status ${statusClass}`}>{statusText}</span>
          <div className="bulk-order-actions">
            {hasSourceIdentity && <button type="button" className="source-email-review-button" onClick={() => setSourceEmailStagingId(row.item.id)} disabled={busy || Boolean(busyId)}>Review source email</button>}
            {!isEditing && <button type="button" onClick={() => void beginEdit(row)} disabled={busy || Boolean(busyId)}>{rowBusy ? "Loading…" : "Edit"}</button>}
            {isEditing && <>
              <button type="button" onClick={() => { setEditingId(undefined); setDraft(undefined); }} disabled={rowBusy}>Cancel</button>
              <button type="button" className="primary" onClick={() => void saveEdit(row)} disabled={rowBusy}>{rowBusy ? "Saving…" : "Save"}</button>
            </>}
            <button type="button" className="reject-button" onClick={() => void rejectRow(row)} disabled={busy || Boolean(busyId)}>{rowBusy ? "Working…" : "Reject"}</button>
          </div>

          {(reviewFlag || sourceWarnings.length > 0) && !isEditing && <div className="bulk-row-warning">
            <strong>{reviewFlag ? "Why this needs checking" : "Source warning"}</strong>
            {sourceWarnings.length > 0 ? sourceWarnings.map((warning, index) => <span key={`${row.item.id}-warning-${index}`}>{warning}</span>) : <span>{reviewFlag}</span>}
            {hasSourceIdentity && <button type="button" className="source-email-review-button" onClick={() => setSourceEmailStagingId(row.item.id)}>Review source email</button>}
          </div>}

          {hasRouteEvidence && <div className={`bulk-row-warning ${row.payload.orderIntakeRouteRequiresReview ? "attention" : ""}`}>
            <strong>SQL route match {routeScore != null ? `· ${routeScore}% confidence` : ""}</strong>
            <span>{row.payload.orderIntakeRouteMatchedDimensions != null ? `${row.payload.orderIntakeRouteMatchedDimensions} route dimensions matched. ` : ""}{row.payload.orderIntakeRouteRequiresReview ? "Planner confirmation is required before approval." : "The best rule supplied missing route values only."}</span>
            {routeExplanation.map((explanation, index) => <span key={`${row.item.id}-route-explanation-${index}`}>{explanation}</span>)}
            {routeAlternatives.length > 1 && <span><strong>Alternatives:</strong> {routeAlternatives.slice(0, 3).map((alternative) => `${routeAlternativeLabel(alternative)}${alternative.score != null ? ` (${alternative.score}%)` : ""}`).join(" · ")}</span>}
          </div>}

          {isEditing && <div className="bulk-order-editor">
            <div className="bulk-editor-grid">
              <label>Customer<input value={text(payload.customerCode)} onChange={(event) => setDraft((current) => ({ ...(current || payload), customerCode: event.target.value }))} /></label>
              <label>Customer PO / ref<input value={text(payload.customerPo)} onChange={(event) => setDraft((current) => ({ ...(current || payload), customerPo: event.target.value }))} /></label>
              <label>TMS order reference<input value={text(payload.poNumber)} onChange={(event) => setDraft((current) => ({ ...(current || payload), poNumber: event.target.value }))} /></label>
              <label>Collection date<input type="date" value={text(payload.collectionDate)} onChange={(event) => setDraft((current) => ({ ...(current || payload), collectionDate: event.target.value }))} /></label>
              <label>Delivery date<input type="date" value={text(payload.deliveryDate)} onChange={(event) => setDraft((current) => ({ ...(current || payload), deliveryDate: event.target.value }))} /></label>
              <label>Pallets<input type="number" min="0" value={numberText(payload.pallets)} onChange={(event) => setDraft((current) => ({ ...(current || payload), pallets: event.target.value }))} /></label>
              <label>Collection site<input value={text(payload.sellerName)} onChange={(event) => setDraft((current) => ({ ...(current || payload), sellerName: event.target.value }))} /></label>
              <label>Destination<input value={text(payload.stallNumber)} onChange={(event) => setDraft((current) => ({ ...(current || payload), stallNumber: event.target.value }))} /></label>
              <label>Requested time<input value={text(payload.requestedTime)} onChange={(event) => setDraft((current) => ({ ...(current || payload), requestedTime: event.target.value }))} /></label>
              <label className="checkbox-field"><span>Overnight route</span><input type="checkbox" checked={payload.overnightRoute === true} onChange={(event) => setDraft((current) => ({ ...(current || payload), overnightRoute: event.target.checked, routeTiming: event.target.checked ? "Overnight" : "SameDay", requestedTime: event.target.checked ? (text(payload.requestedTime) || "17:00") : payload.requestedTime }))} /></label>
              <label>Job type<input value={text(payload.jobType)} onChange={(event) => setDraft((current) => ({ ...(current || payload), jobType: event.target.value }))} /></label>
            </div>
            <label className="bulk-editor-notes">Driver / planner notes<textarea rows={3} value={text(payload.driverInstructions)} onChange={(event) => setDraft((current) => ({ ...(current || payload), driverInstructions: event.target.value }))} /></label>
            <div className="bulk-source-line">
              <span><strong>Source:</strong> {sourceEvidence.subject || row.item.source || "Order intake"}</span>
              {sourceEvidence.displayId && <span title={sourceEvidence.displayId}><strong>Email ID:</strong> {sourceEvidence.displayId}</span>}
              {row.payload.sourceAttachmentName && <span><strong>Attachment:</strong> {text(row.payload.sourceAttachmentName)}</span>}
              {row.payload.intakeParser && <span><strong>Parser:</strong> {text(row.payload.intakeParser)}</span>}
              {hasSourceIdentity && <button type="button" onClick={() => setSourceEmailStagingId(row.item.id)}>Review source email</button>}
              {sourceLink && <a href={sourceLink} target="_blank" rel="noreferrer">Open retained snapshot ↗</a>}
            </div>
          </div>}
        </article>;
      })}
    </div>}

    {sourceEmailStagingId && <SourceEmailEvidenceDrawer stagingId={sourceEmailStagingId} onClose={() => setSourceEmailStagingId(undefined)} />}
  </section>;
}
