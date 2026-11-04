import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next 16 Proxy (the former middleware) — runs only in the Node.js runtime.
 *
 * Responsibilities:
 *  1. Refresh the Supabase auth session so server components always see a
 *     valid token (standard @supabase/ssr pattern).
 *  2. Optimistic redirects:
 *      - protected pages with no session  → /login
 *      - /login with an active session    → /dashboard
 *
 * NOTE: This is not the full authorization check — every page re-verifies
 * the session server-side, and all data access is additionally protected by
 * Supabase Row Level Security.
 *
 * The matcher below excludes /api/* so the ESP32 ingest endpoint is never
 * routed through the proxy (devices authenticate with API keys, not cookies).
 */

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/containers",
  "/history",
  "/devices",
  "/settings",
];

export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Not configured yet (mock-data phase): let everything through.
  if (!supabaseUrl || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { user } = (await supabase.auth.getUser()).data;
  const { pathname, search } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/dashboard" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except API routes, static assets and Next internals.
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
