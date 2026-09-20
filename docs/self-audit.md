# Auditing the dashboard with AccessLens

_Audited 20 September 2026, on `feat/a11y-polish`, against WCAG 2.2 Level AA._

This is an accessibility auditing tool. If its own interface has accessibility defects, that
is the first thing a reviewer will find, and it undermines everything else the project
claims. So the dashboard is audited with the CLI it exists to display, and the result is
written down whether or not it is flattering.

## How it was audited

Three passes, in this order.

**1. The project's own tool, on the real pages.** The dashboard was built for production
(`npm run build && npm run start`) and every screen scanned with
`uv run accesslens scan <url>` from the sibling Python repository. Twelve success criteria,
one rule each, in real Chromium: 1.1.1, 1.3.1, 1.4.3, 1.4.11, 2.1.2, 2.4.1, 2.4.2, 2.4.4,
2.4.7, 3.1.1, 3.3.2 and 4.1.2.

Signed out, the signed-in screens render the Supabase setup notice, so the tool could not see
them. For the audit only, the four database functions were replaced by a temporary stub that
returns runs built from the committed fixtures in `fixtures/`, through the same
`parseReport` → `toImportPayload` path an upload takes. That stub is not in the repository
and is in none of these commits; it existed only so that `/runs`, a run's findings, the
comparison, the focus-order replay, the history chart and the Run audit form could be scanned
as the pages a user actually sees, with real findings in them.

**2. Things the twelve rules do not check**, by hand and by measuring the rendered page in
Chromium: reflow at 320 CSS pixels (1.4.10), target sizes (2.5.8), autocomplete on identity
fields (1.3.5), authentication (3.3.8), status messages (4.1.3), duplicate `id`s and dangling
`aria-describedby`/`aria-labelledby`/`for` references, heading outlines per route, and page
titles per route.

**3. Reading the components**, for the things neither of the above can see: whether a live
region is in the DOM before it has anything to say, whether an ARIA attribute points at
something real, whether a control's name would distinguish it from its neighbours.

## What the tool reported

After the fixes below, across ten screens — the runs list, two run-detail pages (a scan with a
keyboard trap and a crawl), a comparison, the history index, one site's history, About, two
previews and the not-found page:

| | |
| --- | --- |
| Findings | 1406 |
| `fail` | **0** |
| `needs-manual-review` | 24 |
| `pass` | 1382 |

All twelve rules ran on every page; none was skipped. The 143 passes on 2.4.7 Focus Visible
are 143 separate keyboard stops each measured focused against blurred, and 2.1.2 completed its
Tab walk on every page rather than reporting `walk-incomplete`.

The 24 reviews are all cases the tool says out loud it cannot decide, not open questions about
this UI:

- **16 × 1.4.3** — text inside the history chart's SVG. `StyleResolver` declines on SVG
  content because it paints with `fill`, not `color`. The run numbers and bar values are
  `--ink` and `--ink-soft` on the sheet: 15.97:1 and 7.54:1.
- **4 × 1.1.1** — the four history charts carry `role="img"` and an `aria-label` that reads
  out every value ("Serious by run: run #1 2, run #2 2."). Whether an alternative is
  *equivalent* is a human judgement, so the rule asks for one.
- **4 × 1.4.11** — the two radio buttons, the checkbox and the file input on the Runs page.
  Chromium paints a native widget's boundary itself rather than from its CSS border, so the
  rule declines rather than guess.

## Defects found, and what was done

### Fixed

**1.4.10 Reflow — the whole page scrolled sideways at 320px.** `/runs` overflowed by 567px
and `/history` by 552px, with nothing out there to read. The cause was subtle and worth
recording: `.visually-hidden` is `position: absolute` with no offsets, so without a positioned
ancestor its containing block is the *initial containing block*, not the scroller it sits in.
A hidden `Actions` column header, laid out 886px along a horizontally scrolled table, was
therefore positioned against the viewport and stretched the document. `.table-scroll` is now
`position: relative`. A second, ordinary case: the list of skipped URLs had no
`overflow-wrap`, and a URL has no spaces to break at, so a crawl of a site with long paths
pushed the page 51px wide. Every screen is now 0px of horizontal overflow at 320px.

**2.5.8 Target Size (Minimum) — disclosure controls were 22px tall.** `<summary class="small">`
at 14.4px and line-height 1.55 is a 22.3px box, on the runs, run-detail, compare and preview
screens alike. Vertical padding takes every one to 30.3px, and the display type is untouched
so the marker stays.

**2.4.2 Page Titled — four routes had no title of their own.** Every run page was
"Run — AccessLens", every site history "History", every sample "Preview", and the not-found
page fell through to the layout's bare "AccessLens". Open three runs in three tabs and the tab
strip, the browser history and a screen reader's window list all said the same word three
times. Each route now names its subject: "Scan of Keyboard trap fixture", "History — crawls of
http://…", "Preview — Scan of the 1.4.3 contrast fixture page", "Not found".

**3.3.2 Labels or Instructions — the password rule was on screen and nowhere else.** The
sign-in form's hint had `id="password-hint"` and nothing referenced it, so "At least 8
characters" never reached a screen-reader user; `minLength={8}` would simply refuse the form.
The field now has `aria-describedby`.

**2.4.6 Headings and Labels — four controls all called "Delete".** The runs table gave every
row an identical disclosure. A screen reader's list of controls showed four of them with
nothing to choose between. Each now names its run, as the "history" and "Compare" links in the
same table already did.

**1.3.1 — the upload form had a heading id that nothing used.** `<h2 id="upload-heading">` sat
beside a form with no accessible name, while the Run audit form next to it was properly
`aria-labelledby`'d. The upload form now uses the id that was already there.

**Heading order on `/preview`.** The page opened with an `<h2>` on a notice before its own
`<h1>`, so the outline started at level 2 and then went up. It is a label on a notice, not a
section of the document, so it is no longer a heading.

### Polish on the demo path

None of this changes what a run means, and none of it introduces a dependency, a component
library or a new token.

- **There was no `loading.tsx` anywhere.** Navigating to a run, a comparison or a site history
  left the previous page on screen with nothing to say the app was working — on a crawl with
  thousands of findings, a long silent pause. All four data screens now have one: a sentence
  in a `role="status"` region and three placeholder bars, `aria-hidden` because they say
  nothing the sentence does not, and never animated.
- **Zero counts now read as context.** The band strip has always drawn a zero quieter than a
  real number; the four tables drew five equal figures when only one of them was a result.
  They now agree (`--ink-soft`, 7.54:1 on the sheet — colour is not the only signal, the
  number is still the number).
- **The runs table had no visible heading.** "Your runs" was `visually-hidden`, so the table
  the page is named after was the only block on the screen a sighted reader could not see
  named, sitting below two forms that both had one.
- **Loose elements put back in panels.** "Show the N findings" on the compare screen was a
  bare line on the ground between two bordered panels; it is now the sheet it opens. The audit
  list's empty state was a loose line of grey text. The Delete column no longer wraps its
  marker onto a line of its own.
- **The history chart.** Two runs drew an 88px chart against 900px of empty row, which read as
  something that had failed to load. Below eight runs the slot widens; from eight it returns
  to the narrow one so a long history still fits without scrolling.

## Deliberately left, with the reason

**Checkbox and radio inputs are 17.6px, under 2.5.8's 24px.** They meet the spacing exception
instead: the two radios are 30.3px apart centre to centre, so the 24px circles the criterion
draws around them do not intersect, and each has a `<label for>` whose text is part of the
same target. Growing them would mean styling native controls, which is what sends 1.4.11 to
review in the first place. Not changed.

**The sign-in form uses `autocomplete="current-password"` for both Sign in and Create an
account.** One form serves two intents through two submit buttons, and the attribute has to be
one value. `current-password` keeps 3.3.8 Accessible Authentication satisfied for the common
case (a password manager can fill it); a new account gets a field a manager will offer to save
rather than to generate. Splitting the form to fix the attribute would cost more than it buys.

**Filtering findings is a full page navigation, and focus returns to the top.** The filters are
a plain GET form so they work without JavaScript and every view has its own URL — a deliberate
decision, not an oversight. The cost is that after "Apply filters" a keyboard user starts again
from the top of the document. Moving focus to the results would need JavaScript on a screen
that currently needs none. Left, and recorded here.

**The focus-order replay's "Replay traversal" control has no pause-on-Escape.** It stops when
pressed again, it honours `prefers-reduced-motion` by jumping straight to the end, and it moves
a highlight rather than the page. 2.2.2 Pause, Stop, Hide is met by the button itself. No
further control was added.

**Page titles are not re-announced on client-side navigation.** Next's App Router changes
`document.title` without a document load, and some screen readers do not announce it. Fixing it
properly means a route-change live region in the root layout — a client component wrapping
every page. Judged not worth the blast radius this close to the demonstration; every route now
has a correct and distinct title, which is what 2.4.2 asks for.

## Added after this audit, and not yet scanned

**The Source patches screen (`/runs/<id>/patches`).** It was built to the standard above and to
the same patterns as the Fix review screen it is the sibling of — one form per patch with several
submit buttons, each naming which patch it acts on for a screen reader; `<details>` for the
reject panel, so it is keyboard-operable with no script; every status and every decision written
out in words inside its tag; headings in order (`h1` page, `h2` per status group, `h3` per patch,
`h4` for the question or the edit, `h5` for the two sides of the diff); and the before/after
diff distinguished by two headings and two border *styles* rather than by a red/green pair, which
would make colour the only signal (1.4.1) and vanish in high contrast mode. The one new colour
pair is `--ink` on `--sheet` (15.97:1) and `--ink-soft` on `--sheet` (7.54:1), both already
measured above; the new borders are `--rule-strong` (4.05:1) and `--ink`, which clear 1.4.11's
3:1.

None of that is a scan. The screen has not been through pass 1 — the CLI has not been run
against it, because it needs a run with a patch set in the database, and `accesslens fix` is
itself new. Until it has, this document's "0 failures" covers the ten screens listed above and
not this one.

## What this audit does not cover

The tool checks twelve success criteria. Everything else in WCAG 2.2 AA was checked by hand or
not at all, and the hand checks above are one person's reading, not a conformance statement.
Nothing here was tested with an actual screen reader, with voice control, at 200% zoom in a
real browser window, or by anyone who uses assistive technology daily. That is the check that
would matter most, and it has not been done.

The same caution the dashboard prints in its own footer applies to the dashboard: the automated
checks not firing is not evidence of conformance.
