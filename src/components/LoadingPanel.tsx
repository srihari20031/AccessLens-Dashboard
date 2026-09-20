/**
 * What a screen shows while its data is being read.
 *
 * Every screen here is a Server Component that waits on Supabase, and until now a
 * navigation showed the previous page until the new one was ready — on a crawl with a few
 * thousand findings that is a long, silent pause with nothing to say it is working.
 *
 * It is text, not a shimmer: the bars are a placeholder for a layout, and a placeholder
 * that animates is movement an audit tool has nothing to gain from (the reduced-motion rule
 * in globals.css stops the rest). `role="status"` with `aria-live="polite"` is how the wait
 * reaches a screen reader, and the bars are hidden from it because they say nothing the
 * sentence does not.
 */
export function LoadingPanel({ what }: { what: string }) {
  return (
    <div className="stack">
      <p className="lede" role="status">
        Loading {what}…
      </p>
      <div className="sheet" aria-hidden="true">
        <div className="sheet__body stack-tight">
          <span className="placeholder-bar" style={{ width: '38%' }} />
          <span className="placeholder-bar" style={{ width: '62%' }} />
          <span className="placeholder-bar" style={{ width: '50%' }} />
        </div>
      </div>
    </div>
  );
}
