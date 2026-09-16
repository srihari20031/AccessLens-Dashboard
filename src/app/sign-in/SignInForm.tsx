'use client';

import { useActionState } from 'react';

import { authenticate } from '@/app/auth/actions';
import { EMPTY_AUTH_STATE } from '@/app/auth/state';

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(authenticate, EMPTY_AUTH_STATE);

  return (
    <form action={formAction} className="stack">
      {/*
        The result of the last attempt, announced rather than only shown. aria-live on a
        container that is always in the DOM is what makes a screen reader read the new text;
        rendering the container only on error would announce nothing.
      */}
      <div aria-live="polite">
        {state.error !== null ? (
          <div className="notice notice--error">
            <h2 className="small">Could not sign you in</h2>
            <p className="small">{state.error}</p>
          </div>
        ) : null}
        {state.notice !== null ? (
          <div className="notice notice--ok">
            <h2 className="small">Check your email</h2>
            <p className="small">{state.notice}</p>
          </div>
        ) : null}
      </div>

      <input type="hidden" name="next" value={next} />

      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoCapitalize="none"
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
        />
        <p id="password-hint" className="field__hint">
          At least 8 characters.
        </p>
      </div>

      <div className="row">
        <button type="submit" name="intent" value="sign-in" className="button" disabled={pending}>
          {pending ? 'Working…' : 'Sign in'}
        </button>
        <button
          type="submit"
          name="intent"
          value="sign-up"
          className="button button--quiet"
          disabled={pending}
        >
          Create an account
        </button>
      </div>
    </form>
  );
}
