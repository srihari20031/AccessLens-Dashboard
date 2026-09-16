import Link from 'next/link';

import { signOut } from '@/app/auth/actions';
import { isConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

import { SiteNav } from './SiteNav';
import { WCAG_TARGET } from '@/lib/wcag';

async function currentEmail(): Promise<string | null> {
  if (!isConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function SiteHeader() {
  const email = await currentEmail();

  return (
    <header className="site-header">
      <div className="shell site-header__inner">
        <Link href={email === null ? '/sign-in' : '/runs'} className="wordmark">
          AccessLens
        </Link>
        {email === null ? (
          <>
            <span className="muted small">{WCAG_TARGET} conformance reports</span>
            <Link href="/about" className="small">
              How AccessLens works
            </Link>
          </>
        ) : (
          <>
            <SiteNav />
            <form action={signOut} className="row">
              <span className="muted small">{email}</span>
              <button type="submit" className="button button--quiet">
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
