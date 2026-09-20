/**
 * The before and after of one proposed edit.
 *
 * Two labelled blocks, never one merged view. A merged diff needs a per-character or per-line
 * comparison to be readable, and every way of drawing one — a background tint, a red/green
 * pair, a strikethrough — leans on something other than words. Two blocks, each with its own
 * heading saying what it is, are unambiguous to a screen reader, at 320px, in high contrast
 * mode, and to anyone who does not see the difference between the two edge colours.
 *
 * Both texts are raw markup lifted out of somebody's HTML file, possibly drafted by a language
 * model. They land in a text node inside a `<code>` element, which React escapes: this file
 * has no `dangerouslySetInnerHTML`, and nothing in this project may.
 */

type Side = {
  heading: string;
  /** "−" or "+", decorative. The heading is what carries the meaning. */
  marker: string;
  text: string;
  /** Shown instead of an empty block, because empty means something here. */
  emptyNote: string;
  kind: 'old' | 'new';
};

function DiffSide({ side }: { side: Side }) {
  return (
    <div className={`diff__side diff__side--${side.kind}`}>
      <h5 className="diff__label">
        <span className="diff__marker" aria-hidden="true">
          {side.marker}
        </span>
        {side.heading}
      </h5>
      {side.text === '' ? (
        <p className="small muted diff__empty">{side.emptyNote}</p>
      ) : (
        <code className="code-well diff__text">{side.text}</code>
      )}
    </div>
  );
}

export function PatchDiff({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <div className="diff">
      <DiffSide
        side={{
          kind: 'old',
          marker: '−',
          heading: 'Text now in the file',
          text: oldText,
          emptyNote: 'Nothing is removed: this edit only inserts text.',
        }}
      />
      <DiffSide
        side={{
          kind: 'new',
          marker: '+',
          heading: 'Text this edit would put there',
          text: newText,
          emptyNote: 'Nothing is put in its place: this edit only removes text.',
        }}
      />
    </div>
  );
}
