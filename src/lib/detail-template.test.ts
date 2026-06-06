import { describe, expect, it } from "vitest";
import {
  buildDetailFields,
  findSkuRecord,
  larkValueToText,
  replaceEditableItemDetails,
} from "@/lib/detail-template";

describe("detail-template", () => {
  it("flattens common Lark field shapes into readable text", () => {
    expect(larkValueToText([{ text: "Honda" }, { text: "TRX 350" }])).toBe("Honda, TRX 350");
    expect(larkValueToText([{ name: "在售" }])).toBe("在售");
  });

  it("finds SKU records case-insensitively", () => {
    const records = [{ SKU: "AB-123", 中文品名: "化油器" }];
    expect(findSkuRecord(records, "ab-123")).toBe(records[0]);
    expect(findSkuRecord(records, "missing")).toBeNull();
  });

  it("builds item detail fields from sku master data with fallbacks", () => {
    const fields = buildDetailFields({
      SKU: "AB-123",
      中文品名: "化油器",
      英文标题关键词: "Carburetor Assembly",
      OEM: "16100-HN5-305",
      类目: "ATV Parts",
    });

    expect(fields.reference).toBe("16100-HN5-305");
    expect(fields.package).toContain("Carburetor Assembly");
    expect(fields.fitment).toContain("ATV Parts");
    expect(fields.buyerCheck).toContain("mounting points");
  });

  it("replaces the first five editable cells and escapes user input", () => {
    const html = `
      <table>
        <tr><td contenteditable="true">old 1</td></tr>
        <tr><td contenteditable="true">old 2</td></tr>
        <tr><td contenteditable="true">old 3</td></tr>
        <tr><td contenteditable="true">old 4</td></tr>
        <tr><td contenteditable="true">old 5</td></tr>
        <tr><td contenteditable="true">old 6</td></tr>
      </table>
    `;

    const result = replaceEditableItemDetails(html, {
      condition: "New <unused>",
      reference: "OEM-1",
      package: "Line 1\nLine 2",
      fitment: "Honda",
      buyerCheck: "Compare",
    });

    expect(result).toContain("New &lt;unused&gt;");
    expect(result).toContain("Line 1<br>Line 2");
    expect(result).toContain("old 6");
  });
});
