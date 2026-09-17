import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { bodyAsText, buildExcelPreview, isOperationalAttachment, looksLikeInlineImage, previewMode, stripHtmlForDisplay } from "./SourceEmailEvidenceDrawer";

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

  it("recognises retained Excel files as browser-previewable", () => {
    expect(previewMode({ name: "booking.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).toBe("excel");
    expect(previewMode({ name: "booking.xlsm", contentType: "application/vnd.ms-excel.sheet.macroEnabled.12" })).toBe("excel");
  });

  it("renders workbook cell values without executing workbook code", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Depot", "Pallets"],
      ["MORRISONS SITTINGBOURNE", 18],
    ]), "Orders");
    const base64 = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
    const preview = buildExcelPreview(base64);
    expect(preview).toHaveLength(1);
    expect(preview[0].name).toBe("Orders");
    expect(preview[0].rows[1]).toEqual(["MORRISONS SITTINGBOURNE", "18"]);
  });
});
