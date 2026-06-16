const ALLOWED_TAGS = new Set([
  "DIV", "P", "TABLE", "TBODY", "TR", "TD", "B", "STRONG",
  "UL", "LI", "SPAN", "H2", "H3", "BR",
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  "background-color", "border", "border-bottom", "border-collapse",
  "border-radius", "color", "font-size", "font-weight", "line-height",
  "margin", "margin-bottom", "margin-top", "max-width", "padding",
  "text-align", "width",
]);

/** 清洗 AI 返回的 eBay HTML，仅用于浏览器预览。 */
export function sanitizeHtmlFragment(html: string): string {
  if (!html || typeof DOMParser === "undefined") return "";

  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name !== "style") element.removeAttribute(attribute.name);
    }

    const style = element.getAttribute("style");
    if (!style) continue;

    const cleaned = style
      .split(";")
      .map((rule) => rule.trim())
      .filter(Boolean)
      .filter((rule) => {
        const [property, ...valueParts] = rule.split(":");
        const value = valueParts.join(":").trim().toLowerCase();
        return ALLOWED_STYLE_PROPERTIES.has(property.trim().toLowerCase())
          && !value.includes("url(")
          && !value.includes("expression(")
          && !value.includes("javascript:");
      })
      .join("; ");

    if (cleaned) element.setAttribute("style", cleaned);
    else element.removeAttribute("style");
  }

  return doc.body.innerHTML;
}
