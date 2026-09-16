/**
 * Replay data for rule 2.1.2 (No Keyboard Trap).
 *
 * From rule version 1.1.0 the CLI records the keyboard walk itself in the finding's
 * evidence: every stop in the order Tab reached it, the loop focus got caught in, and — only
 * when it was trapped — the tabbable elements it never reached. This reads that evidence
 * defensively, because an uploaded file is untrusted and older reports have no `stops`.
 *
 * Nothing here decides anything. The rule already did; this only shapes its record for display.
 */

export type FocusTargetView = { selector: string; tag: string; snippet: string };

export type FocusReplayData = {
  reason: string;
  /** Every stop, in first-visit order. */
  stops: FocusTargetView[];
  /** Selectors of the loop, in loop order; empty when focus never looped. */
  cycle: string[];
  /** Elements focus never reached; only ever filled for a trapped walk. */
  unreached: FocusTargetView[];
  unreachedTruncated: boolean;
};

/** Evidence keys the replay shows, so the finding card does not list them a second time. */
export const REPLAY_EVIDENCE_KEYS: readonly string[] = [
  'stops',
  'cycle',
  'unreached',
  'unreached_truncated',
];

function readTargets(value: unknown): FocusTargetView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { selector, tag, snippet } = entry as Record<string, unknown>;
    return typeof selector === 'string' && typeof tag === 'string' && typeof snippet === 'string'
      ? [{ selector, tag, snippet }]
      : [];
  });
}

export function readFocusReplay(finding: {
  rule_id: string;
  evidence: Record<string, unknown>;
}): FocusReplayData | null {
  if (finding.rule_id !== 'no-keyboard-trap') return null;
  const { evidence } = finding;
  if (!Array.isArray(evidence.stops)) return null;
  return {
    reason: typeof evidence.reason === 'string' ? evidence.reason : '',
    stops: readTargets(evidence.stops),
    cycle: Array.isArray(evidence.cycle)
      ? evidence.cycle.filter((entry): entry is string => typeof entry === 'string')
      : [],
    unreached: readTargets(evidence.unreached),
    unreachedTruncated: evidence.unreached_truncated === true,
  };
}

/** Index of the stop focus kept returning to, or -1 when there was no loop. */
export function loopStartIndex(data: FocusReplayData): number {
  if (data.cycle.length === 0) return -1;
  return data.stops.findIndex((stop) => stop.selector === data.cycle[0]);
}

const NAME_LIMIT = 60;

/** A short human name: the tag, and the element's visible text when the snippet has any. */
export function describeTarget(target: FocusTargetView): string {
  const text = target.snippet
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return target.tag;
  const short = text.length > NAME_LIMIT ? `${text.slice(0, NAME_LIMIT).trimEnd()}…` : text;
  return `${target.tag} “${short}”`;
}
