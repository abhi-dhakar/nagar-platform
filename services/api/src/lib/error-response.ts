import type { ApiFailure } from "@nagar/types";

export interface ErrorResponse {
  status: number;
  body: ApiFailure;
}

function fail(status: number, code: string, message: string): ErrorResponse {
  return { status, body: { success: false, error: { code, message } } };
}

/**
 * Maps any error thrown while handling a request to the public `{ success: false, error }`
 * envelope. Client mistakes (4xx) get a specific, stable code; everything else is reported as a
 * generic 500 so internal details never reach the client.
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  const status =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 600
      ? error.statusCode
      : 500;
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";

  if (status >= 500) {
    return fail(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
  switch (code) {
    case "FST_ERR_CTP_INVALID_JSON_BODY":
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return fail(400, "INVALID_JSON", "The request body must be valid JSON.");
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return fail(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return fail(415, "UNSUPPORTED_MEDIA_TYPE", "That content type is not supported.");
    default:
      break;
  }
  if (status === 413) return fail(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  if (status === 415)
    return fail(415, "UNSUPPORTED_MEDIA_TYPE", "That content type is not supported.");
  if (status === 404) return fail(404, "NOT_FOUND", "The requested resource was not found.");
  if (status === 429) return fail(429, "RATE_LIMITED", "Too many requests. Try again later.");
  return fail(status, "BAD_REQUEST", "The request could not be processed.");
}

export function notFoundResponse(): ErrorResponse {
  return fail(404, "NOT_FOUND", "The requested resource was not found.");
}
