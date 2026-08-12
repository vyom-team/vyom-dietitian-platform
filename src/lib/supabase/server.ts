import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseConfig } from "@/config/env";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * A new client is created per request because it closes over that request's
 * cookie store — a shared instance would leak one user's session into another
 * user's request. Never hoist this to a module-level singleton.
 */
export async function createClient() {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is expected and safe to
          // ignore: `proxy.ts` refreshes the session on every request, so the
          // refreshed cookie is still written on the response.
        }
      },
    },
  });
}
