'use client';

import { useActionState } from 'react';

import { MAX_PATCHES_BYTES } from '@/lib/review/patches';

import { importPatches } from './actions';
import { EMPTY_PATCH_IMPORT_STATE } from './patch-state';

/**
 * Upload the patch file for this run.
 *
 * The same shape as the explanations upload on the Fix review screen: a labelled file input, a
 * live region for the result, and one sentence naming what happened. The file is validated on
 * the server before anything is stored.
 */
export function PatchesForm({ runId, hasPatches }: { runId: string; hasPatches: boolean }) {
  const [state, formAction, pending] = useActionState(importPatches, EMPTY_PATCH_IMPORT_STATE);

  return (
    <form action={formAction} className="sheet" aria-labelledby="patches-upload-heading">
      <div className="sheet__body stack">
        <div className="stack-tight">
          <h2 id="patches-upload-heading">
            {hasPatches ? 'Replace the patch set' : 'Add the patch set'}
          </h2>
          <p className="prose small muted">
            The JSON that{' '}
            <code className="mono">
              accesslens fix &lt;report.json&gt; --json &lt;file&gt;
            </code>{' '}
            writes for <em>this run&rsquo;s own report</em>. Patches are matched to findings by
            their identity hash, so a file made from another report brings nothing over.
            {hasPatches
              ? ' Uploading again replaces the patches and leaves every decision where it is — a decision made before the new patch arrived is marked as such.'
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
          <label htmlFor="patches">Patch file</label>
          <input
            id="patches"
            name="patches"
            type="file"
            accept="application/json,.json"
            required
            aria-describedby="patches-hint"
          />
          <p id="patches-hint" className="field__hint">
            A .json file of up to {MAX_PATCHES_BYTES / (1024 * 1024)} MB. Uploading it stores the
            proposed edits as text; it does not edit anything.
          </p>
        </div>

        <div>
          <button type="submit" className="button" disabled={pending}>
            {pending ? 'Storing…' : 'Upload patch set'}
          </button>
        </div>
      </div>
    </form>
  );
}
