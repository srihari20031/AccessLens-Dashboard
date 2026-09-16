'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { describeTarget, loopStartIndex, type FocusReplayData } from '@/lib/report/focus';
import { pluralise } from '@/lib/format';

const STEP_MS = 900;

/**
 * The keyboard walk rule 2.1.2 recorded, replayable one stop at a time.
 *
 * The whole order is an ordered list that reads completely with no interaction and no
 * JavaScript; Replay and Step only move a highlight through it. After the last stop the
 * highlight goes round the loop once more, which is the argument the mockup makes: focus comes
 * back, and never reaches what follows. Reduced motion jumps straight to the end.
 */
export function FocusReplay({ data }: { data: FocusReplayData }) {
  const headingId = useId();
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [position, setPosition] = useState(-1);
  const [playing, setPlaying] = useState(false);

  const loopStart = loopStartIndex(data);
  const indexes = data.stops.map((_, index) => index);
  const sequence = loopStart >= 0 ? [...indexes, ...indexes.slice(loopStart)] : indexes;
  const last = sequence.length - 1;
  const current = position >= 0 ? sequence[position] : -1;
  const secondPass = position >= data.stops.length;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      const next = position + 1;
      setPosition(next);
      if (next >= last) setPlaying(false);
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, position, last]);

  useEffect(() => {
    if (current >= 0) itemRefs.current[current]?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  if (data.stops.length === 0) return null;

  function replay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPosition(last);
      return;
    }
    setPosition(0);
    setPlaying(last > 0);
  }

  function step() {
    setPosition(position >= last ? 0 : position + 1);
  }

  const inLoop = new Set(data.cycle);
  const trappedWord = data.reason === 'dialog-cycle' ? 'inside what looks like a dialog' : 'in this loop';

  let announcement = '';
  if (current >= 0) {
    announcement = `Stop ${current + 1} of ${data.stops.length}: ${describeTarget(data.stops[current])}.`;
    if (secondPass && current === loopStart) announcement += ' Focus has come back here.';
    if (position === last && loopStart >= 0) announcement += ` Focus stays ${trappedWord}.`;
  }

  return (
    <section className="focus-replay" aria-labelledby={headingId}>
      <h4 id={headingId}>Keyboard focus order</h4>
      <p className="small muted">
        Pressing Tab moved focus through {data.stops.length}{' '}
        {pluralise(data.stops.length, 'element', 'elements')} in this order
        {loopStart >= 0 ? `, then went back to stop ${loopStart + 1} and kept circling` : ''}.
      </p>

      {/* role="list": list-style none drops list semantics in WebKit. */}
      <ol className="focus-replay__stops" role="list">
        {data.stops.map((stop, index) => (
          <li
            key={`${index}:${stop.selector}`}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className="focus-replay__stop"
            data-loop={inLoop.has(stop.selector)}
            aria-current={index === current ? 'step' : undefined}
          >
            <span className="focus-replay__num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <span className="focus-replay__name">{describeTarget(stop)}</span>
              {inLoop.has(stop.selector) ? (
                <span className="focus-replay__note">
                  {index === loopStart ? ' · in the loop, focus returns here' : ' · in the loop'}
                </span>
              ) : null}
              <code className="focus-replay__selector mono xsmall muted">{stop.selector}</code>
            </div>
          </li>
        ))}
      </ol>

      {data.unreached.length > 0 ? (
        <div className="focus-replay__unreached">
          <h5 className="small">
            {data.reason === 'dialog-cycle'
              ? 'Not reached while focus stayed in the dialog'
              : 'Never receives focus'}
          </h5>
          <ul role="list">
            {data.unreached.map((target, index) => (
              <li key={`${index}:${target.selector}`}>
                <span className="focus-replay__name">{describeTarget(target)}</span>
                <code className="focus-replay__selector mono xsmall muted">{target.selector}</code>
              </li>
            ))}
            {data.unreachedTruncated ? <li className="small muted">and more</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="button" onClick={replay}>
          {playing ? 'Pause' : 'Replay traversal'}
        </button>
        <button type="button" className="button button--quiet" onClick={step} disabled={playing}>
          Step
        </button>
      </div>
      <p className="small" aria-live="polite" style={{ marginTop: 'var(--space-2)' }}>
        {announcement}
      </p>
    </section>
  );
}
