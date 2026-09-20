import { pluralise } from '@/lib/format';
import {
  PATCH_DECISIONS,
  PATCH_DECISION_LABELS,
  type PatchDecisionCounts,
} from '@/lib/review/patch-decisions';

/**
 * How many proposed edits are accepted, rejected, applied and still waiting.
 *
 * A table of numbers with the decision written out in words in a row header: no colour, no
 * progress bar, no percentage — the same construction as `ReviewSummary`, for the same reason.
 * It is not a score of anything. A rejected patch is not a worse outcome than an accepted one,
 * and none of these numbers says anything about the findings themselves.
 */
export function PatchSummary({
  counts,
  caption,
}: {
  counts: PatchDecisionCounts;
  caption: string;
}) {
  const total = PATCH_DECISIONS.reduce((sum, decision) => sum + counts[decision], 0);

  return (
    <div className="sheet table-scroll">
      <table className="data-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Decision on the proposed edit</th>
            <th scope="col" className="num">
              Patches
            </th>
          </tr>
        </thead>
        <tbody>
          {PATCH_DECISIONS.map((decision) => (
            <tr key={decision}>
              <th scope="row" style={{ fontWeight: 400 }}>
                {PATCH_DECISION_LABELS[decision]}
              </th>
              <td className="num">{counts[decision]}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total with a patch</th>
            <td className="num">{total}</td>
          </tr>
        </tbody>
      </table>
      <p className="sheet__body xsmall muted">
        {total} {pluralise(total, 'finding carries', 'findings carry')} a proposed edit or a
        question in this run. These counts describe the proposals only. No finding&rsquo;s
        outcome, severity or band is affected by any decision recorded here, and no file is
        changed by one.
      </p>
    </div>
  );
}
