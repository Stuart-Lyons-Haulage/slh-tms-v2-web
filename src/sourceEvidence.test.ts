import { describe, expect, it } from "vitest";
import * as sourceEvidenceModule from "./sourceEvidence";

type Resolver = (payload: Record<string, unknown>) => {
  messageId: string;
  internetMessageId: string;
  displayId: string;
  subject: string;
  receivedAt: string;
  webLink: string;
};

const resolve = (sourceEvidenceModule as { resolveSourceEvidence?: Resolver }).resolveSourceEvidence;

describe("resolveSourceEvidence", () => {
  it("keeps existing review rows linked when the API uses sourceEmail field names", () => {
    expect(resolve?.({
      sourceEmailMessageId: "outlook-123",
      sourceInternetMessageId: "<mail-123@example.com>",
      sourceEmailSubject: "Order 456",
      sourceEmailReceivedAt: "2026-08-27T08:15:00Z",
      sourceEmailWebLink: "https://outlook.office365.com/message/123",
    })).toEqual({
      messageId: "outlook-123",
      internetMessageId: "<mail-123@example.com>",
      displayId: "<mail-123@example.com>",
      subject: "Order 456",
      receivedAt: "2026-08-27T08:15:00Z",
      webLink: "https://outlook.office365.com/message/123",
    });
  });

  it("prefers the established source fields when both contracts are present", () => {
    expect(resolve?.({
      sourceMessageId: "current-id",
      sourceInternetMessageId: "<current@example.com>",
      sourceEmailMessageId: "legacy-id",
      sourceSubject: "Current subject",
      sourceEmailSubject: "Legacy subject",
      sourceReceivedAtUtc: "2026-08-27T09:00:00Z",
      sourceEmailReceivedAt: "2026-08-27T08:00:00Z",
      sourceWebLink: "https://outlook/current",
      sourceEmailWebLink: "https://outlook/legacy",
    })).toEqual({
      messageId: "current-id",
      internetMessageId: "<current@example.com>",
      displayId: "<current@example.com>",
      subject: "Current subject",
      receivedAt: "2026-08-27T09:00:00Z",
      webLink: "https://outlook/current",
    });
  });

  it("opens a retained source-email snapshot when the staged payload contains the body", () => {
    const result = resolve?.({
      sourceMessageId: "message-1",
      sourceSubject: "Waitrose order O78442",
      sourceReceivedAtUtc: "2026-09-08T09:15:00Z",
      sourceSenderName: "Customer Orders",
      sourceSender: "orders@example.com",
      sourceBodyText: "Please collect two pallets from Sefter and deliver to Waitrose.",
      sourceToRecipients: [{ address: "info@lyonshaulage.com" }],
      sourceAttachments: [{ name: "booking.pdf", size: 2048, isInline: false }],
      sourceWebLink: "https://outlook.office365.com/message/1",
    });

    expect(result?.webLink.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    const html = decodeURIComponent(result?.webLink.split(",", 2)[1] || "");
    expect(html).toContain("Waitrose order O78442");
    expect(html).toContain("Please collect two pallets from Sefter");
    expect(html).toContain("booking.pdf");
    expect(html).toContain("copy not retained");
    expect(html).toContain("Open original message in Outlook");
  });

  it("renders retained attachment copies as download links", () => {
    const result = resolve?.({
      sourceSubject: "Order with attachment",
      sourceBodyText: "Please review the attached booking form.",
      sourceAttachments: [{ name: "booking.pdf", contentType: "application/pdf", contentBase64: "SGVsbG8=", size: 5, isInline: false }],
    });

    const html = decodeURIComponent(result?.webLink.split(",", 2)[1] || "");
    expect(html).toContain("booking.pdf");
    expect(html).toContain("Download copy");
    expect(html).toContain("data:application/pdf;base64,SGVsbG8=");
  });

  it("falls back to a non-executable MIME type for unsafe attachment content types", () => {
    const result = resolve?.({
      sourceSubject: "Order with unsafe attachment metadata",
      sourceBodyText: "Please review the attachment.",
      sourceAttachments: [{
        name: "booking.bin",
        contentType: "text/html\"><img src=x onerror=alert(1)>",
        contentBase64: "SGVsbG8=",
        size: 5,
        isInline: false,
      }],
    });

    const html = decodeURIComponent(result?.webLink.split(",", 2)[1] || "");
    expect(html).toContain("data:application/octet-stream;base64,SGVsbG8=");
    expect(html).not.toContain("text/html\"><img");
  });

  it("escapes retained email content before rendering the snapshot", () => {
    const result = resolve?.({
      sourceSubject: "<script>alert(1)</script>",
      sourceBodyText: "<img src=x onerror=alert(1)>",
    });
    const html = decodeURIComponent(result?.webLink.split(",", 2)[1] || "");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
