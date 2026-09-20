import { BANDS, BAND_LABELS, type Band } from '@/lib/report/bands';
import type { HistoryRun, TimelineEntry } from '@/lib/report/history';
import { formatDate } from '@/lib/format';

/*
 * Band counts over a site's runs, as four small charts — one per band — on one shared scale.
 *
 * Not one stacked bar per run. The band colours are chosen for text contrast, and as chart
 * fills serious and moderate are nearly indistinguishable under protanopia (checked with the
 * dataviz palette validator: ΔE 0.4). Separate rows, each named in words, need no colour to
 * tell bands apart. The shared scale keeps bars comparable across rows, and the review row
 * sits last under its own note because a review is not a lesser failure.
 *
 * Every figure here is also in the table on the same page, which is the accessible view;
 * each chart carries a text summary, and each bar a native tooltip.
 */

const ROW_HEIGHT = 72;
const LABEL_SPACE = 18; // under the baseline, for run numbers
const VALUE_SPACE = 16; // above the tallest bar, for its count
const SLOT = 44;
const WIDE_SLOT = 108; // when there are few runs; see `slotFor`
const BAR_RATIO = 0.45;

/*
 * How much width one run gets.
 *
 * At the narrow slot a site with two runs drew a 88px chart against 900px of empty row, which
 * read as something that had failed to load rather than as a small chart. Below eight runs the
 * slot widens to fill a useful part of the row, and from eight it goes back to the narrow one
 * so a long history still fits without scrolling.
 */
function slotFor(runs: number): number {
  if (runs >= 8) return SLOT;
  return Math.min(WIDE_SLOT, Math.max(SLOT, Math.floor(560 / Math.max(runs, 1))));
}

export function HistoryChart<T extends HistoryRun>({
  timeline,
}: {
  timeline: TimelineEntry<T>[];
}) {
  const max = Math.max(1, ...timeline.flatMap((entry) => BANDS.map((b) => entry.run.site_bands[b])));
  const slot = slotFor(timeline.length);
  const bar = Math.round(slot * BAR_RATIO);
  const width = Math.max(timeline.length * slot, slot * 2);

  return (
    <div className="history-chart">
      {BANDS.map((band) => (
        <figure key={band} className={`history-chart__row band-${band}`}>
          <figcaption className="history-chart__label">
            {BAND_LABELS[band]}
            {band === 'needs-manual-review' ? (
              <span className="xsmall muted"> — not failures</span>
            ) : null}
          </figcaption>
          <div className="history-chart__plot">
            <svg
              role="img"
              aria-label={summary(band, timeline)}
              viewBox={`0 0 ${width} ${ROW_HEIGHT + VALUE_SPACE + LABEL_SPACE}`}
              width={width}
              height={ROW_HEIGHT + VALUE_SPACE + LABEL_SPACE}
            >
              <line
                x1={0}
                x2={width}
                y1={VALUE_SPACE + ROW_HEIGHT}
                y2={VALUE_SPACE + ROW_HEIGHT}
                className="history-chart__baseline"
              />
              {timeline.map((entry, index) => {
                const value = entry.run.site_bands[band];
                const height = (value / max) * ROW_HEIGHT;
                const x = index * slot + (slot - bar) / 2;
                const baseline = VALUE_SPACE + ROW_HEIGHT;
                const tip = `Run #${entry.number}, ${formatDate(entry.run.created_at)}: ${value} ${BAND_LABELS[band].toLowerCase()}`;
                return (
                  <g key={entry.run.id}>
                    <title>{tip}</title>
                    {/* A hit area the full height of the slot, larger than the bar itself. */}
                    <rect x={index * slot} y={0} width={slot} height={baseline} fill="transparent" />
                    {value > 0 ? (
                      <path d={roundedTopBar(x, baseline, bar, height)} className="history-chart__bar" />
                    ) : null}
                    <text
                      x={x + bar / 2}
                      y={baseline - height - 4}
                      textAnchor="middle"
                      className="history-chart__value"
                    >
                      {value}
                    </text>
                    <text
                      x={x + bar / 2}
                      y={baseline + LABEL_SPACE - 4}
                      textAnchor="middle"
                      className="history-chart__tick"
                    >
                      #{entry.number}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </figure>
      ))}
    </div>
  );
}

/** A bar anchored to the baseline with its data end rounded (radius 4, or less if short). */
function roundedTopBar(x: number, baseline: number, width: number, height: number): string {
  const r = Math.min(4, height, width / 2);
  const top = baseline - height;
  return [
    `M ${x} ${baseline}`,
    `V ${top + r}`,
    `Q ${x} ${top} ${x + r} ${top}`,
    `H ${x + width - r}`,
    `Q ${x + width} ${top} ${x + width} ${top + r}`,
    `V ${baseline}`,
    'Z',
  ].join(' ');
}

function summary<T extends HistoryRun>(band: Band, timeline: TimelineEntry<T>[]): string {
  const values = timeline.map((entry) => `run #${entry.number} ${entry.run.site_bands[band]}`);
  return `${BAND_LABELS[band]} by run: ${values.join(', ')}.`;
}
