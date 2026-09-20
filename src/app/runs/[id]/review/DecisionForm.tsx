'use client';

import { useActionState, useId } from 'react';

import {
  MAX_EDITED_FIX_CHARS,
  MAX_REASON_CHARS,
  type ReviewRecord,
} from '@/lib/review/decisions';

import { recordDecision } from './actions';
import { EMPTY_DECISION_STATE } from './review-state';

/**
 * Accept, edit or reject one suggested fix.
 *
 * One form with several submit buttons, each carrying its own `decision` value. That is
 * deliberate: it is one tab sequence rather than three nested forms, every button is a real
 * submit button, and the whole thing works with JavaScript off — the edit and reject panels
 * are `<details>` elements, which are keyboard-operable without a line of script.
 *
 * The buttons repeat on every finding, so each one carries a visually-hidden phrase naming
 * which finding it acts on: "Accept as written" is useless in a list of buttons read out on
 * its own.
 */
export function DecisionForm({
  runId,
  findingHash,
  criterion,
  selector,
  suggestedFix,
  review,
}: {
  runId: string;
  findingHash: string;
  /** For the visually-hidden context on each button, e.g. "1.4.3". */
  criterion: string;
  selector: string;
  /** The model's fix, used to start the edit box off when there is no edit yet. */
  suggestedFix: string;
  review: ReviewRecord | null;
}) {
  const [state, formAction, pending] = useActionState(recordDecision, EMPTY_DECISION_STATE);
  const ids = useId();
  const editId = `${ids}-edit`;
  const editHintId = `${ids}-edit-hint`;
  const reasonId = `${ids}-reason`;
  const reasonHintId = `${ids}-reason-hint`;

  const about = `the suggestion for ${criterion} on ${selector}`;
  const decided = review !== null && review.decision !== 'pending';

  return (
    <form action={formAction} className="decision">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="finding_hash" value={findingHash} />

      <fieldset className="decision__set">
        <legend>Your decision on the suggested text</legend>

        <div className="row decision__buttons">
          <button type="submit" name="decision" value="accepted" className="button" disabled={pending}>
            Accept as written
            <span className="visually-hidden"> — {about}</span>
          </button>
          {decided ? (
            <button
              type="submit"
              name="decision"
              value="pending"
              className="button button--quiet"
              disabled={pending}
            >
              Clear this decision
              <span className="visually-hidden"> — {about}</span>
            </button>
          ) : null}
        </div>

        <details className="decision__panel" open={review?.decision === 'edited'}>
          <summary>
            Edit the suggested fix
            <span className="visually-hidden"> — {about}</span>
          </summary>
          <div className="decision__panel-body stack-tight">
            <label htmlFor={editId}>Your wording of the fix</label>
            <textarea
              id={editId}
              name="edited_fix"
              rows={8}
              maxLength={MAX_EDITED_FIX_CHARS}
              defaultValue={review?.edited_fix ?? suggestedFix}
              aria-describedby={editHintId}
              spellCheck={false}
            />
            <p id={editHintId} className="field__hint">
              Saved as your own text, alongside the model&rsquo;s. Up to {MAX_EDITED_FIX_CHARS}{' '}
              characters. It is recorded for whoever does the work; nothing here edits the page
              or the finding.
            </p>
            <div>
              <button type="submit" name="decision" value="edited" className="button" disabled={pending}>
                Save my edit
                <span className="visually-hidden"> of {about}</span>
              </button>
            </div>
          </div>
        </details>

        <details className="decision__panel" open={review?.decision === 'rejected'}>
          <summary>
            Reject the suggestion
            <span className="visually-hidden"> — {about}</span>
          </summary>
          <div className="decision__panel-body stack-tight">
            <label htmlFor={reasonId}>Why it was rejected (optional)</label>
            <textarea
              id={reasonId}
              name="reason"
              rows={3}
              maxLength={MAX_REASON_CHARS}
              defaultValue={review?.reason ?? ''}
              aria-describedby={reasonHintId}
            />
            <p id={reasonHintId} className="field__hint">
              Up to {MAX_REASON_CHARS} characters. Rejecting the text does not dismiss the
              finding: it stays exactly as the scanner reported it.
            </p>
            <div>
              <button
                type="submit"
                name="decision"
                value="rejected"
                className="button button--danger"
                disabled={pending}
              >
                Reject this suggestion
                <span className="visually-hidden"> — {about}</span>
              </button>
            </div>
          </div>
        </details>
      </fieldset>

      <div aria-live="polite" className="decision__result">
        {pending ? <p className="small muted">Saving…</p> : null}
        {!pending && state.status === 'error' && state.message !== null ? (
          <div className="notice notice--error">
            <p className="small">{state.message}</p>
          </div>
        ) : null}
        {!pending && state.status === 'saved' && state.message !== null ? (
          <p className="small">{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}
