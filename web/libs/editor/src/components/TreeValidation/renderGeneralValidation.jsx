import { isValidElement } from "react";
import parseHTML from "html-react-parser";
import sanitizeHTML from "sanitize-html";

// Upstream ERR_GENERAL messages include limited presentation markup and help
// links. Parse only that vocabulary into React nodes; arbitrary config values
// never enter the DOM as executable HTML.
export function renderGeneralValidation(value) {
  if (isValidElement(value)) return value;
  if (value == null) return "";
  if (typeof value !== "string") return String(value);

  const safeHTML = sanitizeHTML(value, {
    allowedTags: ["div", "p", "b", "strong", "em", "code", "a", "ul", "li", "br"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      div: ["data-testid"],
    },
    allowedSchemes: ["http", "https"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: "noopener noreferrer" },
      }),
    },
  });

  return parseHTML(safeHTML);
}
