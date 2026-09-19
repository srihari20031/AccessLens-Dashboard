'use client';

import { useActionState } from 'react';

import { openAuditResults } from './audit-actions';
import { EMPTY_OPEN_RESULTS_STATE } from './audit-state';

/** The "Open results" button for one finished audit, with its own announced error. */
export function OpenResultsForm({ jobId, url }: { jobId: string; url: string }) {
  const [state, formAction, pending] = useActionState(openAuditResults, EMPTY_OPEN_RESULTS_STATE);

  return (
    <form action={formAction} className="stack-tight">
      <input type="hidden" name="job_id" value={jobId} />
      <div>
        <button type="submit" className="button button--quiet" disabled={pending}>
          {pending ? 'Opening…' : 'Open results'}
          <span className="visually-hidden"> of the audit of {url}</span>
        </button>
      </div>
      <div aria-live="polite">
        {state.error !== null ? (
          <div className="notice notice--error">
            <p className="small">{state.error}</p>
            {state.issues.length > 0 ? (
              <ul className="notice__issues">
                {state.issues.map((issue) => (
                  <li key={issue} className="mono">
                    {issue}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}
