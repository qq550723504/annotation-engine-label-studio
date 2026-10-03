const asText = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

export const localizedResponseErrorDetails = (error, locale) => {
  const meta = error?.$meta;
  if (typeof meta?.status !== "number" || meta.status < 400 || meta.status >= 500
    || meta.headers?.get?.("content-language") !== locale) {
    return null;
  }

  const response = error?.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;

  const details = [asText(response.detail), asText(response.message)].filter(Boolean);
  const validation = response.validation_errors;
  if (Array.isArray(validation)) {
    details.push(...validation.map(asText).filter(Boolean));
  } else if (validation && typeof validation === "object") {
    for (const [field, value] of Object.entries(validation)) {
      const messages = (Array.isArray(value) ? value : [value]).map(asText).filter(Boolean);
      details.push(...messages.map((message) => field === "non_field_errors" ? message : `${field}: ${message}`));
    }
  }

  return [...new Set(details)].join("; ").slice(0, 1000) || null;
};
