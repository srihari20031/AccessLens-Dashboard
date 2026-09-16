/**
 * Where the Supabase project lives.
 *
 * Only the project URL and the anon (publishable) key are ever read. The service-role key is
 * not used anywhere in this app: every query runs as the signed-in user so the row-level
 * security policies in web/supabase/migrations/ are the whole of the access control.
 *
 * Both values are `NEXT_PUBLIC_`, so they are compiled into the browser bundle — that is
 * correct for the anon key, and the reason a service key must never be named here.
 */

export type SupabaseConfig = { url: string; anonKey: string };

export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isConfigured(): boolean {
  return supabaseConfig() !== null;
}

/**
 * The same values, or a readable failure.
 *
 * Pages check `isConfigured()` first and explain what to do, so this throws only when
 * something reached the database layer without that check.
 */
export function requireSupabaseConfig(): SupabaseConfig {
  const config = supabaseConfig();
  if (config === null) {
    throw new Error(
      'Supabase is not configured. Copy web/.env.example to web/.env.local and fill in ' +
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  return config;
}
