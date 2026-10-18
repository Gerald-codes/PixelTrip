/**
 * Safe, display-ready error messages for the party lobby.
 *
 * The service layer throws {@link ApiError} with a stable `code` (see
 * `@/lib/errors`). UI must branch on `code`, never on the raw `message` (which is
 * safe to log but not tuned for players and may leak internals). These helpers
 * map a thrown value to a short, in-world message and never surface stack traces.
 */
import { ApiError, type ApiErrorCode } from "@/lib/errors";

/** Fallback shown when an error is not an {@link ApiError} or has no mapping. */
export const GENERIC_LOBBY_ERROR =
  "Something went wrong. Try again.";

/** Messages for creating a party, keyed by backend error code. */
const CREATE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  VALIDATION_ERROR: "Check the room name and your adventurer name.",
  INVALID_DISPLAY_NAME: "Check the room name and your adventurer name.",
  ROOM_CODE_EXHAUSTED: "The party could not be created. Try again.",
  DATABASE_ERROR: "The party could not be created. Try again.",
  INTERNAL_ERROR: "The party could not be created. Try again.",
  NETWORK_ERROR: "Could not reach the server. Check the backend is running.",
  UNEXPECTED_RESPONSE: "The party could not be created. Try again.",
};

/** Messages for joining a party, keyed by backend error code. */
const JOIN_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  ROOM_NOT_FOUND: "No party found for that code.",
  VALIDATION_ERROR: "Check the code and your name.",
  INVALID_DISPLAY_NAME: "Check the code and your name.",
  MEMBER_ALREADY_EXISTS: "That name is taken in this party. Try another.",
  DATABASE_ERROR: "Could not join the party. Try again.",
  INTERNAL_ERROR: "Could not join the party. Try again.",
  NETWORK_ERROR: "Could not reach the server. Check the backend is running.",
  UNEXPECTED_RESPONSE: "Could not join the party. Try again.",
};

/** Map a thrown value from `createRoom` to a safe, player-facing message. */
export function toCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return CREATE_MESSAGES[error.code] ?? GENERIC_LOBBY_ERROR;
  }
  return GENERIC_LOBBY_ERROR;
}

/** Map a thrown value from `joinRoom` to a safe, player-facing message. */
export function toJoinErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return JOIN_MESSAGES[error.code] ?? GENERIC_LOBBY_ERROR;
  }
  return GENERIC_LOBBY_ERROR;
}
