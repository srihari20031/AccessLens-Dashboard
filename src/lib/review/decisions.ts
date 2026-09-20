/**
 * The fix-review decision: what a person decided about a suggested fix.
 *
 * Pure: no Next.js, no Supabase. The same limits are enforced again by the `fix_reviews`
 * table (migration 0005), so this is for good error messages, not the security boundary.
 *
 * The one rule this module exists to keep: a decision is about the *suggested text*, never
 * about the finding. Nothing here reads or produces an outcome, a severity or a band, and
 * nothing downstream may use a decision to change one. A rejected suggestion leaves the
 * finding exactly as the scanner reported it.
 */

export const DECISIONS = ['pending', 'accepted', 'edited', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

/** The three a reviewer can choose. `pending` is the absence of a decision, not a choice. */
export const DECIDED: readonly Decision[] = ['accepted', 'edited', 'rejected'];

/** Never colour alone: every decision is written out in words wherever it is shown. */
export const DECISION_LABELS: Record<Decision, string> = {
  pending: 'Not yet reviewed',
  accepted: 'Accepted as written',
  edited: 'Accepted with edits',
  rejected: 'Rejected',
};

/** Short forms, for a column heading or a count. */
export const DECISION_SHORT_LABELS: Record<Decision, string> = {
  pending: 'Not yet reviewed',
  accepted: 'Accepted',
  edited: 'Edited',
  rejected: 'Rejected',
};

/** The same caps as `fix_reviews_sizes` in migration 0005. */
export const MAX_EDITED_FIX_CHARS = 8000;
export const MAX_REASON_CHARS = 1000;

export type ReviewRecord = {
  finding_hash: string;
  decision: Decision;
  edited_fix: string | null;
  reason: string | null;
  decided_by_email: string | null;
  decided_at: string;
};

export type DecisionCounts = Record<Decision, number>;

export function emptyDecisionCounts(): DecisionCounts {
  return { pending: 0, accepted: 0, edited: 0, rejected: 0 };
}

/**
 * How many suggestions sit in each state.
 *
 * Counted over the suggestions, not over the decisions: a finding with a suggestion and no
 * row of its own is not yet reviewed, and must show as such rather than vanishing from the
 * totals. A decision whose suggestion is gone (the AI text was re-imported without it) is
 * counted nowhere, for the same reason — the screen would not show it either.
 */
export function countDecisions(
  suggestionHashes: Iterable<string>,
  reviews: Iterable<ReviewRecord>,
): DecisionCounts {
  const byHash = new Map<string, Decision>();
  for (const review of reviews) byHash.set(review.finding_hash, review.decision);

  const counts = emptyDecisionCounts();
  for (const hash of suggestionHashes) counts[byHash.get(hash) ?? 'pending'] += 1;
  return counts;
}

/** Decided one way or another — the progress number, and never a pass/fail of any kind. */
export function reviewedTotal(counts: DecisionCounts): number {
  return DECIDED.reduce((total, decision) => total + counts[decision], 0);
}

export type DecisionInput = {
  decision: Decision;
  /** Only for `edited`; null for every other decision, so no stale draft is ever shown. */
  editedFix: string | null;
  /** Only for `rejected`, and optional even there. */
  reason: string | null;
};

export type DecisionInputResult =
  | { ok: true; value: DecisionInput }
  | { ok: false; error: string };

export type RawDecisionInput = {
  decision?: unknown;
  edited_fix?: unknown;
  reason?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Validate one submitted decision.
 *
 * Everything the form can send is checked here: the decision is one of four words, an edit
 * carries text, a reason belongs only to a rejection, and both texts are within the caps the
 * table enforces. Newlines survive; only leading and trailing whitespace is trimmed, because
 * a suggested fix is usually a snippet of HTML or CSS spread over several lines.
 */
export function parseDecisionInput(raw: RawDecisionInput): DecisionInputResult {
  const decision = asString(raw.decision);
  if (!(DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, error: 'Choose accept, edit or reject.' };
  }

  const editedFix = asString(raw.edited_fix).trim();
  const reason = asString(raw.reason).trim();

  if (decision === 'edited') {
    if (editedFix === '') {
      return {
        ok: false,
        error: 'Write the fix you would use, then save it. To keep the suggestion as written, accept it instead.',
      };
    }
    if (editedFix.length > MAX_EDITED_FIX_CHARS) {
      return {
        ok: false,
        error: `That edit is ${editedFix.length} characters, over the ${MAX_EDITED_FIX_CHARS} limit.`,
      };
    }
  }

  if (decision === 'rejected' && reason.length > MAX_REASON_CHARS) {
    return {
      ok: false,
      error: `That reason is ${reason.length} characters, over the ${MAX_REASON_CHARS} limit.`,
    };
  }

  return {
    ok: true,
    value: {
      decision: decision as Decision,
      editedFix: decision === 'edited' ? editedFix : null,
      reason: decision === 'rejected' && reason !== '' ? reason : null,
    },
  };
}

/**
 * Whether the AI text arrived after the decision was made.
 *
 * Re-importing an explanations file replaces the text in place but leaves decisions alone —
 * deleting somebody's judgement because a model was re-run would be worse. So the screen says
 * when a decision is older than the text it is attached to, rather than pretending otherwise.
 * An unreadable timestamp is not evidence of anything, so it says nothing.
 */
export function suggestionChangedSinceDecision(
  importedAt: string,
  decidedAt: string | null,
): boolean {
  if (decidedAt === null) return false;
  const imported = Date.parse(importedAt);
  const decided = Date.parse(decidedAt);
  if (Number.isNaN(imported) || Number.isNaN(decided)) return false;
  return imported > decided;
}

/** One sentence naming the state, who set it and when. Shown as text, never as markup. */
export function describeDecision(
  review: ReviewRecord | null,
  formatted: (iso: string) => string,
): string {
  if (review === null || review.decision === 'pending') {
    return 'Not yet reviewed. The suggested text below has not been accepted, edited or rejected by anyone.';
  }
  const who = review.decided_by_email ?? 'the signed-in reviewer';
  return `${DECISION_LABELS[review.decision]} by ${who} on ${formatted(review.decided_at)}.`;
}
