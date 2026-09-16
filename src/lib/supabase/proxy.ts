import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { supabaseConfig } from './config';

/** Paths a signed-out visitor may reach. Everything else redirects to the sign-in page. */
// `/preview` renders a committed sample report and `/about` is static; neither reads user data.
const PUBLIC_PREFIXES = ['/sign-in', '/auth', '/preview', '/about'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refresh the session on every request, and keep signed-out visitors out of the app.
 *
 * Supabase access tokens are short-lived. Without this the cookie would go stale and a
 * Server Component would start seeing a signed-out user mid-session.
 *
 * The redirect here is a convenience, not the security boundary: row-level security in
 * Postgres is. A request that slipped past this returns no rows rather than someone else's.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const config = supabaseConfig();
  if (config === null) {
    // Not configured yet: let every request through so the setup page can explain itself.
    return response;
  }

  const supabase = createServerClient(config.url, config.anonKey, {
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

  // getUser() revalidates the token with Supabase. getSession() would trust the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (user === null && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (user !== null && pathname === '/sign-in') {
    const url = request.nextUrl.clone();
    url.pathname = '/runs';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
