'use client';

import { useActionState } from 'react';

import { MAX_EXPLANATIONS_BYTES } from '@/lib/review/explanations';

import { importExplanations } from './actions';
import { EMPTY_EXPLANATIONS_STATE } from './review-state';

/**
 * Upload the AI text for this run.
 *
 * The same shape as the report upload on the Runs page: a labelled file input, a live region
 * for the result, and one sentence naming what happened. The file is validated on the server
 * before anything is stored.
 */
export function ExplanationsForm({ runId, hasSuggestions }: { runId: string; hasSuggestions: boolean }) {
  const [state, formAction, pending] = useActionState(
    importExplanations,
    EMPTY_EXPLANATIONS_STATE,
  );

  return (
    <form action={formAction} className="sheet">
      <div className="sheet__body stack">
        <div className="stack-tight">
          <h2 id="explanations-heading">
            {hasSuggestions ? 'Replace the AI text' : 'Add the AI text'}
          </h2>
          <p className="prose small muted">
            The JSON that{' '}
            <code className="mono">accesslens explain &lt;report.json&gt; --out &lt;file&gt;</code>{' '}
            writes for <em>this run&rsquo;s own report</em>. Suggestions are matched to findings
            by their identity hash, so a file made from another report brings nothing over.
            {hasSuggestions
              ? ' Uploading again replaces the text and leaves every decision where it is — a decision made before the new text arrived is marked as such.'
              : null}
          </p>
        </div>

        <div aria-live="polite">
          {state.error !== null ? (
            <div className="notice notice--error">
              <h3 className="small">That file was not stored</h3>
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
          {state.stored !== null ? (
            <div className="notice notice--ok">
              <p className="small">{state.stored}</p>
            </div>
          ) : null}
        </div>

        <input type="hidden" name="run_id" value={runId} />

        <div className="field">
          <label htmlFor="explanations">Explanations file</label>
          <input
            id="explanations"
            name="explanations"
            type="file"
            accept="application/json,.json"
            required
            aria-describedby="explanations-hint"
          />
          <p id="explanations-hint" className="field__hint">
            A .json file of up to {MAX_EXPLANATIONS_BYTES / (1024 * 1024)} MB.
          </p>
        </div>

        <div>
          <button type="submit" className="button" disabled={pending}>
            {pending ? 'Storing…' : 'Upload explanations'}
          </button>
        </div>
      </div>
    </form>
  );
}
