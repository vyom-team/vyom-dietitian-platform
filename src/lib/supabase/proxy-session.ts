import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseConfig } from "@/config/env";
import { isProtectedPath, isAuthPath, DEFAULT_SIGNED_IN_PATH, SIGN_IN_PATH } from "@/lib/auth/routes";

/**
 * Session refresh and optimistic route protection, called from `src/proxy.ts`.
 *
 * Two jobs, deliberately no more:
 *
 *  1. Refresh the Supabase session so expired access tokens are renewed and the
 *     updated cookies ride along on the response.
 *  2. Redirect obviously-unauthenticated traffic away from protected routes.
 *
 * This is an *optimistic* check. Next.js runs proxy on every request including
 * prefetches, so it must not hit the database. Real authorization — role and
 * organization membership — happens in the Data Access Layer
 * (`src/lib/auth/dal.ts`), close to the data. Proxy is a convenience, never the
 * security boundary.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = getSupabaseConfig();

  // Without Supabase configured there is no session to refresh. Protected
  // routes still deny access — the DAL fails closed.
  if (!config) return response;

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /**
   * `getUser()` — not `getSession()`. getSession reads the cookie without
   * verifying it, so a forged cookie would pass. getUser revalidates the token
   * with Supabase's auth server, which is what makes this trustworthy.
   *
   * Calling it also performs the token refresh this function exists for.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = SIGN_IN_PATH;
    redirectUrl.search = "";
    // Preserve the destination so sign-in can return the user to it. Only the
    // path is carried, and it is re-validated as internal before use.
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = DEFAULT_SIGNED_IN_PATH;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
