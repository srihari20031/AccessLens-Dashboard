# AccessLens dashboard

A web UI for reading and comparing AccessLens reports. You run scans on the command line; this
uploads, stores, displays and diffs what they produce.

It shows **severity band counts and nothing else** — no score, no percentage, no badge, and
`needs-manual-review` is never folded into a failure total. That is the project brief's rule, and
most of the design decisions below follow from it.

## What it does

- Sign in with email and password (Supabase Auth). Your runs are visible only to you.
- Upload the JSON from `accesslens scan` (schema 1) or `accesslens crawl` (schema 2).
- **Runs** — every report you have uploaded, with its band counts. Delete a run.
- **Run detail** — band counts, the pages a crawl covered (evaluated or not), and every finding,
  filterable by band, criterion and page.
- **Compare** — two runs diffed by finding identity: new, fixed, still present.
- **History** — every site you have runs for; for one site, its runs numbered in upload order,
  a chart of band counts by run, and for each run what is new, resolved, and came back since
  the run before. A run's own page shows its number and the change in each band since the
  previous run of the same site.
- **About** (public) — the pipeline with what is built today, the three defining decisions, and
  what each kind of target supports.
- Each finding shows its **source location**, or says plainly that it is not mapped.
- A **keyboard trap finding (2.1.2)** shows the focus order the scanner recorded: every stop
  in order, the loop focus got caught in, and the elements it never reached, with Replay and
  Step controls. It needs reports from rule `no-keyboard-trap` 1.1.0 or later; older reports
  show the raw evidence as before.

It does **not** run scans. Chromium does not run on a typical Next.js host, so starting a scan
from the browser is out of scope; the CLI is the only way to produce a report.

## Setup

### 1. Create a Supabase project

At [supabase.com](https://supabase.com). You need the **project URL** and the **anon
(publishable) key** from Project Settings → API. The service-role key is not used anywhere in this
app and must not be added to it — every query runs as the signed-in user so that row-level
security is the access control.

### 2. Run the migrations

In the Supabase SQL editor, run in order:

```
supabase/migrations/0001_schema.sql          -- tables, indexes, RLS policies
supabase/migrations/0002_import_run.sql      -- the transactional import function
supabase/migrations/0003_source_location.sql -- keeps each finding's source location
```

`0003` is safe on a project that already has runs. Until it is applied, uploads still work
and every finding shows as not mapped to source — which, for every report the CLI can produce
today, is the truth anyway.

Or, with the Supabase CLI linked to the project, `supabase db push`.

### 3. Configure and run

```bash
cd web
cp .env.example .env.local      # then fill in the two values
npm install
npm run dev                     # http://localhost:3000
```

For a demo, turn **off** email confirmation in Supabase (Authentication → Providers → Email,
"Confirm email"), so creating an account signs you straight in. With it on, sign-up tells you to
open the confirmation link first.

### 4. Produce a report and upload it

```bash
# from the repository root, once:
uv sync
uv run playwright install chromium

# one page
uv run accesslens scan https://example.com > scan.json

# a whole site (crawling anything but loopback needs --i-have-permission)
uv run accesslens crawl https://example.com --i-have-permission > crawl.json
```

Upload `scan.json` or `crawl.json` on the Runs page. Only stdout is the report; the human summary
on stderr is not part of it, and a file containing both will be rejected as invalid JSON.

## Checks

```bash
npm run test        # vitest — validation, mapping, banding, diffing
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build       # next build
```

All four must be clean before a commit, matching the repository's rule for the Python side.

## Sample reports

`fixtures/` holds five real reports, produced by serving this repository's own fixture pages on
loopback and running the CLI against them:

| File | Made by |
| --- | --- |
| `crawl-small-site.json` | `crawl` of `tests/fixtures/sites/small-site` — 11 pages, one HTTP error, two skipped URLs |
| `scan-index.json` | `scan` of that site's index page |
| `scan-contrast.json` | `scan` of `tests/fixtures/pages/1.4.3-contrast-minimum.html` |
| `scan-non-text-contrast.json` | `scan` of `tests/fixtures/pages/1.4.11-non-text-contrast.html` |
| `scan-keyboard-trap.json` | `scan` of `tests/fixtures/pages/2.1.2-keyboard-trap.html` — rule `no-keyboard-trap` 1.1.0 or later, which records the focus order and what focus never reached |

The tests assert the counts these particular files contain, so they are a regression test of the
mapping rather than a restatement of it. Regenerating them is deliberate:

```bash
cd tests/fixtures/sites/small-site && python -m http.server 8000     # terminal 1
uv run accesslens crawl http://127.0.0.1:8000/ --delay-ms 0 > web/fixtures/crawl-small-site.json
uv run accesslens scan http://127.0.0.1:8000/index.html > web/fixtures/scan-index.json

cd tests/fixtures/pages && python -m http.server 8001                # terminal 2
uv run accesslens scan http://127.0.0.1:8001/2.1.2-keyboard-trap.html > web/fixtures/scan-keyboard-trap.json
```

Tests never touch the live web — a project rule.

## How it is put together

```
upload → parseReportText (zod)  → toImportPayload → import_run (one transaction)
                                                   ↓
runs / run_pages / run_findings ← RLS, as the signed-in user
                                                   ↓
                          run detail · compare (diffRuns by finding_hash)
```

- `src/lib/report/` is pure logic with no Next.js or Supabase in it: `bands.ts` (the banding
  rule), `schema.ts` (validation), `map.ts` (report → rows), `diff.ts` (run comparison). All four
  are unit-tested against the fixtures.
- `src/lib/db/runs.ts` is the only place that talks to Postgres.
- `src/lib/supabase/` holds the three clients (server, browser, middleware) and the config check.
- Pages are Server Components; mutations are Server Actions.

### Schema notes and where it differs from the handoff brief

- **Only non-passing findings are stored.** A page's passes become `run_pages.pass_count`. A crawl
  report does not carry pass findings at all, so storing a scan's would make the two kinds of run
  different for no gain — nothing in the UI lists an individual pass.
- **`run_findings.severity` is `not null`.** A non-passing finding always carries a severity
  (`Finding.__post_init__` enforces PASS ⟺ no severity), and only non-passing findings are stored.
- **A check constraint ties `band` to `outcome` and `severity`** in the database, not only in
  TypeScript: a review is always the review band; a fail takes its severity's band.
- **An `update` RLS policy on `runs`** was added beyond the brief's select/insert/delete, so a run's
  label can be changed later. Nothing else about a run is editable.
- **`import_run` takes pre-mapped rows**, not the raw report. The mapping is unit-tested TypeScript;
  duplicating it in plpgsql would have created a second, untested copy of the banding rule.
- **Site bands are recomputed** from the stored findings rather than copied out of the file. For a
  crawl the two agree by construction, and recomputing means the totals on screen can never
  disagree with the findings listed beneath them.
- **Unknown keys inside `run`, `settle`, `limits` and `evidence` are kept**, so a newer CLI can
  record more without this dashboard silently dropping it.

### History, run numbers and change since the last run

These cover the mockup's "audit history" and "since last run" parts
(`docs/brief/AccessLens-Visual-Mockup.html`). The logic is `src/lib/report/history.ts`, unit-tested.

- **A site is a kind and a target URL together.** A scan of `/` and a crawl starting at `/`
  measure different amounts of the site, so they get separate histories.
- **Run numbers are derived, not stored**: run #3 is the third upload of that site still in the
  account. Deleting a run renumbers the later ones; it needs no database change.
- **"Came back"** counts new findings that a run before the previous one had already reported.
- **The chart is four small charts, one per band, not a stacked bar.** The band colours were
  chosen for text contrast; as chart fills, serious and moderate are nearly identical under
  protanopia (a palette validator put them ΔE 0.4 apart). Separate rows named in words need
  no colour to tell apart. The table under it holds every number the chart shows.
- **The change in each band is not coloured green or red.** Fewer findings is not evidence
  the site improved — a page may have gone — and fewer reviews is not good news.

### What the mockup shows that this does not

Deliberately absent, because the data does not exist yet and a screen of illustrative data in
an accessibility tool would be the overstatement the brief forbids:

- **Running a scan from the browser** — Chromium does not run on a typical Next.js host.
- **Fix review** (patch before/after, accept/edit/reject) — Phase 5; no finding has a source
  location to patch yet.
- **AI-drafted text with a confidence value** — Phase 6c.
- **Focus-order replay** — needs rule 2.1.2 and the focus-traversal provider.
- **HTML/PDF export** — Phase 4. **The pull-request comment** — Phase 6b, a GitHub Action.
- **A single "rule-set v1.3"** — the CLI records a version per rule (project plan D4), and
  that is what is shown.

The About page's target table follows the criterion freeze (§4), not the mockup, where the two
disagree: the freeze says a server-templated page cannot be mapped to source without
instrumenting the templates, where the mockup says "best effort".

### Safety

- Every uploaded file is validated with zod before anything else touches it, capped at 5 MB, and
  rejected with a message naming what was wrong.
- `element.snippet` is raw HTML captured from the audited page. It is rendered as **text**. There
  is no `dangerouslySetInnerHTML` anywhere in this project, and there must not be.
- Two invariants from the Python model are re-checked at upload rather than trusted: pass ⟺ no
  severity, and a schema-2 finding's `band` matching its outcome.
- **Findings are read in pages of 1000.** Supabase returns at most 1000 rows per request and
  says nothing when it stops, so a larger crawl would otherwise lose findings silently.

## The dashboard's own accessibility

It is an accessibility tool, so it has to survive its own rules. What was done deliberately:

- Semantic landmarks (`header`/`nav`/`main`/`footer`), a skip link, one `h1` per page and headings
  in order; tables use `caption`, `scope` and row headers.
- Every control has a real `<label>`. Filters are a plain GET form, so they work without
  JavaScript, are fully keyboard-operable, and produce a shareable URL.
- One focus indicator, used everywhere: a 3px accent outline with a 2px offset. Never removed.
- **Colour is never the only signal.** Every band is written out in words next to its count, and
  the four band colours are not one ramp — critical, serious and moderate share a warm ramp
  because they are degrees of the same thing, while `needs-manual-review` is violet, off that ramp
  entirely, because it is a different kind of result rather than a lesser failure.
- Passes get no colour at all. A green "pass" badge is precisely the reassurance the brief refuses
  to give.
- Measured contrast ratios of the palette against the white report surface:
  `--ink` 15.97:1, `--ink-soft` 7.54:1, `--accent` 7.60:1, critical 8.97:1, serious 5.92:1,
  moderate 6.73:1, review 9.20:1 — all above the 4.5:1 that rule 1.4.3 requires.
- Form control borders use `--rule-strong`, 4.05:1 on the report surface and 3.42:1 on the page
  ground, above the 3:1 that rule 1.4.11 requires. It was `#94a0b4` at first, commented as
  3.1:1; crawling the running dashboard with AccessLens measured 2.64:1 and 2.23:1 and failed
  every input and select, which is how it was caught.
- Motion: none. `prefers-reduced-motion` is honoured anyway.
- Live regions announce upload and sign-in results rather than only showing them.

A good demo: start the dashboard, sign in, then crawl it with AccessLens itself.

It has been. With the eight rules on `main`, the sign-in page, `/about`, `/preview` and every
signed-in page report **no failures**. What goes to manual review, correctly:

- the native file input (1.4.11 does not judge browser-painted widgets);
- each history chart (1.1.1 sends every text alternative to a person), and its numbers
  (1.4.3 cannot measure text inside SVG — they use `--ink` and `--ink-soft`, 15.97:1 and
  7.54:1 on the sheet).

The CLI cannot sign in, so the signed-in pages were crawled through a small local proxy that
adds a session cookie and forwards only GET and HEAD, which means the crawl could never press
Sign out, Delete or Upload.

## Known limitations

- **Light colour scheme only.** A dark palette would double the contrast surface to verify, and
  every ratio above is stated as measured against one surface.
- **No pagination.** A run with thousands of findings renders them all. The fixtures and any
  realistic student-project crawl are far smaller; a crawl of a large site would need it.
- **Filters are exact-match**, not free-text search.
- **Uploads are manual.** A CLI uploader is deliberately not built.
- **Dates are formatted in the server's timezone**, since the pages render on the server.
- **Deleting a run is immediate**, behind a disclosure rather than a modal. There is no undo; the
  report file on your machine is the only other copy.
