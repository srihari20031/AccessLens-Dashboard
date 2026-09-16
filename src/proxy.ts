import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

/**
 * Runs before every page request: refreshes the Supabase session cookie and keeps signed-out
 * visitors out of the app.
 *
 * Named `proxy` rather than `middleware` because Next 16 renamed the convention.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets and static files. Auth cookies have to be
     * refreshed on real page requests, not on every image.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
