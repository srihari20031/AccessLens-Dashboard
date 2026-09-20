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

## The dark palette

_Added 20 September 2026, on `feat/dark-mode`. Not part of the scan above._

The dashboard now has two colour schemes. Which one a reader gets is decided by their
operating system through `prefers-color-scheme`; `color-scheme: light dark` on `:root` and
`<meta name="color-scheme" content="light dark">` from the layout's `viewport` export tell the
browser to draw its own chrome — scrollbars, native form widgets, the canvas before the
stylesheet arrives — to match.

**There is no in-page toggle, deliberately.** This app works with JavaScript switched off by
design: the filters are a GET form, every decision is a server action, and nothing on a screen
needs a script to open or operate. A toggle that honoured that would be a cookie plus a server
action plus a control on every page — a fourth thing to keep in sync on a screen whose job is
to show findings — and it would have to answer for a reader who has JavaScript off, a reader
whose system setting says the opposite, and the first visit with no cookie yet. The operating
system already carries that preference, every browser exposes it, and following it costs
nothing and cannot disagree with itself. A toggle can be added later without moving a single
colour, because all sixteen values live in one `:root` block.

### The two palettes, as measured

Ratios are computed from the WCAG relative-luminance and contrast-ratio definitions and
**truncated** to four decimal places, never rounded — the same rule `src/accesslens/color.py`
follows in the CLI, and for the same reason: a true 4.49995 must not be allowed to read as a
passing 4.5. The arithmetic was written out again for this work rather than imported, and
checked by reproducing the light palette's already-published numbers before a single dark
value was chosen. They agree; where a figure below differs from an older comment in the last
place — 15.96 against 15.97 — it is because this document truncates where those rounded.

| Token | Light | on sheet | on ground | Dark | on sheet | on ground |
| --- | --- | --- | --- | --- | --- | --- |
| `--ground` | `#e9ecf1` | — | — | `#10141b` | — | — |
| `--sheet` | `#ffffff` | — | 1.18:1 | `#1b212c` | — | 1.14:1 |
| `--ink` | `#1a2230` | 15.96:1 | 13.48:1 | `#e3e8f0` | 13.12:1 | 14.99:1 |
| `--ink-soft` | `#4a5567` | 7.53:1 | 6.36:1 | `#a7b1c2` | 7.46:1 | 8.53:1 |
| `--rule` | `#c7ceda` | 1.58:1 | 1.33:1 | `#333c4a` | 1.45:1 | 1.65:1 |
| `--rule-strong` | `#737f92` | 4.05:1 | 3.42:1 | `#8b96a8` | 5.40:1 | 6.17:1 |
| `--accent` | `#0e5c6b` | 7.60:1 | 6.42:1 | `#79c8d6` | 8.49:1 | 9.70:1 |
| `--accent-hover` | `#0a4753` | 10.29:1 | — | `#a9dde8` | 10.91:1 | — |
| `--accent-wash` | `#e3f0f2` | 13.69:1 | — | `#14313c` | 11.12:1 | — |
| `--band-critical` | `#8e1b2b` | 8.96:1 | 7.57:1 | `#ff9ba3` | 8.05:1 | 9.20:1 |
| `--band-serious` | `#a24b07` | 5.92:1 | 5.00:1 | `#f0a566` | 7.90:1 | 9.03:1 |
| `--band-moderate` | `#6a5b12` | 6.73:1 | 5.68:1 | `#c6c069` | 8.56:1 | 9.79:1 |
| `--band-review` | `#52368f` | 9.19:1 | 7.76:1 | `#b3a4f2` | 7.31:1 | 8.35:1 |
| `--wash-critical` | `#fbeaec` | 13.74:1 | — | `#301a1f` | 13.19:1 | — |
| `--wash-serious` | `#fbeee4` | 14.02:1 | — | `#2d2117` | 12.72:1 | — |
| `--wash-moderate` | `#f6f2e0` | 14.21:1 | — | `#262614` | 12.45:1 | — |
| `--wash-review` | `#eeeaf7` | 13.49:1 | — | `#251f3a` | 12.77:1 | — |

A colour's own figure is against the surface named at the top of the column. For
`--accent-hover` the figure is the sheet-coloured button label on it, and for the four washes
and the accent wash it is `--ink` on that wash — the notice bodies and the band tags'
background. `--ink-soft` on each dark wash is 7.08:1 or better, and on the dark accent wash
6.32:1.

Each band colour is also its own band tag's text, on its own wash: critical 8.09:1, serious
7.66:1, moderate 8.13:1, review 7.11:1 in dark (7.72, 5.20, 5.99 and 7.77 in light). Every one
of those is above 4.5:1, not merely above the 3:1 a band's *edge* needs, because a band is
written out in words in its own colour wherever it appears.

**1.4.11 in dark**, every non-text pair that carries meaning: `--rule-strong` 5.40:1 on the
sheet and 6.17:1 on the ground (form-control and table borders, and the dashed "text now in the
file" edge of a diff); the four band colours 7.31:1 to 9.79:1 on both surfaces (the band
strip's top edge, a finding's left edge, a band tag's border); `--ink` 13.12:1 on the sheet
(the solid "text this edit would put there" edge); and `--accent` 8.49:1 on the sheet, 9.70:1
on the ground, 8.54:1 over the critical wash, 8.26:1 over the review wash and 7.19:1 over the
accent wash — that last set is the focus ring, which has to stay visible wherever it lands.

**Telling the four bands apart.** Colour is never the only signal here — every band is written
out in words beside its count — but four bands still have to read as four. In CIELAB the
closest dark pair is serious against moderate at ΔE 31.4, where the closest light pair (the
same two) is ΔE 34.5. The rest are 35.8, 51.7, 58.1, 80.6 and 87.5.

### What the dark scheme is, and is not

It is not the light palette inverted. Pure white on pure black is 21:1 and halates: the type
blooms, the stems thicken, and every hairline in the stylesheet is lost under it. The surfaces
are a dark blue-grey neutral with the sheet sitting a little above the ground (1.14:1, where
the white sheet sits 1.18:1 above the grey one), and body text is dimmed to 13.12:1 rather
than driven to the maximum. Hairlines, the 2px radius, no shadows and no glow are the light
design untouched, and the bands keep their meaning: critical, serious and moderate on one warm
ramp because they are degrees of the same thing, review off it in violet because it is not.

Three things needed a dark counterpart rather than a token:

- **`--accent-hover`** is now a token. The button's hover fill has to move darker on light and
  lighter on dark for the sheet-coloured label on it to stay readable (10.29:1 and 10.91:1).
- **`::selection`** is chosen and measured here rather than left to the browser, which draws
  its own blue behind otherwise-unchanged text. It is the sheet colour on the accent: 7.60:1
  light, 8.49:1 dark. The accent *wash* was tried first and rejected on the screenshots — at
  1.16:1 and 1.17:1 against the sheet, a selected run of text barely looked selected.
- **The logo mark.** Its glass is a white disc with a dark half — the contrast ratio the tool
  measures. On a dark header that reads as a hole punched in the page, so the two halves swap.
  The component draws them as SVG presentation attributes, which any CSS rule outranks, so the
  mark gets its dark form from the stylesheet and `LogoMark.tsx` is untouched. `app/icon.svg`
  already carried a dark block of its own; its three values are now these three tokens.

### Checked by eye, in both schemes

Built (`npm run build`), served, and screenshotted in Chromium through Playwright with
`color_scheme` set each way — whole pages and individual components — with the four database
readers replaced by the same kind of temporary fixture stub pass 1 used. That stub is in none
of these commits.

Looked at: the runs list, including the audit form's native radios, checkbox, number field and
file input; a run detail page — band strip, band tags, finding edges, code wells, evidence
lists; the fix-review screen, its AI block and its decision controls; the source-patches
screen, whose two diff sides are told apart by border *style* (dashed for the text that is
there now, solid and heavy for the text that would replace it) and still are; the sign-in page;
the history index and one site's history with its SVG chart; and, injected into a real page so
they inherited the tokens, the focus ring, a text selection, the three notice variants, all
four band tags, every status tag, the four button states and the focus-replay stops.

### What is not verified

- **The CLI has not scanned the dark scheme.** `accesslens scan` drives Chromium in its default
  (light) colour scheme and has no flag for the other, so the "0 failures" earlier in this
  document is a statement about the light palette only. Every dark ratio here is arithmetic on
  the token values — on what the CSS says — not a measurement of what Chromium painted.
- **`forced-colors` / Windows High Contrast is not tested.** Nothing here depends on colour
  alone and the border-style distinctions were chosen partly with that mode in mind, but it was
  not opened.
- **The loading placeholder bar is as faint in dark as in light** — the ground on the sheet,
  1.14:1 against 1.18:1. It is `aria-hidden` decoration beside a `role="status"` sentence that
  says the same thing in words, so it was left rather than given a dark-only brightness the
  light scheme does not have.
- **The SVG history chart is the one place the tool cannot check either scheme**: `StyleResolver`
  declines on SVG content because it paints with `fill`, so 1.4.3 there is needs-manual-review
  in both. Its numbers are `--ink` and `--ink-soft` on the sheet, 13.12:1 and 7.46:1 in dark.
- **Nobody has read the dark palette on a real screen in a dark room**, which is the condition
  it exists for, and nobody who uses assistive technology daily has seen either scheme.

## What this audit does not cover

The tool checks twelve success criteria. Everything else in WCAG 2.2 AA was checked by hand or
not at all, and the hand checks above are one person's reading, not a conformance statement.
Nothing here was tested with an actual screen reader, with voice control, at 200% zoom in a
real browser window, or by anyone who uses assistive technology daily. That is the check that
would matter most, and it has not been done.

The same caution the dashboard prints in its own footer applies to the dashboard: the automated
checks not firing is not evidence of conformance.
