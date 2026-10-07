const list = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean).join(", ");

export function validationDisplay(error, t) {
  const modelName = String(error.modelName ?? "");
  const field = String(error.field ?? "");
  const value = String(error.value ?? "");
  const { validType } = error;
  switch (error.error) {
    case "ERR_REQUIRED": return t("validationRequired", { field, modelName });
    case "ERR_UNKNOWN_TAG": return t("validationUnknownTag", { value, modelName, field });
    case "ERR_TAG_NOT_FOUND": return t("validationTagNotFound", { value, modelName, field });
    case "ERR_TAG_UNSUPPORTED": return t("validationTagUnsupported", { field, modelName, value, validType: list(validType) });
    case "ERR_PARENT_TAG_UNEXPECTED": return t("validationParentTag", { value, validType: list(validType) });
    case "ERR_BAD_TYPE": return t("validationBadType", { field, modelName, validType: list(validType) });
    case "ERR_INTERNAL": return `${t("validationInternal")} ${value ?? ""}`;
    case "ERR_GENERAL": return String(value ?? "");
    default: return t("validationUnknown");
  }
}
