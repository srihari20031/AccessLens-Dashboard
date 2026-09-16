'use client';

import { useActionState } from 'react';

import { uploadReport } from './actions';
import { EMPTY_UPLOAD_STATE } from './upload-state';

export function UploadForm() {
  const [state, formAction, pending] = useActionState(uploadReport, EMPTY_UPLOAD_STATE);

  return (
    <form action={formAction} className="sheet">
      <div className="sheet__body stack">
        <div className="stack-tight">
          <h2 id="upload-heading">Upload a report</h2>
          <p className="prose small muted">
            The JSON that <code className="mono">accesslens scan</code> or{' '}
            <code className="mono">accesslens crawl</code> writes to standard output. The summary
            they write to standard error is not part of it.
          </p>
        </div>

        <div aria-live="polite">
          {state.error !== null ? (
            <div className="notice notice--error">
              <h3 className="small">That report was not stored</h3>
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

        <div className="field">
          <label htmlFor="report">Report file</label>
          <input
            id="report"
            name="report"
            type="file"
            accept="application/json,.json"
            required
            aria-describedby="report-hint"
          />
          <p id="report-hint" className="field__hint">
            A .json file of up to 5 MB.
          </p>
        </div>

        <div className="field">
          <label htmlFor="label">Label (optional)</label>
          <input
            id="label"
            name="label"
            type="text"
            maxLength={120}
            aria-describedby="label-hint"
          />
          <p id="label-hint" className="field__hint">
            Something to recognise this run by later, such as “before the nav rewrite”.
          </p>
        </div>

        <div>
          <button type="submit" className="button" disabled={pending}>
            {pending ? 'Storing…' : 'Upload report'}
          </button>
        </div>
      </div>
    </form>
  );
}
