import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../source-email-evidence.css";

type Recipient = {
  address?: string;
  name?: string;
  emailAddress?: string | { address?: string; name?: string };
};

export type Attachment = {
  name?: string;
  contentType?: string;
  contentId?: string;
  size?: number;
  isInline?: boolean;
  contentBase64?: string;
  contentBytes?: string;
  sourceUrl?: string;
  retrievalError?: string;
};

export type SourceEmailEvidence = {
  messageId?: string;
  internetMessageId?: string;
  conversationId?: string;
  mailbox?: string;
  senderAddress?: string;
  senderName?: string;
  subject?: string;
  receivedAtUtc?: string;
  bodyText?: string;
  bodyHtml?: string;
  bodyFormat?: string;
  importance?: string;
  webLink?: string;
  toRecipients?: unknown;
  ccRecipients?: unknown;
  attachments?: unknown;
  bodyTruncated?: boolean;
  evidenceAvailable?: boolean;
};

type ExcelSheetPreview = {
  name: string;
  rows: string[][];
  truncated: boolean;
};

type PreviewState = {
  attachment: Attachment;
  href: string;
  mode: "pdf" | "text" | "excel" | "unsupported";
  text?: string;
  sheets?: ExcelSheetPreview[];
  activeSheetIndex?: number;
  error?: string;
};

const orderDocumentExtensions = new Set(["pdf", "csv", "xls", "xlsx", "xlsm"]);
const previewTextExtensions = new Set(["csv", "txt", "text"]);
const excelExtensions = new Set(["xls", "xlsx", "xlsm"]);
const imageContentTypes = ["image/", "application/octet-stream; image"];
const invalidDownloadNameChars = new Set(["\\", "/", ":", "*", "?", "\"", "<", ">", "|"]);
const excelPreviewRowLimit = 500;
const excelPreviewColumnLimit = 60;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normaliseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return normaliseArray<T>(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (typeof value === "object") return [value as T];
  return [];
}

function recipientText(recipient: Recipient) {
  if (typeof recipient.emailAddress === "object" && recipient.emailAddress) {
    const address = text(recipient.emailAddress.address);
    const name = text(recipient.emailAddress.name);
    return name && address ? `${name} <${address}>` : name || address;
  }
  const address = text(recipient.emailAddress) || text(recipient.address);
  const name = text(recipient.name);
  return name && address ? `${name} <${address}>` : name || address;
}

function recipientsText(items?: unknown) {
  return normaliseArray<Recipient>(items).map(recipientText).filter(Boolean).join(", ");
}

export function looksLikeHtmlBody(value: string) {
  return /<\s*(?:!doctype|html|body|div|p|table|tr|td|span|br|strong|a)(?:\s|>|\/)/i.test(value);
}

export function stripHtmlForDisplay(value: string) {
  const raw = text(value);
  if (!raw) return "";
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = raw;
    return (container.textContent || container.innerText || "").replace(/\s+/g, " ").trim();
  }
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function bodyAsText(source?: SourceEmailEvidence) {
  if (!source) return "";
  const retainedText = text(source.bodyText);
  if (retainedText) return looksLikeHtmlBody(retainedText) ? stripHtmlForDisplay(retainedText) : retainedText;
  const retainedHtml = text(source.bodyHtml);
  return retainedHtml ? stripHtmlForDisplay(retainedHtml) : "";
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(value?: number) {
  if (!value || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normaliseBase64(value?: string) {
  const raw = text(value);
  if (!raw) return "";
  const comma = raw.indexOf(",");
  if (comma >= 0 && raw.slice(0, comma).toLowerCase().includes("base64")) return raw.slice(comma + 1).trim();
  return raw;
}

function attachmentExtension(attachment: Attachment) {
  const name = text(attachment.name).toLowerCase();
  const match = name.match(/\.([a-z0-9]+)$/i);
  if (match) return match[1];
  const contentType = text(attachment.contentType).toLowerCase();
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("csv")) return "csv";
  if (contentType.includes("spreadsheet") || contentType.includes("excel")) return "xlsx";
  if (contentType.startsWith("text/")) return "txt";
  return "";
}

export function looksLikeInlineImage(attachment: Attachment) {
  const contentType = text(attachment.contentType).toLowerCase();
  const name = text(attachment.name).toLowerCase();
  if (attachment.isInline === true) return true;
  if (imageContentTypes.some((prefix) => contentType.startsWith(prefix))) return true;
  if (/\.(png|jpe?g|gif|bmp|webp|svg|ico)$/i.test(name)) return true;
  if (/\b(signature|logo|facebook|linkedin|twitter|instagram|image\d*|cid)\b/i.test(name)) return true;
  return false;
}

export function isOperationalAttachment(attachment: Attachment) {
  const extension = attachmentExtension(attachment);
  return !looksLikeInlineImage(attachment) && orderDocumentExtensions.has(extension);
}

function displayAttachmentName(attachment: Attachment, index: number, evidence?: SourceEmailEvidence) {
  const name = text(attachment.name);
  if (name) return name;
  const extension = attachmentExtension(attachment) || "bin";
  const ref = text(evidence?.subject).match(/\b[A-Z]{2,}[A-Z0-9/-]{3,}\b/i)?.[0]
    || text(evidence?.messageId).replace(/[^a-z0-9]+/gi, "").slice(-12)
    || "source-email";
  return `${ref}_attachment_${index + 1}.${extension}`;
}

function safeDownloadName(name?: string) {
  const cleaned = Array.from(text(name))
    .map((char) => invalidDownloadNameChars.has(char) || char.charCodeAt(0) < 32 ? "_" : char)
    .join("")
    .trim();
  return cleaned || "source-email-attachment";
}

function attachmentCopyHref(attachment: Attachment) {
  const base64 = normaliseBase64(attachment.contentBase64 || attachment.contentBytes);
  if (!base64) return "";
  const contentType = text(attachment.contentType) || "application/octet-stream";
  return `data:${contentType};base64,${base64}`;
}

function decodeBase64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeBase64Text(value: string) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(decodeBase64Bytes(value));
  } catch {
    return "This attachment copy could not be decoded for preview. Use Download copy instead.";
  }
}

export function previewMode(attachment: Attachment): PreviewState["mode"] {
  const extension = attachmentExtension(attachment);
  const contentType = text(attachment.contentType).toLowerCase();
  if (extension === "pdf" || contentType.includes("pdf")) return "pdf";
  if (excelExtensions.has(extension)) return "excel";
  if (previewTextExtensions.has(extension) || contentType.startsWith("text/") || contentType.includes("csv")) return "text";
  return "unsupported";
}

export function buildExcelPreview(base64: string): ExcelSheetPreview[] {
  const bytes = decodeBase64Bytes(base64);
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
  });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    const truncated = rawRows.length > excelPreviewRowLimit || rawRows.some((row) => row.length > excelPreviewColumnLimit);
    const rows = rawRows
      .slice(0, excelPreviewRowLimit)
      .map((row) => row.slice(0, excelPreviewColumnLimit).map((value) => text(value)));
    return { name, rows, truncated };
  });
}

export function SourceEmailEvidenceDrawer({ stagingId, onClose }: { stagingId: string; onClose: () => void }) {
  const token = useAccessToken();
  const [evidence, setEvidence] = useState<SourceEmailEvidence>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewState>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setEvidence(undefined);
    setPreview(undefined);
    void (async () => {
      try {
        const result = await request<SourceEmailEvidence>(`/api/v1/order-intake/source-email/${encodeURIComponent(stagingId)}`, await token());
        if (active) setEvidence(result);
      } catch {
        if (active) setError("Source email unavailable in the TMS. The retained message could not be retrieved for this load.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [stagingId, token]);

  const body = bodyAsText(evidence);
  const allAttachments = normaliseArray<Attachment>(evidence?.attachments);
  const attachments = useMemo(() => normaliseArray<Attachment>(evidence?.attachments).filter(isOperationalAttachment), [evidence?.attachments]);
  const hiddenAttachmentCount = Math.max(0, allAttachments.length - attachments.length);

  function openPreview(attachment: Attachment) {
    const base64 = normaliseBase64(attachment.contentBase64 || attachment.contentBytes);
    const href = attachmentCopyHref(attachment);
    if (!base64 || !href) return;
    const mode = previewMode(attachment);
    if (mode === "excel") {
      try {
        setPreview({ attachment, href, mode, sheets: buildExcelPreview(base64), activeSheetIndex: 0 });
      } catch {
        setPreview({ attachment, href, mode, sheets: [], activeSheetIndex: 0, error: "This Excel attachment could not be rendered in the browser. Download the retained copy and open it in Excel." });
      }
      return;
    }
    setPreview({
      attachment,
      href,
      mode,
      text: mode === "text" ? decodeBase64Text(base64) : undefined,
    });
  }

  const activeExcelSheet = preview?.mode === "excel" && preview.sheets?.length
    ? preview.sheets[Math.min(preview.activeSheetIndex ?? 0, preview.sheets.length - 1)]
    : undefined;

  return <div className="source-email-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="source-email-drawer" role="dialog" aria-modal="true" aria-label="Source email evidence">
      <header>
        <div><p className="eyebrow">Order source evidence</p><h2>{evidence?.subject || "Source email"}</h2></div>
        <button type="button" className="source-email-close" onClick={onClose} aria-label="Close source email">×</button>
      </header>

      {loading && <div className="state">Loading original email evidence…</div>}
      {error && <div className="state error">{error}</div>}

      {!loading && !error && evidence && <>
        {!evidence.evidenceAvailable && <p className="source-email-note">This booking predates full source-email retention. The metadata and any retained body preview are shown below.</p>}
        {evidence.bodyTruncated && <p className="source-email-note">The stored source body exceeded the evidence limit. The retained preview is shown below.</p>}

        <dl className="source-email-meta">
          <dt>From</dt><dd>{[text(evidence.senderName), text(evidence.senderAddress)].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>Received</dt><dd>{formatDateTime(evidence.receivedAtUtc)}</dd>
          {recipientsText(evidence.toRecipients) && <><dt>To</dt><dd>{recipientsText(evidence.toRecipients)}</dd></>}
          {recipientsText(evidence.ccRecipients) && <><dt>Cc</dt><dd>{recipientsText(evidence.ccRecipients)}</dd></>}
          {text(evidence.mailbox) && <><dt>Mailbox</dt><dd>{text(evidence.mailbox)}</dd></>}
          {text(evidence.internetMessageId) && <><dt>Email ID</dt><dd className="source-email-id">{text(evidence.internetMessageId)}</dd></>}
          {text(evidence.conversationId) && <><dt>Conversation</dt><dd className="source-email-id">{text(evidence.conversationId)}</dd></>}
        </dl>

        <section className="source-email-body">
          <div className="source-email-section-heading"><strong>Email body</strong>{evidence.bodyFormat && <span>{evidence.bodyFormat}</span>}</div>
          <pre>{body || "No body text was retained for this message."}</pre>
        </section>

        <section className="source-email-attachments">
          <div className="source-email-section-heading"><strong>Order documents</strong><span>{attachments.length}</span></div>
          {attachments.length > 0 ? <ul>{attachments.map((attachment, index) => {
            const name = displayAttachmentName(attachment, index, evidence);
            const copyHref = attachmentCopyHref(attachment);
            return <li key={`${name}-${index}`}>
              <div>
                <strong>{name}</strong>
                <span>{[attachment.contentType, formatSize(attachment.size)].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="source-email-attachment-actions">
                {copyHref && <button type="button" onClick={() => openPreview(attachment)}>Open preview</button>}
                {copyHref
                  ? <a href={copyHref} download={safeDownloadName(name)}>Download copy</a>
                  : attachment.sourceUrl
                    ? <a href={attachment.sourceUrl} target="_blank" rel="noreferrer">Open linked file</a>
                    : <em>Copy not retained</em>}
                {attachment.retrievalError && <small className="error">{attachment.retrievalError}</small>}
              </div>
            </li>;
          })}</ul> : <p>No PDF, Excel or CSV order documents were recorded.</p>}
          {hiddenAttachmentCount > 0 && <small>{hiddenAttachmentCount} inline image/signature attachment{hiddenAttachmentCount === 1 ? " was" : "s were"} hidden from this planner list. Raw email evidence is still retained.</small>}
          <small>PDF, CSV and Excel order documents can be previewed here. The original retained copy remains available for download.</small>
        </section>

        <footer>
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </footer>
      </>}
    </aside>

    {preview && <div className="source-email-preview-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(undefined); }}>
      <div className="source-email-preview-modal" role="dialog" aria-modal="true" aria-label="Attachment preview">
        <header>
          <div>
            <p className="eyebrow">Attachment preview</p>
            <h3>{displayAttachmentName(preview.attachment, 0, evidence)}</h3>
          </div>
          <button type="button" className="source-email-close" onClick={() => setPreview(undefined)} aria-label="Close attachment preview">×</button>
        </header>
        {preview.mode === "pdf" && <iframe title="PDF attachment preview" src={preview.href} />}
        {preview.mode === "text" && <pre>{preview.text}</pre>}
        {preview.mode === "excel" && <div className="source-email-excel-preview">
          {preview.error && <div className="state">{preview.error}</div>}
          {!preview.error && (preview.sheets?.length ?? 0) === 0 && <div className="state">No readable worksheets were found in this Excel attachment.</div>}
          {!preview.error && (preview.sheets?.length ?? 0) > 0 && <>
            <div className="source-email-sheet-tabs" role="tablist" aria-label="Workbook sheets">
              {preview.sheets!.map((sheet, index) => <button
                key={`${sheet.name}-${index}`}
                type="button"
                role="tab"
                aria-selected={(preview.activeSheetIndex ?? 0) === index}
                className={(preview.activeSheetIndex ?? 0) === index ? "active" : ""}
                onClick={() => setPreview((current) => current ? { ...current, activeSheetIndex: index } : current)}
              >{sheet.name}</button>)}
            </div>
            {activeExcelSheet && <div className="source-email-excel-grid">
              <table><tbody>{activeExcelSheet.rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => rowIndex === 0
                  ? <th key={`cell-${rowIndex}-${cellIndex}`}>{cell}</th>
                  : <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}
              </tr>)}</tbody></table>
              {activeExcelSheet.truncated && <p className="source-email-excel-note">Preview limited to the first {excelPreviewRowLimit} rows and {excelPreviewColumnLimit} columns. Download the retained copy for the full workbook.</p>}
            </div>}
          </>}
        </div>}
        {preview.mode === "unsupported" && <div className="state">Preview is not available for this attachment type. Use Download copy instead.</div>}
        <footer>
          <a href={preview.href} download={safeDownloadName(displayAttachmentName(preview.attachment, 0, evidence))}>Download copy</a>
          <button type="button" className="primary" onClick={() => setPreview(undefined)}>Close</button>
        </footer>
      </div>
    </div>}
  </div>;
}
