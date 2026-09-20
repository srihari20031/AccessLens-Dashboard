import { BANDS, BAND_LABELS, failureTotal, type Band, type BandCounts } from '@/lib/report/bands';
import { pluralise } from '@/lib/format';
import { WCAG_TARGET } from '@/lib/wcag';

/**
 * The four band counts, and a sentence saying what they do and do not mean.
 *
 * There is no total, no percentage and no grade here, and there never will be: the project
 * brief rules them out, because a single number invites the reading "this site is 87% accessible",
 * which no automated check can support.
 */
export function BandStrip({
  counts,
  label,
  change,
}: {
  counts: BandCounts;
  label: string;
  /** Per-band change since an earlier run, and a name for that run such as "run #6". */
  change?: { delta: BandCounts; since: string };
}) {
  return (
    <dl className="band-strip" aria-label={label}>
      {BANDS.map((band) => (
        <div key={band} className={`band-strip__cell band-${band}`}>
          <dt className="band-strip__name">{BAND_LABELS[band]}</dt>
          <dd className="band-strip__count" data-zero={counts[band] === 0}>
            {counts[band]}
          </dd>
          {change !== undefined ? (
            <dd className="band-strip__delta">{describeChange(change.delta[band], change.since)}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/*
 * The change is written out in words; the arrow is decoration and hidden from assistive
 * technology. It is deliberately not coloured green or red: fewer findings in a band is not
 * evidence the site improved (a page may simply have gone), and fewer reviews is not good news.
 */
function describeChange(delta: number, since: string) {
  if (delta === 0) return <>No change since {since}</>;
  const size = Math.abs(delta);
  return (
    <>
      <span aria-hidden="true">{delta < 0 ? '▼' : '▲'} </span>
      {size} {delta < 0 ? 'fewer' : 'more'} than {since}
    </>
  );
}

/** Plain language for what the numbers above add up to — and what they do not. */
export function BandSentence({ counts }: { counts: BandCounts }) {
  const failures = failureTotal(counts);
  const review = counts['needs-manual-review'];

  if (failures === 0 && review === 0) {
    return (
      <p className="prose muted">
        The automated checks that ran reported no failures and flagged nothing for review. That is
        not a statement that these pages conform to {WCAG_TARGET} — only twelve success criteria are
        in scope, and much of WCAG cannot be decided by a machine at all.
      </p>
    );
  }

  return (
    <p className="prose muted">
      {failures} {pluralise(failures, 'failure', 'failures')} detected by the automated checks.
      {review > 0 ? (
        <>
          {' '}
          A further {review} {pluralise(review, 'finding needs', 'findings need')} a human
          decision; {pluralise(review, 'it is', 'they are')} not counted as{' '}
          {pluralise(review, 'a failure', 'failures')}.
        </>
      ) : null}
    </p>
  );
}

/**
 * The four band counts as inline chips.
 *
 * What a `data-table` row of counts becomes below 40rem, where the table would have to be
 * scrolled sideways to reach the numbers that matter. Each chip writes its band out in words
 * beside the number — colour is never the only signal — and a zero is drawn quieter than a
 * real number, the same distinction the strip and the tables already make.
 */
export function BandChips({ counts, label }: { counts: BandCounts; label: string }) {
  return (
    <dl className="band-chips" aria-label={label}>
      {BANDS.map((band) => (
        <div key={band} className={`band-chip band-${band}`} data-zero={counts[band] === 0}>
          <dt>{BAND_LABELS[band]}</dt>
          <dd>{counts[band]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BandTag({ band }: { band: Band }) {
  return <span className={`band-tag band-${band}`}>{BAND_LABELS[band]}</span>;
}
