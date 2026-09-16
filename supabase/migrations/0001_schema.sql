-- AccessLens dashboard: tables and row-level security.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) before the first upload.
--
-- Three tables hold one uploaded report each: the run, the pages it covered, and the findings
-- it reported. A scan (schema 1) and a crawl (schema 2) are stored in exactly the same shape;
-- the mapping that makes them alike lives in web/src/lib/report/map.ts and is unit-tested.
--
-- Only non-passing findings are stored. A page's passes are a count on the page row. That is
-- deliberate: a scan of a large page can carry hundreds of pass findings that nothing in the
-- dashboard ever shows individually, and a crawl report does not carry them at all, so storing
-- them would make the two kinds of run different for no gain.

create table if not exists public.runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('scan', 'crawl')),
  schema_version int  not null,
  target_url    text not null,
  tool_version  text not null,
  -- rule id -> version, from run.rule_versions. Compare warns when two runs disagree here.
  rule_versions jsonb not null default '{}'::jsonb,
  -- The whole `run` block as the CLI wrote it, plus `skipped` and `not_visited` for a crawl.
  run_meta      jsonb not null default '{}'::jsonb,
  -- {critical, serious, moderate, needs-manual-review}, each distinct finding counted once.
  site_bands    jsonb not null default '{}'::jsonb,
  label         text,
  created_at    timestamptz not null default now()
);

create index if not exists runs_user_created_idx on public.runs (user_id, created_at desc);
create index if not exists runs_user_target_idx  on public.runs (user_id, target_url);

create table if not exists public.run_pages (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.runs (id) on delete cascade,
  url         text not null,
  -- null for a scan: one page, no crawl depth.
  depth       int,
  status      text not null check (
                status in ('evaluated', 'load-error', 'http-error',
                           'redirected-off-host', 'redirected-disallowed')),
  http_status int,
  error_kind  text,
  bands       jsonb not null default '{}'::jsonb,
  pass_count  int  not null default 0 check (pass_count >= 0)
);

create index if not exists run_pages_run_idx on public.run_pages (run_id, url);

create table if not exists public.run_findings (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete cascade,
  -- blake2b over the finding's stable identity; the join key for comparing two runs.
  finding_hash  text not null,
  criterion     text not null,
  criterion_name text not null,
  rule_id       text not null,
  rule_version  text not null,
  -- 'pass' is absent on purpose: passes are counted on run_pages, never stored as findings.
  outcome       text not null check (outcome in ('fail', 'needs-manual-review')),
  -- A non-passing finding always carries a severity (accesslens Finding.__post_init__
  -- enforces PASS <=> severity is null), so this is not null here.
  severity      text not null check (severity in ('critical', 'serious', 'moderate')),
  band          text not null check (
                  band in ('critical', 'serious', 'moderate', 'needs-manual-review')),
  tag           text not null,
  selector      text not null,
  -- Raw HTML from the page. Always rendered as text, never inserted as markup.
  snippet       text not null,
  evidence      jsonb not null default '{}'::jsonb,
  message       text not null,
  -- [{url, document_order}] — every page this finding was seen on.
  pages         jsonb not null default '[]'::jsonb,
  -- The banding rule, enforced here as well as in TypeScript: a review is always the review
  -- band however severe it is; a fail takes its severity's band.
  constraint run_findings_band_matches_outcome check (
    (outcome = 'needs-manual-review' and band = 'needs-manual-review')
    or (outcome = 'fail' and band = severity)
  ),
  constraint run_findings_unique_hash unique (run_id, finding_hash)
);

create index if not exists run_findings_run_band_idx on public.run_findings (run_id, band);
create index if not exists run_findings_run_criterion_idx on public.run_findings (run_id, criterion);
create index if not exists run_findings_hash_idx on public.run_findings (finding_hash);

-- ---------------------------------------------------------------- row-level security
--
-- A user reaches only their own runs, and only the child rows of their own runs. The dashboard
-- talks to Postgres as the signed-in user and never uses the service-role key, so these
-- policies are the whole of the access control.

alter table public.runs         enable row level security;
alter table public.run_pages    enable row level security;
alter table public.run_findings enable row level security;

drop policy if exists runs_select on public.runs;
create policy runs_select on public.runs
  for select using (auth.uid() = user_id);

drop policy if exists runs_insert on public.runs;
create policy runs_insert on public.runs
  for insert with check (auth.uid() = user_id);

-- Not in the original brief: renaming a run's label is an update, and without this a label
-- could only be set at upload time. Nothing else about a run is editable.
drop policy if exists runs_update on public.runs;
create policy runs_update on public.runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists runs_delete on public.runs;
create policy runs_delete on public.runs
  for delete using (auth.uid() = user_id);

drop policy if exists run_pages_select on public.run_pages;
create policy run_pages_select on public.run_pages
  for select using (exists (
    select 1 from public.runs r where r.id = run_pages.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_pages_insert on public.run_pages;
create policy run_pages_insert on public.run_pages
  for insert with check (exists (
    select 1 from public.runs r where r.id = run_pages.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_pages_delete on public.run_pages;
create policy run_pages_delete on public.run_pages
  for delete using (exists (
    select 1 from public.runs r where r.id = run_pages.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_findings_select on public.run_findings;
create policy run_findings_select on public.run_findings
  for select using (exists (
    select 1 from public.runs r where r.id = run_findings.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_findings_insert on public.run_findings;
create policy run_findings_insert on public.run_findings
  for insert with check (exists (
    select 1 from public.runs r where r.id = run_findings.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_findings_delete on public.run_findings;
create policy run_findings_delete on public.run_findings
  for delete using (exists (
    select 1 from public.runs r where r.id = run_findings.run_id and r.user_id = auth.uid()
  ));
