import { describe, expect, it } from 'vitest';

import {
  countPatchDecisions,
  describePatchDecision,
  emptyPatchDecisionCounts,
  MAX_PATCH_REASON_CHARS,
  parsePatchDecisionInput,
  patchChangedSinceDecision,
  patchesReviewedTotal,
  PATCH_DECIDED,
  PATCH_DECISION_LABELS,
  PATCH_DECISION_SHORT_LABELS,
  PATCH_DECISIONS,
  type PatchReviewRecord,
} from '@/lib/review/patch-decisions';

function review(overrides: Partial<PatchReviewRecord> = {}): PatchReviewRecord {
  return {
    finding_hash: 'aaaa',
    decision: 'accepted',
    reason: null,
    decided_by_email: 'reviewer@example.com',
    decided_at: '2026-09-19T10:00:00.000Z',
    ...overrides,
  };
}

function accepted(raw: Parameters<typeof parsePatchDecisionInput>[0]) {
  const result = parsePatchDecisionInput(raw);
  if (!result.ok) throw new Error(`expected success: ${result.error}`);
  return result.value;
}

function refused(raw: Parameters<typeof parsePatchDecisionInput>[0]) {
  const result = parsePatchDecisionInput(raw);
  if (result.ok) throw new Error('expected the decision to be refused');
  return result.error;
}

describe('the decisions a reviewer can record about a patch', () => {
  it('has a written-out label for every one, long and short', () => {
    for (const decision of PATCH_DECISIONS) {
      expect(PATCH_DECISION_LABELS[decision]).toBeTruthy();
      expect(PATCH_DECISION_SHORT_LABELS[decision]).toBeTruthy();
    }
  });

  it('does not count "pending" as a choice', () => {
    expect(PATCH_DECIDED).toEqual(['accepted', 'rejected', 'applied']);
  });

  it('says "applied" is something the person did, not something the dashboard did', () => {
    expect(PATCH_DECISION_LABELS.applied).toMatch(/your own copy/i);
  });
});

describe('validating one submitted decision', () => {
  it.each(PATCH_DECISIONS)('accepts %s', (decision) => {
    expect(accepted({ decision }).decision).toBe(decision);
  });

  it.each([undefined, '', 'applied-by-the-dashboard', 'edited', 42])(
    'refuses %s as a decision',
    (decision) => {
      expect(refused({ decision })).toMatch(/accept, reject/i);
    },
  );

  it('keeps a reason only on a rejection', () => {
    expect(accepted({ decision: 'rejected', reason: 'the markup is generated' }).reason).toBe(
      'the markup is generated',
    );
    expect(accepted({ decision: 'accepted', reason: 'ignored' }).reason).toBeNull();
    expect(accepted({ decision: 'applied', reason: 'ignored' }).reason).toBeNull();
  });

  it('reads a blank reason as none', () => {
    expect(accepted({ decision: 'rejected', reason: '   ' }).reason).toBeNull();
  });

  it('refuses a reason over the cap the table enforces', () => {
    const error = refused({ decision: 'rejected', reason: 'x'.repeat(MAX_PATCH_REASON_CHARS + 1) });
    expect(error).toMatch(new RegExp(String(MAX_PATCH_REASON_CHARS)));
  });
});

describe('counting where the patches stand', () => {
  it('counts a patch with no decision row as not yet reviewed', () => {
    const counts = countPatchDecisions(['a', 'b', 'c'], [review({ finding_hash: 'a' })]);
    expect(counts).toEqual({ pending: 2, accepted: 1, rejected: 0, applied: 0 });
  });

  it('counts a decision whose patch is gone nowhere at all', () => {
    const counts = countPatchDecisions(['a'], [review({ finding_hash: 'z' })]);
    expect(counts).toEqual({ ...emptyPatchDecisionCounts(), pending: 1 });
  });

  it('adds up only the decided ones as progress', () => {
    const counts = countPatchDecisions(
      ['a', 'b', 'c', 'd'],
      [
        review({ finding_hash: 'a', decision: 'accepted' }),
        review({ finding_hash: 'b', decision: 'rejected' }),
        review({ finding_hash: 'c', decision: 'applied' }),
      ],
    );
    expect(patchesReviewedTotal(counts)).toBe(3);
  });
});

describe('a decision older than the patch it is about', () => {
  it('is spotted when the patch was imported after the decision', () => {
    expect(
      patchChangedSinceDecision('2026-09-19T12:00:00.000Z', '2026-09-19T10:00:00.000Z'),
    ).toBe(true);
  });

  it('is not claimed when the decision came later', () => {
    expect(
      patchChangedSinceDecision('2026-09-19T08:00:00.000Z', '2026-09-19T10:00:00.000Z'),
    ).toBe(false);
  });

  it('says nothing when there is no decision, or no readable time', () => {
    expect(patchChangedSinceDecision('2026-09-19T12:00:00.000Z', null)).toBe(false);
    expect(patchChangedSinceDecision('not a time', '2026-09-19T10:00:00.000Z')).toBe(false);
  });
});

describe('describing a decision in one sentence', () => {
  it('says plainly when nobody has decided', () => {
    expect(describePatchDecision(null, (iso) => iso)).toMatch(/Not yet reviewed/);
    expect(describePatchDecision(review({ decision: 'pending' }), (iso) => iso)).toMatch(
      /Not yet reviewed/,
    );
  });

  it('names the person and the time', () => {
    const sentence = describePatchDecision(review({ decision: 'applied' }), (iso) => iso);
    expect(sentence).toContain('reviewer@example.com');
    expect(sentence).toContain('2026-09-19T10:00:00.000Z');
  });

  it('falls back to a phrase rather than inventing a name', () => {
    const sentence = describePatchDecision(review({ decided_by_email: null }), (iso) => iso);
    expect(sentence).toContain('the signed-in reviewer');
  });
});
