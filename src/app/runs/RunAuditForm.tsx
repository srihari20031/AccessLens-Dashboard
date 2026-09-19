'use client';

import { useActionState } from 'react';

import { MAX_CRAWL_PAGES } from '@/lib/audit/input';

import { startAudit } from './audit-actions';
import { EMPTY_AUDIT_STATE } from './audit-state';

/** `aria-describedby` for a field: its hint, then its error when there is one. */
function describedBy(hint: string, error: string | undefined, errorId: string): string {
  return error ? `${hint} ${errorId}` : hint;
}

export function RunAuditForm() {
  const [state, formAction, pending] = useActionState(startAudit, EMPTY_AUDIT_STATE);
  const { fieldErrors: errors, values } = state;

  return (
    // React resets the form after the action; the defaults below come from what was submitted,
    // so a rejected form comes back filled in and a started audit comes back empty. The form is
    // not remounted, so focus stays where it was. `noValidate` lets every error come from the
    // server, tied to its field, rather than from a browser bubble that some readers miss.
    <form action={formAction} className="sheet" aria-labelledby="audit-heading" noValidate>
      <div className="sheet__body stack">
        <div className="stack-tight">
          <h2 id="audit-heading">Run an audit</h2>
          <p className="prose small muted">
            A <strong>scan</strong> checks one page. Scanning any public page is fine. A{' '}
            <strong>crawl</strong> follows links within the same site and checks up to{' '}
            {MAX_CRAWL_PAGES} pages; it obeys the site&apos;s robots.txt and needs you to confirm
            you own the site or have permission to crawl it. Results arrive in Your audits below
            and become a run when you open them.
          </p>
        </div>

        <div aria-live="polite">
          {state.status === 'error' && state.message !== null ? (
            <div className="notice notice--error">
              <h3 className="small">The audit was not started</h3>
              <p className="small">{state.message}</p>
            </div>
          ) : null}
          {state.status === 'started' && state.message !== null ? (
            <div className="notice notice--ok">
              <h3 className="small">Audit started</h3>
              <p className="small">{state.message}</p>
            </div>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="audit-url">Page address</label>
          <input
            id="audit-url"
            name="url"
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={2048}
            defaultValue={values.url}
            aria-invalid={errors.url ? true : undefined}
            aria-describedby={describedBy('audit-url-hint', errors.url, 'audit-url-error')}
          />
          <p id="audit-url-hint" className="field__hint">
            A full address starting with http:// or https://, such as https://example.com/.
          </p>
          {errors.url ? (
            <p id="audit-url-error" className="field__error">
              {errors.url}
            </p>
          ) : null}
        </div>

        <fieldset
          className="choice-group"
          aria-invalid={errors.kind ? true : undefined}
          aria-describedby={errors.kind ? 'audit-kind-error' : undefined}
        >
          <legend>What to audit</legend>
          <div className="choice">
            <input
              id="audit-kind-scan"
              name="kind"
              type="radio"
              value="scan"
              defaultChecked={values.kind === 'scan'}
            />
            <label htmlFor="audit-kind-scan">Scan this one page</label>
          </div>
          <div className="choice">
            <input
              id="audit-kind-crawl"
              name="kind"
              type="radio"
              value="crawl"
              defaultChecked={values.kind === 'crawl'}
            />
            <label htmlFor="audit-kind-crawl">
              Crawl the site from this page, up to {MAX_CRAWL_PAGES} pages
            </label>
          </div>
          {errors.kind ? (
            <p id="audit-kind-error" className="field__error">
              {errors.kind}
            </p>
          ) : null}
        </fieldset>

        <div className="field">
          <label htmlFor="audit-max-pages">Most pages to crawl</label>
          <input
            id="audit-max-pages"
            name="max_pages"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_CRAWL_PAGES}
            step={1}
            defaultValue={values.max_pages}
            aria-invalid={errors.max_pages ? true : undefined}
            aria-describedby={describedBy(
              'audit-max-pages-hint',
              errors.max_pages,
              'audit-max-pages-error',
            )}
          />
          <p id="audit-max-pages-hint" className="field__hint">
            For a crawl only: 1 to {MAX_CRAWL_PAGES}. A scan always checks one page.
          </p>
          {errors.max_pages ? (
            <p id="audit-max-pages-error" className="field__error">
              {errors.max_pages}
            </p>
          ) : null}
        </div>

        <div className="field">
          <div className="choice">
            <input
              id="audit-permission"
              name="permission"
              type="checkbox"
              defaultChecked={values.permission}
              aria-invalid={errors.permission ? true : undefined}
              aria-describedby={describedBy(
                'audit-permission-hint',
                errors.permission,
                'audit-permission-error',
              )}
            />
            <label htmlFor="audit-permission">
              I own this site or have permission to crawl it
            </label>
          </div>
          <p id="audit-permission-hint" className="field__hint">
            Required for a crawl. Not needed to scan one page.
          </p>
          {errors.permission ? (
            <p id="audit-permission-error" className="field__error">
              {errors.permission}
            </p>
          ) : null}
        </div>

        <div>
          <button type="submit" className="button" disabled={pending}>
            {pending ? 'Starting…' : 'Run audit'}
          </button>
        </div>
      </div>
    </form>
  );
}
