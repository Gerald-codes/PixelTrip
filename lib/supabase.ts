import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase helper.
 *
 * All database access from API routes must go through this module. The service
 * role key bypasses row-level security and MUST never be exposed to the client,
 * so this helper is intended for server-side use only (API routes).
 *
 * Environment variables (see .env.example):
 * - NEXT_PUBLIC_SUPABASE_URL       — project URL
 * - SUPABASE_SERVICE_ROLE_KEY      — service role key (server only)
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY  — anon key (browser/realtime)
 */

let serviceClient: SupabaseClient | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Returns a singleton server-side Supabase client using the service role key.
 * Use this in API routes only.
 */
export function getServiceSupabase(): SupabaseClient {
  if (serviceClient) {
    return serviceClient;
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  serviceClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return serviceClient;
}

let anonClient: SupabaseClient | null = null;

/**
 * Returns a singleton browser-side Supabase client using the public anon key.
 * Safe for Realtime presence + broadcast. Does not persist sessions.
 *
 * IMPORTANT: Must return a singleton — creating multiple GoTrueClient instances
 * in the same browser context causes WebSocket conflicts and presence failures.
 *
 * NOTE: NEXT_PUBLIC_* vars must be referenced as literal identifiers so Next.js
 * can statically inline them into the client bundle at build time.
 */
export function createAnonSupabase(): SupabaseClient {
  if (anonClient) return anonClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!anonKey) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  anonClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return anonClient;
}
