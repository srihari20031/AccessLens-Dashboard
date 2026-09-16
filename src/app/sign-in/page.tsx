import type { Metadata } from 'next';

import { SetupNotice } from '@/components/SetupNotice';
import { isConfigured } from '@/lib/supabase/config';

import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

/*
 * Never prerendered. These pages show one user's data, and what they show depends on the
 * session cookie. Without this, a build made before Supabase was configured renders the
 * setup notice and bakes it in as static — and a page of per-user data that can be
 * prerendered at all is a bug waiting to happen.
 */
export const dynamic = 'force-dynamic';


export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isConfigured()) return <SetupNotice />;

  const params = await searchParams;
  const raw = params.next;
  const next = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/runs';

  return (
    <div className="stack" style={{ maxWidth: '34rem' }}>
      <div className="stack-tight">
        <h1>Sign in</h1>
        <p className="lede">
          Your runs are yours alone. Reports are stored under your account and no one else can read
          them.
        </p>
      </div>
      <SignInForm next={next} />
      <p className="small muted prose">
        Scans are run from the command line with <code className="mono">accesslens scan</code> or{' '}
        <code className="mono">accesslens crawl</code>; this dashboard reads the JSON they produce.
      </p>
    </div>
  );
}
