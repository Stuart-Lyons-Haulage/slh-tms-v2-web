import { describe, expect, it } from "vitest";
import { bodyAsText, isOperationalAttachment, looksLikeInlineImage, stripHtmlForDisplay } from "./SourceEmailEvidenceDrawer";

describe("SourceEmailEvidenceDrawer evidence normalisation", () => {
  it("renders legacy HTML stored in bodyText as readable text", () => {
    expect(bodyAsText({ bodyText: "<html><body><p>Collect <strong>4 pallets</strong></p></body></html>" }))
      .toBe("Collect 4 pallets");
    expect(stripHtmlForDisplay("<div>Delivery&nbsp;tomorrow</div>"))
      .toBe("Delivery tomorrow");
  });

  it("does not hide a PDF merely because Outlook supplied a contentId", () => {
    const pdf = {
      name: "order.pdf",
      contentType: "application/pdf",
      contentId: "order.pdf@example",
      isInline: false,
    };
    expect(looksLikeInlineImage(pdf)).toBe(false);
    expect(isOperationalAttachment(pdf)).toBe(true);
  });

  it("still hides genuine inline signature images", () => {
    expect(looksLikeInlineImage({
      name: "image271227.png",
      contentType: "image/png",
      contentId: "image271227.png@example",
      isInline: true,
    })).toBe(true);
  });
});
