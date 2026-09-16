import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { requireSupabaseConfig } from './config';

/**
 * A Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * It reads and writes the session cookies, so every query it makes carries the signed-in
 * user and row-level security applies. Never cache it across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = requireSupabaseConfig();

  return createServerClient(url, anonKey, {
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
          // A Server Component cannot set cookies. The middleware refreshes the session on
          // every request, so losing the write here is harmless.
        }
      },
    },
  });
}
