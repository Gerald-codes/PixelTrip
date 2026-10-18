/**
 * Tests for the service selector (`getServices`).
 *
 * Covers the one piece of real logic in the Foundation: resolving
 * `NEXT_PUBLIC_SERVICE_MODE` into a mock or real registry, failing fast on an
 * unknown value, and guaranteeing both modes expose the identical key set.
 *
 * `getServices` reads `process.env.NEXT_PUBLIC_SERVICE_MODE` at call time, so
 * each test sets/deletes the variable and restores it afterwards.
 *
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, getServices } from "./index";

const ENV_KEY = "NEXT_PUBLIC_SERVICE_MODE";

/** The registry keys both modes must expose, in a stable order for comparison. */
const EXPECTED_KEYS = [
  "guest",
  "room",
  "chat",
  "vote",
  "itinerary",
  "preferences",
  "destination",
  "budget",
  "flight",
  "run",
  "selection",
  "tripDates",
].sort();

describe("getServices", () => {
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalValue;
    }
  });

  it("returns the mock registry by default when the mode is unset", async () => {
    const registry = getServices();
    expect(Object.keys(registry).sort()).toEqual(EXPECTED_KEYS);
    // Mock guest service returns fixture data rather than throwing.
    await expect(registry.guest.getGuest("does-not-exist")).resolves.toBeNull();
  });

  it("defaults to mock when the mode is empty or whitespace-only", async () => {
    process.env[ENV_KEY] = "   ";
    const registry = getServices();
    expect(Object.keys(registry).sort()).toEqual(EXPECTED_KEYS);
    await expect(registry.guest.getGuest("does-not-exist")).resolves.toBeNull();
  });

  it("returns the real registry when the mode is exactly 'real'", () => {
    process.env[ENV_KEY] = "real";
    const registry = getServices();
    expect(Object.keys(registry).sort()).toEqual(EXPECTED_KEYS);
    // Real services whose backend does not exist yet throw NotImplementedError.
    expect(() => registry.chat.listMessages("any")).toThrow(/not implemented/);
  });

  it("throws ConfigError on an unknown mode, naming the value and variable", () => {
    process.env[ENV_KEY] = "banana";
    expect(() => getServices()).toThrow(ConfigError);
    expect(() => getServices()).toThrow(/banana/);
    expect(() => getServices()).toThrow(new RegExp(ENV_KEY));
  });

  it("treats non-exact casing/whitespace variants as invalid (case-sensitive)", () => {
    for (const invalid of ["Mock", "REAL", " mock", "real "]) {
      process.env[ENV_KEY] = invalid;
      expect(() => getServices()).toThrow(ConfigError);
    }
  });

  it("exposes identical keys across mock and real modes", () => {
    process.env[ENV_KEY] = "mock";
    const mockKeys = Object.keys(getServices()).sort();

    process.env[ENV_KEY] = "real";
    const realKeys = Object.keys(getServices()).sort();

    expect(mockKeys).toEqual(realKeys);
    expect(mockKeys).toEqual(EXPECTED_KEYS);
  });
});
