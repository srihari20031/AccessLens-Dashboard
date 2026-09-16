'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import type { AuthState } from './state';

/** Only same-site paths, so a crafted link cannot bounce someone off to another host. */
function safeNext(formData: FormData): string {
  const next = String(formData.get('next') ?? '');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/runs';
}

/**
 * Sign in or sign up from one form.
 *
 * Both buttons submit the same fields; the one that was pressed arrives as `intent`. That
 * keeps a single pair of labelled inputs on screen instead of two near-identical forms, which
 * matters more for a keyboard or screen-reader user than it does visually.
 */
export async function authenticate(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const intent = String(formData.get('intent') ?? 'sign-in');

  if (email === '') return { error: 'Enter your email address.', notice: null };
  if (password === '') return { error: 'Enter your password.', notice: null };

  const supabase = await createClient();

  if (intent === 'sign-up') {
    if (password.length < 8) {
      return { error: 'Choose a password of at least 8 characters.', notice: null };
    }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message, notice: null };
    if (data.session === null) {
      // Email confirmation is switched on for this project.
      return {
        error: null,
        notice: `Account created. Open the confirmation link sent to ${email}, then sign in.`,
      };
    }
    revalidatePath('/', 'layout');
    redirect('/runs');
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: 'That email and password do not match an account.', notice: null };
  }
  revalidatePath('/', 'layout');
  redirect(safeNext(formData));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/sign-in');
}
