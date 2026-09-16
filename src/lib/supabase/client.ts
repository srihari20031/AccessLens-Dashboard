import { createBrowserClient } from '@supabase/ssr';

import { requireSupabaseConfig } from './config';

/** A Supabase client for Client Components. Only used for sign-out and auth state. */
export function createClient() {
  const { url, anonKey } = requireSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
