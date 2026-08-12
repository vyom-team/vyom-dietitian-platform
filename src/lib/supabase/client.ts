"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/config/env";

/**
 * Supabase client for Client Components.
 *
 * Uses the publishable key, which is public by design: it identifies the
 * project and authorises nothing on its own. Every request it makes is
 * constrained by Row Level Security and by the caller's own JWT.
 *
 * `createBrowserClient` memoises internally, so calling this per component is
 * correct and does not open redundant connections.
 *
 * @throws if Supabase is not configured. Check `isAuthConfigured` first when
 * rendering a surface that must survive an unconfigured environment.
 */
export function createClient() {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }

  return createBrowserClient(config.url, config.key);
}
