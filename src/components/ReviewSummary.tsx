import { DECISIONS, DECISION_LABELS, type DecisionCounts } from '@/lib/review/decisions';
import { pluralise } from '@/lib/format';

/**
 * How many suggested fixes are accepted, edited, rejected and still waiting.
 *
 * A table of numbers with the decision written out in words in a row header: no colour, no
 * progress bar, no percentage. It is not a score of anything — a rejected suggestion is not a
 * worse outcome than an accepted one, and none of these numbers says anything about the
 * findings themselves.
 */
export function ReviewSummary({
  counts,
  caption,
}: {
  counts: DecisionCounts;
  caption: string;
}) {
  const total = DECISIONS.reduce((sum, decision) => sum + counts[decision], 0);

  return (
    <div className="sheet table-scroll">
      <table className="data-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Decision on the suggested text</th>
            <th scope="col" className="num">
              Suggestions
            </th>
          </tr>
        </thead>
        <tbody>
          {DECISIONS.map((decision) => (
            <tr key={decision}>
              <th scope="row" style={{ fontWeight: 400 }}>
                {DECISION_LABELS[decision]}
              </th>
              <td className="num">{counts[decision]}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total with AI text</th>
            <td className="num">{total}</td>
          </tr>
        </tbody>
      </table>
      <p className="sheet__body xsmall muted">
        {total} {pluralise(total, 'finding carries', 'findings carry')} AI text in this run.
        These counts describe the text only. No finding&rsquo;s outcome, severity or band is
        affected by any decision recorded here.
      </p>
    </div>
  );
}
