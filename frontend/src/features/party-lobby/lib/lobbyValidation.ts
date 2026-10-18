/**
 * Client-side input validation for the party lobby.
 *
 * Mirrors the service contract bounds (see `room.contract.ts`): a room name is
 * 1–100 non-blank characters, a display name is 1–50 non-blank characters, and a
 * room code must be non-blank (the service trims/uppercases it). Invalid input is
 * caught here so no service call is made; the returned message is safe to show.
 */

/** Max length of a room name per the contract. */
export const ROOM_NAME_MAX = 100;
/** Max length of a display/adventurer name per the contract. */
export const DISPLAY_NAME_MAX = 50;

/** A single-field validation outcome. */
export interface FieldValidation {
  valid: boolean;
  /** Safe, player-facing message when `valid` is false; otherwise undefined. */
  message?: string;
}

const VALID: FieldValidation = { valid: true };

/** Validate a room name: 1–100 characters, not blank. */
export function validateRoomName(name: string): FieldValidation {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, message: "Enter a name for your party." };
  }
  if (trimmed.length > ROOM_NAME_MAX) {
    return {
      valid: false,
      message: `Party name must be ${ROOM_NAME_MAX} characters or fewer.`,
    };
  }
  return VALID;
}

/** Validate an adventurer/display name: 1–50 characters, not blank. */
export function validateDisplayName(name: string): FieldValidation {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, message: "Enter your adventurer name." };
  }
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return {
      valid: false,
      message: `Adventurer name must be ${DISPLAY_NAME_MAX} characters or fewer.`,
    };
  }
  return VALID;
}

/** Validate a room code: non-blank (service trims and uppercases it). */
export function validateRoomCode(code: string): FieldValidation {
  if (code.trim().length === 0) {
    return { valid: false, message: "Enter a party code." };
  }
  return VALID;
}
