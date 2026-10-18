/**
 * Frontend Supabase client (anon key only).
 *
 * Per the Supabase access boundary (`docs/SUPABASE_ACCESS_BOUNDARY.md`):
 *
 * - The frontend uses only the public, browser-safe `NEXT_PUBLIC_SUPABASE_URL`
 *   and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and only for approved read-only queries
 *   and Realtime subscriptions. All writes go through FastAPI.
 * - The frontend **never** holds the Supabase service-role key.
 *
 * Only the real service implementations (`src/services/*.api.ts`) may import this
 * module; UI code must never import it directly. The client is created lazily on
 * first use, so importing this module performs no network calls.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ConfigError } from "./errors";

/** Public, browser-safe Supabase environment variable names (anon-key only). */
export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

let client: SupabaseClient | null = null;

/**
 * Return the shared anon-key Supabase client, creating it on first use.
 *
 * @throws {ConfigError} if the URL or anon key is not configured.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }
  // NEXT_PUBLIC_* values are inlined at build time, so they must be read by name.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new ConfigError(
      `${SUPABASE_URL_ENV} and ${SUPABASE_ANON_KEY_ENV} must be set to use real services.`,
    );
  }
  client = createClient(url, anonKey, { auth: { persistSession: false } });
  return client;
}
