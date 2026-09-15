import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { useAccessToken } from "../lib/auth";
import "../source-email-evidence.css";

type Recipient = {
  address?: string;
  name?: string;
  emailAddress?: string | { address?: string; name?: string };
};

type Attachment = {
  name?: string;
  contentType?: string;
  contentId?: string;
  size?: number;
  isInline?: boolean;
  contentBase64?: string;
  contentBytes?: string;
};

type SourceEmailEvidence = {
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

function bodyAsText(source?: SourceEmailEvidence) {
  if (!source) return "";
  if (text(source.bodyText)) return text(source.bodyText);
  if (!text(source.bodyHtml)) return "";
  const container = document.createElement("div");
  container.innerHTML = source.bodyHtml || "";
  return (container.textContent || container.innerText || "").trim();
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

function safeDownloadName(name?: string) {
  const cleaned = text(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned || "source-email-attachment";
}

function attachmentCopyHref(attachment: Attachment) {
  const base64 = normaliseBase64(attachment.contentBase64 || attachment.contentBytes);
  if (!base64) return "";
  const contentType = text(attachment.contentType) || "application/octet-stream";
  return `data:${contentType};base64,${base64}`;
}

export function SourceEmailEvidenceDrawer({ stagingId, onClose }: { stagingId: string; onClose: () => void }) {
  const token = useAccessToken();
  const [evidence, setEvidence] = useState<SourceEmailEvidence>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setEvidence(undefined);
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
  const attachments = normaliseArray<Attachment>(evidence?.attachments).filter((item) => item.isInline !== true);

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
          <div className="source-email-section-heading"><strong>Attachments</strong><span>{attachments.length}</span></div>
          {attachments.length > 0 ? <ul>{attachments.map((attachment, index) => {
            const copyHref = attachmentCopyHref(attachment);
            return <li key={`${attachment.name || "attachment"}-${index}`}>
              <strong>{attachment.name || "Unnamed attachment"}</strong>
              <span>{[attachment.contentType, formatSize(attachment.size)].filter(Boolean).join(" · ")}</span>
              {copyHref
                ? <a href={copyHref} download={safeDownloadName(attachment.name)}>Download copy</a>
                : <em>Copy not retained</em>}
            </li>;
          })}</ul> : <p>No non-inline attachments were recorded.</p>}
          <small>Attachment copies are shown when Power Automate supplied Base64 content to TMS source evidence. Older records may show metadata only.</small>
        </section>

        <footer>
          <button type="button" className="primary" onClick={onClose}>Close</button>
        </footer>
      </>}
    </aside>
  </div>;
}
