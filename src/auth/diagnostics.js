const stages = new Set(["discovery", "authorization", "token", "userinfo", "login", "callback", "storage", "configuration"]);
const codes = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "OAUTH_RESPONSE_BODY_ERROR", "OAUTH_AUTHORIZATION_RESPONSE_ERROR", "OAUTH_INVALID_RESPONSE", "OAUTH_INVALID_REQUEST",
  "OAUTH_RESPONSE_IS_NOT_JSON", "OAUTH_RESPONSE_IS_NOT_CONFORM", "OAUTH_HTTP_REQUEST_FORBIDDEN", "OAUTH_PARSE_ERROR",
  "OAUTH_JWT_TIMESTAMP_CHECK_FAILED", "OAUTH_JWT_CLAIM_COMPARISON_FAILED", "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED",
  "OAUTH_KEY_SELECTION_FAILED", "OAUTH_MISSING_SERVER_METADATA", "OAUTH_INVALID_SERVER_METADATA",
  "SQLITE_BUSY", "SQLITE_READONLY", "SQLITE_CANTOPEN", "SQLITE_IOERR", "SQLITE_FULL",
]);
const providerErrors = new Set(["invalid_client", "unauthorized_client", "invalid_grant", "invalid_request", "access_denied", "server_error", "temporarily_unavailable"]);

class AuthStepError extends Error {
  constructor(stage, cause) {
    super("LiD0llID operation failed.", { cause });
    this.stage = stage;
  }
} // Retain the original exception internally, without using its message as log or page content.

export async function authStep(stage, operation) {
  try { return await operation(); }
  catch (error) { throw error instanceof AuthStepError ? error : new AuthStepError(stage, error); }
} // Preserve the innermost failed stage when discovery fails inside another operation.

export function authDiagnostic(error, fallback = "login") {
  const stage = error instanceof AuthStepError && stages.has(error.stage) ? error.stage : stages.has(fallback) ? fallback : "login";
  let code = "SIGN_IN_FAILED", status;
  for (let cause = error, depth = 0; cause && depth < 8; cause = cause.cause, depth++) {
    if (codes.has(cause.code)) code = cause.code;
    if (providerErrors.has(cause.error)) code = cause.error;
    if (stage === "discovery" && cause.attribute === "issuer") code = "ISSUER_MISMATCH";
    if (["TimeoutError", "AbortError"].includes(cause.name) && code === "SIGN_IN_FAILED") code = "REQUEST_TIMEOUT";
    const httpStatus = cause.status ?? cause.response?.status;
    if (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599) status = httpStatus;
  }
  return { stage, code, ...(status ? { status } : {}) };
} // Emit only allowlisted codes, stages and numeric statuses; never URLs, error messages, response bodies or tokens.
