// Cypress serializes authenticated request/response headers into HTTP failures.
// Redact their diagnostic text without altering the request or its failure state.
const redactDiagnostic = (text) => text
  .replace(/(\b(?:cookie|set-cookie|authorization|x-csrftoken)["']?\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi, '$1"[REDACTED]"')
  .replace(/(\b(?:sessionid|csrftoken)\s*[=:]\s*["']?)[A-Za-z0-9_-]{16,}/gi, '$1[REDACTED]')
  .replace(/(\btoken["']?\s*[=:]\s*["']?)[A-Za-z0-9_.=-]{16,}/gi, '$1[REDACTED]')
  .replace(/(\b(?:Bearer|Token)\s+)[A-Za-z0-9_.=-]{16,}/gi, '$1[REDACTED]');

const redactFailure = (error) => {
  error.message = redactDiagnostic(error.message);
  if (error.stack) error.stack = redactDiagnostic(error.stack);
  return error;
};

module.exports = { redactDiagnostic, redactFailure };
