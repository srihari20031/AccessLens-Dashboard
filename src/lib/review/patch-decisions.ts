/**
 * The patch-review decision: what a person decided about a proposed source edit.
 *
 * Pure: no Next.js, no Supabase. The same limits are enforced again by the `patch_reviews`
 * table (migration 0006), so this is for good error messages, not the security boundary.
 *
 * The two rules this module exists to keep:
 *
 *  1. A decision is about the *proposed edit*, never about the finding. Nothing here reads or
 *     produces an outcome, a severity or a band, and nothing downstream may use a decision to
 *     change one. A rejected patch leaves the finding exactly as the scanner reported it.
 *  2. A decision changes nobody's files. "Applied" is a person recording that they made the
 *     edit themselves, in their own working copy; this dashboard never writes to a disk.
 */

export const PATCH_DECISIONS = ['pending', 'accepted', 'rejected', 'applied'] as const;
export type PatchDecision = (typeof PATCH_DECISIONS)[number];

/** The three a reviewer can choose. `pending` is the absence of a decision, not a choice. */
export const PATCH_DECIDED: readonly PatchDecision[] = ['accepted', 'rejected', 'applied'];

/** Never colour alone: every decision is written out in words wherever it is shown. */
export const PATCH_DECISION_LABELS: Record<PatchDecision, string> = {
  pending: 'Not yet reviewed',
  accepted: 'Accepted as the change to make',
  rejected: 'Rejected',
  applied: 'Marked as applied in your own copy',
};

/** Short forms, for a column heading or a count. */
export const PATCH_DECISION_SHORT_LABELS: Record<PatchDecision, string> = {
  pending: 'Not yet reviewed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  applied: 'Applied',
};

/** The same cap as `patch_reviews_sizes` in migration 0006. */
export const MAX_PATCH_REASON_CHARS = 1000;

export type PatchReviewRecord = {
  finding_hash: string;
  decision: PatchDecision;
  reason: string | null;
  decided_by_email: string | null;
  decided_at: string;
};

export type PatchDecisionCounts = Record<PatchDecision, number>;

export function emptyPatchDecisionCounts(): PatchDecisionCounts {
  return { pending: 0, accepted: 0, rejected: 0, applied: 0 };
}

/**
 * How many patches sit in each state.
 *
 * Counted over the patches, not over the decisions: a patch with no row of its own is not yet
 * reviewed, and must show as such rather than vanishing from the totals. A decision whose patch
 * is gone (the file was re-imported without it) is counted nowhere, for the same reason — the
 * screen would not show it either.
 */
export function countPatchDecisions(
  patchHashes: Iterable<string>,
  reviews: Iterable<PatchReviewRecord>,
): PatchDecisionCounts {
  const byHash = new Map<string, PatchDecision>();
  for (const review of reviews) byHash.set(review.finding_hash, review.decision);

  const counts = emptyPatchDecisionCounts();
  for (const hash of patchHashes) counts[byHash.get(hash) ?? 'pending'] += 1;
  return counts;
}

/** Decided one way or another — the progress number, and never a pass/fail of any kind. */
export function patchesReviewedTotal(counts: PatchDecisionCounts): number {
  return PATCH_DECIDED.reduce((total, decision) => total + counts[decision], 0);
}

export type PatchDecisionInput = {
  decision: PatchDecision;
  /** Only for `rejected`, and optional even there. */
  reason: string | null;
};

export type PatchDecisionInputResult =
  | { ok: true; value: PatchDecisionInput }
  | { ok: false; error: string };

export type RawPatchDecisionInput = {
  decision?: unknown;
  reason?: unknown;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Validate one submitted decision.
 *
 * Everything the form can send is checked here: the decision is one of four words, a reason
 * belongs only to a rejection, and it is within the cap the table enforces.
 */
export function parsePatchDecisionInput(raw: RawPatchDecisionInput): PatchDecisionInputResult {
  const decision = asString(raw.decision);
  if (!(PATCH_DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, error: 'Choose accept, reject, or mark the edit applied.' };
  }

  const reason = asString(raw.reason).trim();
  if (decision === 'rejected' && reason.length > MAX_PATCH_REASON_CHARS) {
    return {
      ok: false,
      error: `That reason is ${reason.length} characters, over the ${MAX_PATCH_REASON_CHARS} limit.`,
    };
  }

  return {
    ok: true,
    value: {
      decision: decision as PatchDecision,
      reason: decision === 'rejected' && reason !== '' ? reason : null,
    },
  };
}

/**
 * Whether the patch arrived after the decision was made.
 *
 * Re-importing a patch file replaces the patches in place but leaves decisions alone — deleting
 * somebody's judgement because the tool was re-run would be worse. So the screen says when a
 * decision is older than the edit it is attached to, rather than pretending otherwise. It
 * matters more here than for AI text: a re-run against a changed file can move a patch to a
 * different line, and an "accepted" on the old one would be an accepted edit nobody read.
 * An unreadable timestamp is not evidence of anything, so it says nothing.
 */
export function patchChangedSinceDecision(
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
export function describePatchDecision(
  review: PatchReviewRecord | null,
  formatted: (iso: string) => string,
): string {
  if (review === null || review.decision === 'pending') {
    // "The proposal", not "the edit": a `needs-input` patch is a question, and this sentence
    // is printed under both.
    return 'Not yet reviewed. Nobody has accepted, rejected or applied the proposal below.';
  }
  const who = review.decided_by_email ?? 'the signed-in reviewer';
  return `${PATCH_DECISION_LABELS[review.decision]} by ${who} on ${formatted(review.decided_at)}.`;
}
