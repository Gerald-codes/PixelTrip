/**
 * Shared error types for the service layer.
 *
 * - `ApiError` is thrown by real services when a backend or Supabase call fails.
 * - `ConfigError` is thrown for invalid or missing configuration.
 * - `NotImplementedError` is thrown by real service methods whose backend does not
 *   exist yet, so integration gaps surface as explicit errors instead of silent
 *   failures (per `development-rules.md`). Run with `NEXT_PUBLIC_SERVICE_MODE=mock`
 *   to use the contract-shaped mock implementations instead.
 */

/**
 * Raised for invalid or missing configuration (e.g. an unknown service mode or a
 * missing public env value). The message names the offending variable so the fix
 * is obvious, rather than silently running the wrong implementation.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Error codes the backend returns in its error envelope (see "HTTP API → Errors" in
 * `api-contracts.md`), plus client-side codes for failures that never reached it.
 */
export type ApiErrorCode =
  | "ROOM_NOT_FOUND"
  | "MEMBER_ALREADY_EXISTS"
  | "VALIDATION_ERROR"
  | "INVALID_DISPLAY_NAME"
  /** Budget outside SGD 100–50,000; the message is safe to show next to the field. */
  | "INVALID_BUDGET"
  /** Trip length or dates do not fit when the party is free; safe to show. */
  | "INVALID_TRIP_DATES"
  /** The dates cannot change now (flight locked or a search running); safe to show. */
  | "TRIP_DATES_LOCKED"
  | "ROOM_CODE_EXHAUSTED"
  | "INTERNAL_ERROR"
  | "DATABASE_ERROR"
  /** The request could not be sent or no response arrived. */
  | "NETWORK_ERROR"
  /** A response arrived but did not match the expected shape. */
  | "UNEXPECTED_RESPONSE";

/**
 * Raised by real services when a backend or Supabase call fails. UI code branches
 * on `code` (not `message`, which is safe to log but not tuned for display).
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** HTTP status, or `null` when no response was received. */
  readonly status: number | null;

  constructor(code: ApiErrorCode, message: string, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/** Raised when a real (backend-backed) service method is not yet implemented. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

/**
 * Build a consistent {@link NotImplementedError} for a real service method.
 *
 * @param member  Fully-qualified method name, e.g. `"ChatService.sendMessage"`.
 */
export function notImplemented(member: string): NotImplementedError {
  return new NotImplementedError(
    `${member} is not implemented (real mode). ` +
      `Set NEXT_PUBLIC_SERVICE_MODE=mock during frontend development.`,
  );
}
