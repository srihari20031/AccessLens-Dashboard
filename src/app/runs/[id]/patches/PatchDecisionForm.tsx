'use client';

import { useActionState, useId } from 'react';

import {
  MAX_PATCH_REASON_CHARS,
  type PatchReviewRecord,
} from '@/lib/review/patch-decisions';

import { recordPatchDecision } from './actions';
import { EMPTY_PATCH_DECISION_STATE } from './patch-state';

/**
 * Accept, reject or mark applied one proposed edit — or one question.
 *
 * A `needs-input` patch is not an edit: it is a question the tool refuses to answer for
 * anybody. The three decisions are the same for both, because what is being recorded is the
 * same thing — what a person decided to do about this finding's proposal — but the wording
 * follows the subject, because "Accept this edit" over a question is a control that describes
 * something that is not on the screen.
 *
 * The same construction as the Fix review screen's `DecisionForm`: one form with several submit
 * buttons, each carrying its own `decision` value. One tab sequence rather than three nested
 * forms, every button a real submit button, and the whole thing works with JavaScript off —
 * the reject panel is a `<details>` element, which is keyboard-operable without a line of
 * script.
 *
 * The buttons repeat on every patch, so each one carries a visually-hidden phrase naming which
 * patch it acts on: "Accept this edit" is useless in a list of buttons read out on its own.
 */
export function PatchDecisionForm({
  runId,
  findingHash,
  criterion,
  where,
  subject,
  review,
}: {
  runId: string;
  findingHash: string;
  /** For the visually-hidden context on each button, e.g. "1.3.1". */
  criterion: string;
  /** Where the edit lands, e.g. "index.html line 12". */
  where: string;
  /** What is being decided about: a proposed edit, or a question to answer. */
  subject: 'edit' | 'question';
  review: PatchReviewRecord | null;
}) {
  const [state, formAction, pending] = useActionState(
    recordPatchDecision,
    EMPTY_PATCH_DECISION_STATE,
  );
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const reasonHintId = `${ids}-reason-hint`;

  const about = `the patch for ${criterion} at ${where}`;
  const decided = review !== null && review.decision !== 'pending';
  const question = subject === 'question';

  return (
    <form action={formAction} className="decision">
      <input type="hidden" name="run_id" value={runId} />
      <input type="hidden" name="finding_hash" value={findingHash} />

      <fieldset className="decision__set">
        <legend>Your decision on this {question ? 'question' : 'proposed edit'}</legend>

        <div className="row decision__buttons">
          <button
            type="submit"
            name="decision"
            value="accepted"
            className="button"
            disabled={pending}
          >
            {question ? 'Accept this as work to do' : 'Accept this edit'}
            <span className="visually-hidden"> — {about}</span>
          </button>
          {/*
            Offered on every patch, including a question and a finding no generator could
            write an edit for: "applied" is a person saying they have made the change in their
            own copy, whoever worked out what the change should be. It is never a claim that
            this dashboard did anything to a file.
          */}
          <button
            type="submit"
            name="decision"
            value="applied"
            className="button button--quiet"
            disabled={pending}
          >
            {question ? 'I have answered it' : 'I have applied it'}
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

        <details className="decision__panel" open={review?.decision === 'rejected'}>
          <summary>
            {question ? 'Reject this question' : 'Reject this edit'}
            <span className="visually-hidden"> — {about}</span>
          </summary>
          <div className="decision__panel-body stack-tight">
            <label htmlFor={reasonId}>Why it was rejected (optional)</label>
            <textarea
              id={reasonId}
              name="reason"
              rows={3}
              maxLength={MAX_PATCH_REASON_CHARS}
              defaultValue={review?.reason ?? ''}
              aria-describedby={reasonHintId}
            />
            <p id={reasonHintId} className="field__hint">
              Up to {MAX_PATCH_REASON_CHARS} characters. Rejecting this does not dismiss the
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
                {question ? 'Reject this question' : 'Reject this edit'}
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
