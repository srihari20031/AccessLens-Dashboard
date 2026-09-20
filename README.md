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
- **Fix review** — for a run, every finding that carries AI text from `accesslens explain`,
  with the model's explanation, its suggested fix and its stated confidence, and a decision
  per suggestion: accept, edit or reject. The run's page shows the counts. See
  [Fix review](#fix-review).
- **Source patches** — for a run, every edit `accesslens fix` proposed against the scanned
  HTML file and every question it refused to answer, grouped by status, each with its before
  and after text and a decision: accept, reject, or mark applied. The run's page shows the
  counts. Nothing here edits a file. See [Source patches](#source-patches).
- A **keyboard trap finding (2.1.2)** shows the focus order the scanner recorded: every stop
  in order, the loop focus got caught in, and the elements it never reached, with Replay and
  Step controls. It needs reports from rule `no-keyboard-trap` 1.1.0 or later; older reports
  show the raw evidence as before.

- **Run audit** (optional) — start a scan or a small crawl from the Runs page, when a scan
  worker is connected. See [Run audit](#run-audit).

The dashboard itself never runs a scan. Chromium does not run on a typical Next.js host, so a
scan runs either on the command line or on a separate AccessLens scan worker; without a worker
the Run audit form is hidden and the CLI is the only way to produce a report.

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
supabase/migrations/0004_scan_jobs.sql       -- audit jobs, only needed for Run audit
supabase/migrations/0005_fix_reviews.sql     -- AI suggestions and fix-review decisions
supabase/migrations/0006_patch_review.sql    -- source patches and patch-review decisions
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

## Run audit

With a scan worker connected, the Runs page shows a **Run audit** form above the upload form:
a URL, scan (one page) or crawl (up to 20 pages, only with the "I own this site or have
permission to crawl it" tick-box), and a list of your recent audits that refreshes itself every
3 seconds while one is waiting or running.

**Setup.**

1. Run `supabase/migrations/0004_scan_jobs.sql` in the Supabase SQL editor. It adds the
   `scan_jobs` table with row-level security (each user sees only their own jobs) and a
   before-insert trigger that allows **one active audit per user** and **10 audits per user per
   24 hours**. A job waiting or running for more than 30 minutes counts as stale and no longer
   blocks. It is safe on a project that already has runs, and safe to run again.
2. Deploy the AccessLens scan worker (in the AccessLens repository) with the same Supabase URL
   and anon key.
3. Set `ACCESSLENS_WORKER_URL` to the worker's base URL. It must be **https**; plain http is
   accepted only on loopback (`127.0.0.1`, `::1`, `localhost`), e.g. `http://127.0.0.1:8080`
   locally, because the user's access token is sent to it. Any other value is treated as unset
   (the form is hidden) and the server logs one line saying why. It is **server-only** — never
   `NEXT_PUBLIC_` — and read on each request to `/runs`.

**Why the limits hold.** A signed-in user's token can write `scan_jobs` directly, not only
through the dashboard, so the table enforces everything itself:

- **Jobs cannot be deleted** — there is no delete policy — because deleting old jobs would reset
  the daily count. A job goes only when its user is deleted.
- The **insert trigger** sets every column except `url`, `kind`, `max_pages` and
  `permission_confirmed`: a new job is always `queued`, created now, with no report, error or
  run, so it cannot be backdated out of the daily count.
- The **update trigger** keeps the request (URL, kind, pages, permission, owner, creation time)
  unchanged, lets status only move forward (queued → running or failed, running → done or
  failed), sets `started_at`/`finished_at` from the database clock, writes the report only on
  running → done and the error only on the move to failed, refuses to start a job older than 30
  minutes, and lets `run_id` be set once, to one of the user's own runs (or cleared when that
  run is deleted).
- A **check** caps a stored report at 5 MB, the same limit as a file upload.

**Without the worker** (`ACCESSLENS_WORKER_URL` unset), the form and the job list are hidden and
the Runs page says in one sentence that scans run from the command line. That is the default,
and it is what the dashboard looks like everywhere a worker has not been set up.

**How it talks to the worker.**

```
Run audit form → startAudit: zod validation → insert scan_jobs row as the user (RLS + quota)
              → POST {ACCESSLENS_WORKER_URL}/jobs  {"job_id": "<uuid>"}
                 Authorization: Bearer <the user's Supabase access token>
worker        → reads the row with that token, runs the CLI, writes status/report back as the user
Open results  → openAuditResults: parseReport → toImportPayload → import_run → sets run_id
```

- Only the job id is sent. The worker reads the URL and limits from the row, which row-level
  security proves belongs to the caller. No service-role key exists on either side.
- **The session is refreshed right before submitting**, so the token handed over is a fresh one
  (an hour on Supabase). The worker keeps it for the whole job and refuses one with less than its
  job timeout plus 30 minutes left (45 minutes by default); the dashboard checks the same minimum
  and, if the session cannot be renewed, asks the user to sign in again without creating a job.
- Anything but `202 Accepted` from the worker (or no answer within 10 seconds) marks the job
  failed with the fixed message "The scan service could not be reached. Try again later."
- A finished job's report is imported through **exactly the upload path**, so a report from the
  worker is validated as strictly as a file from disk, and held to the same 5 MB cap. The run
  is labelled `Audit · <url>`.
  Opening results twice imports once: the second click only redirects, and if two clicks race,
  the duplicate run is removed.
- Failure messages from the worker are a fixed set of sentences, shown as text. If storing a
  report fails — uploaded or from an audit — the page says so in one fixed sentence; the
  database's own error text goes to the server log only.
- The logic is in `src/lib/audit/` (validation, status wording, the worker call), unit-tested;
  database access is `src/lib/db/jobs.ts`.

## Fix review

`accesslens explain <report.json> --out explanations.json` asks a language model for a
plain-language explanation and a suggested fix for each non-passing finding, and labels every
one of them "AI suggestion — review before use". The project brief asks for the other half of
that: somebody has to *do* the reviewing. That is this screen, at **Fix review** on a run's
page (`/runs/<id>/review`).

**The boundary, which the screen states in its own words.** A decision records what a person
thinks of the *suggested text*. It changes nothing about the finding: outcome, severity and
band are the scanner's, and no code path leads from a decision to any of them. Rejecting a
suggestion does not dismiss the problem; accepting one does not fix it. `run_findings` is
never written to by anything in `src/lib/db/reviews.ts`, and the review tables carry no
outcome, severity or band column at all.

**Setup.** Run `supabase/migrations/0005_fix_reviews.sql` in the Supabase SQL editor. It adds
two tables with row-level security in the shape 0001 uses — reachable only through one of your
own runs — and is safe on a project that already holds runs. Until it has been run the rest of
the dashboard works unchanged, and the review screen says which file to run.

**The workflow.**

```
accesslens explain report.json --out explanations.json      (command line, optional extra)
   → upload it on the run's Fix review screen
   → run_suggestions, matched to findings by finding_hash
   → accept / edit / reject per suggestion → fix_reviews
   → counts on the run page
```

- Suggestions are matched to findings by `finding_hash`. A file made from another report
  brings nothing over, and the screen says so rather than storing it: `run_suggestions` has a
  foreign key onto `run_findings (run_id, finding_hash)`, so a stored suggestion always points
  at a finding that really is in that run, and both go when the run does.
- **Accept** records the text as written. **Edit** saves your own wording alongside the
  model's — the model's text is never overwritten, so the two can be compared later. **Reject**
  takes an optional reason. **Clear this decision** puts the suggestion back to not yet
  reviewed.
- `edited_fix` exists only for an `edited` decision and `reason` only for a `rejected` one,
  enforced by check constraints, so a stale draft can never be displayed as something that was
  accepted.
- **Who decided and when are the server's to write.** A trigger stamps `decided_by`,
  `decided_by_email` and `decided_at` from the caller's own token and the database clock, so
  no form field decides what the record says about who signed it.
- Re-uploading the explanations file replaces the text in place and leaves every decision
  alone. A decision made before the text arrived is shown with a line saying so — deleting
  somebody's judgement because a model was re-run would be worse than saying it is stale.
- The parser is tolerant about the *shape* of the explanations file (a list, a `suggestions`
  or `explanations` list, or an object keyed by hash) and strict about every *value*: a hash
  that is not lowercase hex, a confidence outside low/medium/high, or a value of the wrong type
  is dropped and counted, never guessed. The logic is `src/lib/review/`, unit-tested;
  database access is `src/lib/db/reviews.ts`.

## Source patches

`accesslens fix <report.json> --json patches.json` turns a scan of a **local HTML file** into a
set of proposed source edits: for each non-passing finding, either a concrete text edit anchored
to the line and column the scan recorded, or — where no machine should choose the value — a
plain question for the page's owner. That is the other half of Phase 5: somebody has to read a
proposed edit before it goes anywhere near a file. That is this screen, at **Source patches** on
a run's page (`/runs/<id>/patches`).

**The boundary, which the screen states in its own words.** This screen *records decisions about
proposed edits*. It edits nothing: no file on your machine, on a server or anywhere else is
touched by anything on the page. The edits are stored and displayed as text; applying one is
something you do yourself, in your own working copy, under version control — which is why one of
the three decisions is "I have applied it" rather than an Apply button. Nor does a decision
change the finding: outcome, severity and band are the scanner's, and no code path leads from a
decision to any of them. `run_findings` is never written to by anything in
`src/lib/db/patches.ts`, and the patch tables carry no outcome, severity or band column at all.
`tests/patch-boundary.test.ts` enforces both claims against the source, including that nothing in
the feature imports a filesystem module or calls a write.

**Setup.** Run `supabase/migrations/0006_patch_review.sql` in the Supabase SQL editor. It adds
two tables with row-level security in the shape 0001 uses — reachable only through one of your
own runs — and is safe on a project that already holds runs. Until it has been run the rest of
the dashboard works unchanged, the run page's Source patches section is silent, and the patch
screen says which file to run.

**The workflow.**

```
accesslens scan page.html > report.json          (a local file: findings carry line and column)
accesslens fix report.json --json patches.json   (command line)
   → upload it on the run's Source patches screen
   → run_patches, matched to findings by finding_hash
   → accept / reject / mark applied per patch → patch_reviews
   → counts on the run page
```

- Patches are grouped by status, in one fixed order: **ready** (an edit that matched the file),
  **needs-input** (a question), then **conflict**, **stale** and **unsupported** — the three
  ways the tool declined to write one. Every status is shown, because a question the tool
  refuses to answer for you is a work item, not a leftover; within a group the run's own order
  (band, then criterion, then selector) is kept.
- A ready patch shows its file, line and column, its one-line description, and the **old and new
  text side by side**: two labelled blocks, never a merged view. Each block says in a heading
  which it is, the edges differ in style rather than in hue, and the −/+ markers are decorative.
  Colour distinguishes nothing here — a red/green diff is exactly what 1.4.1 forbids as the only
  signal.
- `old_text` and `new_text` are raw markup out of somebody's HTML file, and a question may quote
  it. Both land in a text node inside a `<code>` element, which React escapes. There is no
  `dangerouslySetInnerHTML` in this project and there must not be.
- Patches are matched to findings by `finding_hash`, as suggestions are: `run_patches` has a
  foreign key onto `run_findings (run_id, finding_hash)`, so a stored patch always points at a
  finding that really is in that run. It matters more here than for text — a patch names a file
  and a line in it.
- **Who decided and when are the server's to write.** A trigger stamps `decided_by`,
  `decided_by_email` and `decided_at` from the caller's own token and the database clock.
- Re-uploading the patch file replaces the patches in place and leaves every decision alone. A
  decision older than the patch it is attached to is shown with a line saying so, which matters
  more here than for AI text: a re-run against a changed file can move an edit to a different
  line, and an "accepted" on the old one would be an accepted edit nobody read.
- The parser is **strict about the shape as well as the values**, unlike the explanations parser:
  the patch format is fixed and versioned (`patch_schema_version: 1`), so there is no older
  spelling to be generous towards. A hash that is not lowercase hex, a status outside the five, a
  source outside rule/ai, a position that is not a 1-based integer, or an edit longer than the
  column stores is dropped and counted, never guessed. An over-long *edit* is dropped rather than
  truncated — half an edit shown as the edit would be a lie about what would happen to a file —
  while a description or a question, which nobody applies, is cut at the cap. Edit text is never
  trimmed or normalised: whitespace is part of the edit. The logic is `src/lib/review/patches.ts`
  and `src/lib/review/patch-decisions.ts`, unit-tested; database access is
  `src/lib/db/patches.ts`.

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

- **Running a scan inside the dashboard** — Chromium does not run on a typical Next.js host;
  Run audit hands the scan to a separate worker instead, and is hidden without one.
- **Applying a patch** — Phase 5's patch *review* is built (below): `accesslens fix` proposes
  the edits, the Source patches screen shows each one's before and after and records a decision.
  What is deliberately absent is the button that would make the edit. Nothing in this dashboard
  writes to a file, and the mockup's "apply" is a person's job, in their own working copy.
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
- **The AI text is untrusted twice over.** A suggestion was written by a model that was shown
  markup taken from a scanned page, so both the page and the model are treated as hostile: the
  explanation, the suggested fix and the reviewer's own edit are all rendered as text, every
  value is length-capped and type-checked before it is stored, and a suggested fix — usually a
  fragment of HTML — is shown in a `<code>` block, never as markup.
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
- **There is a dark palette too**, under `prefers-color-scheme: dark`, covering every token and
  measured the same way against both dark surfaces: `--ink` 13.12:1, `--ink-soft` 7.46:1,
  `--accent` 8.49:1, critical 8.05:1, serious 7.90:1, moderate 8.56:1, review 7.31:1 on the
  dark sheet, and `--rule-strong` 5.40:1 for 1.4.11. It is not inverted light mode: white on
  black halates, so the surfaces are a dark blue-grey neutral and the text is dimmed rather
  than driven to 21:1. The whole table, the method and what is not verified are in
  `docs/self-audit.md`.
- Form control borders use `--rule-strong`, 4.05:1 on the report surface and 3.42:1 on the page
  ground, above the 3:1 that rule 1.4.11 requires. It was `#94a0b4` at first, commented as
  3.1:1; crawling the running dashboard with AccessLens measured 2.64:1 and 2.23:1 and failed
  every input and select, which is how it was caught.
- **Fix review is one tab sequence per finding.** The decision controls are a single form with
  several submit buttons, and the edit and reject panels are `<details>` elements, so nothing
  needs JavaScript to open, reach or operate. Every textarea has a real `<label>` and a hint
  tied to it with `aria-describedby`; each repeated button carries a visually-hidden phrase
  naming the finding it acts on, so "Accept as written" is never read out on its own. The
  state of each decision is a word inside its tag, not a colour, and the AI block is given no
  status colour at all — it is not a result, and colouring it like one would read as a verdict
  the model is not entitled to make.
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

- **The colour scheme follows the operating system, and there is no in-page toggle.** This app
  works with JavaScript off by design, so a toggle would mean a cookie plus a server action plus
  a control on every page; `prefers-color-scheme` carries the preference already. Both palettes
  are measured against both of their own surfaces (`docs/self-audit.md`), but **the CLI has only
  ever scanned the light one** — `accesslens scan` drives Chromium in its default scheme and has
  no flag for the other, so "no failures" is a statement about light mode.
- **No pagination.** A run with thousands of findings renders them all. The fixtures and any
  realistic student-project crawl are far smaller; a crawl of a large site would need it.
- **Filters are exact-match**, not free-text search.
- **Uploads are manual.** A CLI uploader is deliberately not built.
- **Dates are formatted in the server's timezone**, since the pages render on the server.
- **Deleting a run is immediate**, behind a disclosure rather than a modal. There is no undo; the
  report file on your machine is the only other copy.
- **Fix review has one reviewer per finding**, not a queue with a second opinion: a decision
  replaces whatever was there. Each run has its own decisions, so the same problem reviewed on
  run #4 is "not yet reviewed" again on run #5, since a run's findings are what a decision
  hangs off. There is no audit trail of who decided what before the current decision.
- **Patch review has the same one-reviewer, per-run shape as fix review**, and one decision per
  finding: a run's patch set carries at most one patch per finding, as the CLI produces. There is
  no audit trail of earlier decisions, and no check that an "applied" edit was really made — it
  is a person's word, recorded as such. `accesslens fix` only works on a scan of a local file, so
  a crawl and a scan of a live URL have no patch set to upload.
- **Explanations are uploaded per run**, by hand, like reports. Re-uploading replaces the text
  and keeps every decision; a decision older than the text it is attached to is marked as such
  rather than cleared.
- **Nothing verifies a suggested fix.** It is a draft written by a model that saw the finding's
  JSON and never the page. Accepting one records that a person read it, and nothing more.
