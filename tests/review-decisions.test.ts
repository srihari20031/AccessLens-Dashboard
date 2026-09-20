import { describe, expect, it } from 'vitest';

import {
  countDecisions,
  DECIDED,
  DECISIONS,
  DECISION_LABELS,
  describeDecision,
  emptyDecisionCounts,
  MAX_EDITED_FIX_CHARS,
  MAX_REASON_CHARS,
  parseDecisionInput,
  reviewedTotal,
  suggestionChangedSinceDecision,
  type ReviewRecord,
} from '@/lib/review/decisions';

function review(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    finding_hash: 'aaaa',
    decision: 'accepted',
    edited_fix: null,
    reason: null,
    decided_by_email: 'reviewer@example.com',
    decided_at: '2026-09-19T10:00:00.000Z',
    ...overrides,
  };
}

function accepted(raw: Parameters<typeof parseDecisionInput>[0]) {
  const result = parseDecisionInput(raw);
  if (!result.ok) throw new Error(`expected success: ${result.error}`);
  return result.value;
}

function refused(raw: Parameters<typeof parseDecisionInput>[0]) {
  const result = parseDecisionInput(raw);
  if (result.ok) throw new Error('expected the decision to be refused');
  return result.error;
}

describe('the decisions a reviewer can record', () => {
  it('has a written-out label for every one', () => {
    for (const decision of DECISIONS) expect(DECISION_LABELS[decision]).toBeTruthy();
  });

  it('does not count "pending" as a choice', () => {
    expect(DECIDED).toEqual(['accepted', 'edited', 'rejected']);
  });
});

describe('validating a submitted decision', () => {
  it.each(DECISIONS)('accepts %s', (decision) => {
    const raw = decision === 'edited' ? { decision, edited_fix: 'alt="A cat"' } : { decision };
    expect(accepted(raw).decision).toBe(decision);
  });

  it.each([['approve'], [''], [null], [undefined], [7]])('refuses %s as a decision', (decision) => {
    expect(refused({ decision })).toMatch(/accept, edit or reject/);
  });

  it('refuses an edit with no text', () => {
    expect(refused({ decision: 'edited', edited_fix: '   ' })).toMatch(/accept it instead/);
  });

  it('refuses an edit over the length the table stores', () => {
    const error = refused({ decision: 'edited', edited_fix: 'x'.repeat(MAX_EDITED_FIX_CHARS + 1) });
    expect(error).toMatch(new RegExp(String(MAX_EDITED_FIX_CHARS)));
  });

  it('refuses a reason over the length the table stores', () => {
    const error = refused({ decision: 'rejected', reason: 'x'.repeat(MAX_REASON_CHARS + 1) });
    expect(error).toMatch(new RegExp(String(MAX_REASON_CHARS)));
  });

  it('keeps the newlines in an edited fix and trims only the ends', () => {
    const value = accepted({ decision: 'edited', edited_fix: '  <a href="#main">\n  Skip\n</a>  ' });
    expect(value.editedFix).toBe('<a href="#main">\n  Skip\n</a>');
  });

  it('keeps an edit only for an edited decision', () => {
    expect(accepted({ decision: 'accepted', edited_fix: 'a draft' }).editedFix).toBeNull();
    expect(accepted({ decision: 'rejected', edited_fix: 'a draft' }).editedFix).toBeNull();
  });

  it('keeps a reason only for a rejection, and only when one was given', () => {
    expect(accepted({ decision: 'rejected', reason: 'Wrong element.' }).reason).toBe('Wrong element.');
    expect(accepted({ decision: 'rejected', reason: '  ' }).reason).toBeNull();
    expect(accepted({ decision: 'accepted', reason: 'Wrong element.' }).reason).toBeNull();
  });
});

describe('counting what has been decided', () => {
  it('counts a suggestion with no decision as not yet reviewed', () => {
    const counts = countDecisions(['a', 'b', 'c'], [review({ finding_hash: 'a' })]);
    expect(counts).toEqual({ ...emptyDecisionCounts(), accepted: 1, pending: 2 });
  });

  it('counts each decision under its own name', () => {
    const counts = countDecisions(
      ['a', 'b', 'c', 'd'],
      [
        review({ finding_hash: 'a', decision: 'accepted' }),
        review({ finding_hash: 'b', decision: 'edited', edited_fix: 'x' }),
        review({ finding_hash: 'c', decision: 'rejected' }),
        review({ finding_hash: 'd', decision: 'pending' }),
      ],
    );
    expect(counts).toEqual({ accepted: 1, edited: 1, rejected: 1, pending: 1 });
    expect(reviewedTotal(counts)).toBe(3);
  });

  it('counts nothing for a decision whose suggestion is gone', () => {
    const counts = countDecisions([], [review({ finding_hash: 'a' })]);
    expect(counts).toEqual(emptyDecisionCounts());
    expect(reviewedTotal(counts)).toBe(0);
  });
});

describe('a decision older than the text it is about', () => {
  it('is reported when the suggestion was imported after the decision', () => {
    expect(
      suggestionChangedSinceDecision('2026-09-19T11:00:00Z', '2026-09-19T10:00:00Z'),
    ).toBe(true);
  });

  it('is not reported when the decision came last, or at the same instant', () => {
    expect(suggestionChangedSinceDecision('2026-09-19T10:00:00Z', '2026-09-19T11:00:00Z')).toBe(false);
    expect(suggestionChangedSinceDecision('2026-09-19T10:00:00Z', '2026-09-19T10:00:00Z')).toBe(false);
  });

  it('says nothing when there is no decision, or a timestamp cannot be read', () => {
    expect(suggestionChangedSinceDecision('2026-09-19T11:00:00Z', null)).toBe(false);
    expect(suggestionChangedSinceDecision('not a date', '2026-09-19T10:00:00Z')).toBe(false);
    expect(suggestionChangedSinceDecision('2026-09-19T11:00:00Z', 'not a date')).toBe(false);
  });
});

describe('describing a decision', () => {
  const plain = (iso: string) => iso;

  it('names the state, the reviewer and the time', () => {
    expect(describeDecision(review({ decision: 'edited', edited_fix: 'x' }), plain)).toBe(
      'Accepted with edits by reviewer@example.com on 2026-09-19T10:00:00.000Z.',
    );
  });

  it('falls back to a phrase when no email was recorded', () => {
    expect(describeDecision(review({ decided_by_email: null }), plain)).toMatch(
      /by the signed-in reviewer/,
    );
  });

  it.each([null, review({ decision: 'pending' })])('reads no decision as not yet reviewed', (given) => {
    expect(describeDecision(given, plain)).toMatch(/^Not yet reviewed\./);
  });
});
