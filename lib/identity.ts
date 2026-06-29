/**
 * Client-side identity helper.
 *
 * PixelTrip has no authentication: a user is identified by a UUID generated
 * once in the browser and persisted in `localStorage`, plus a display name.
 * This module is the single source of truth for reading/writing that identity.
 *
 * These functions touch `localStorage`, which is unavailable during server-side
 * rendering, so every access is guarded for SSR. On the server, reads return
 * sensible fallbacks and writes are no-ops.
 */

const USER_ID_KEY = "pixeltrip:userId";
const DISPLAY_NAME_KEY = "pixeltrip:displayName";

/** True when running in a browser with `localStorage` available. */
function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * Returns the persisted user id, generating and storing a new UUID on first
 * use. On the server (no `localStorage`), a fresh UUID is returned without
 * persistence; the browser will generate the durable id on hydration.
 */
export function getOrCreateUserId(): string {
  if (!hasLocalStorage()) {
    return crypto.randomUUID();
  }

  const existing = window.localStorage.getItem(USER_ID_KEY);
  if (existing) {
    return existing;
  }

  const userId = crypto.randomUUID();
  window.localStorage.setItem(USER_ID_KEY, userId);
  return userId;
}

/**
 * Returns the persisted display name, or an empty string if none is stored
 * (or when running on the server).
 */
export function getDisplayName(): string {
  if (!hasLocalStorage()) {
    return "";
  }
  return window.localStorage.getItem(DISPLAY_NAME_KEY) ?? "";
}

/**
 * Persists the display name. No-op on the server. Passing an empty string
 * clears the stored name.
 */
export function setDisplayName(displayName: string): void {
  if (!hasLocalStorage()) {
    return;
  }

  if (displayName === "") {
    window.localStorage.removeItem(DISPLAY_NAME_KEY);
    return;
  }

  window.localStorage.setItem(DISPLAY_NAME_KEY, displayName);
}
