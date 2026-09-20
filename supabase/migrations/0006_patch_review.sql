-- Source-patch review: the concrete edits a run's report suggests, and a reviewer's decision
-- about each one.
--
-- The CLI writes a patch set (`accesslens fix report.json --json patches.json`): for each
-- non-passing finding of a scan of a *local file*, one proposed text edit anchored to the line
-- and column the scan recorded, or — where a machine must not decide what the right value is —
-- a plain question for the owner. A patch is a proposal about somebody's source file, so it
-- needs a person to accept, reject or mark it applied before anyone acts on it. This migration
-- adds the two tables that workflow needs.
--
--   public.run_patches     the patch set, one row per (run, finding), imported from that file.
--   public.patch_reviews   one reviewer's decision per (run, finding).
--
-- The same shape as migration 0005, deliberately: the AI-text review and the patch review are
-- the same workflow over different material, and a reader who knows one should recognise the
-- other. Two tables rather than one because they have different authors — a patch is machine
-- output with a position and a rule behind it, a review is a human record with a name and a
-- time on it. Keeping them apart means re-importing a patch file cannot quietly rewrite what
-- somebody decided.
--
-- **Nothing here changes a finding, and nothing here edits a file.** No column of
-- `run_findings` is touched; neither table carries an outcome, a severity or a band; and no
-- code path from this dashboard writes to anyone's disk. A row of `run_patches` is a *proposed*
-- edit as text, and a row of `patch_reviews` is what a person thought of it. Applying a patch
-- happens on the command line, against a working copy, under version control.
--
-- Both tables key on (run_id, finding_hash) with a foreign key onto `run_findings`, whose
-- (run_id, finding_hash) is unique (migration 0001). So a patch or a decision can only ever
-- point at a finding that really is in that run, and both disappear with the finding, the run
-- and the user, through the cascade that already exists. The CLI produces at most one patch per
-- finding — its own sort key uses the finding hash as the tie-break for two edits at one
-- position — so one row per (run, finding) loses nothing.
--
-- Row-level security is the same shape as `run_pages` and `run_findings` in 0001: a row is
-- reachable only through a run whose `user_id` is the caller. This project has no organisations
-- table — ownership is per user — so "only your own organisation's rows" is, here, "only your
-- own account's rows".
--
-- Safe to run on a project that already holds runs: it only adds two tables, their policies,
-- one trigger function and its trigger, and touches nothing that exists. Re-running it is
-- harmless. Until it has been run, the rest of the dashboard works unchanged; the Source
-- patches screen says which file to run and stops there.

-- ---------------------------------------------------------------- the proposed edits

create table if not exists public.run_patches (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null,
  finding_hash   text not null,
  -- Which success criterion and which rule the edit comes from, copied so the screen can name
  -- a patch without reading the finding again.
  criterion      text not null default '',
  rule_id        text not null default '',
  -- One line for a list: 'add lang="en" to <html>'. Rendered as text, never as markup.
  description    text not null default '',
  -- What the CLI could and could not do with this finding:
  --   ready        an edit that matched the file and can be applied as written
  --   needs-input  no machine may choose the value; `question` asks the owner for it
  --   unsupported  no generator for this rule yet
  --   stale        the file has changed since the scan, so the position no longer holds
  --   conflict     the edit overlaps another one
  -- Every status is stored, because the questions are work items too, not leftovers.
  status         text not null check (
    status in ('ready', 'needs-input', 'unsupported', 'stale', 'conflict')
  ),
  -- Who proposed the edit: a deterministic rule, or the AI layer. Never a verdict either way.
  source         text not null default 'rule' check (source in ('rule', 'ai')),
  -- Where in the scanned file, exactly as `source_location` records it: 1-based, and columns
  -- count characters rather than bytes.
  path           text not null default '',
  start_line     integer not null check (start_line >= 1),
  start_column   integer not null check (start_column >= 1),
  -- The edit itself, as raw text from somebody's HTML file. `old_text` is what must be there
  -- now and is empty for an insertion; `new_text` replaces it and is empty for a deletion.
  -- Both are shown in a `<code>` element as text, and nothing in this dashboard ever applies
  -- them to anything.
  old_text       text not null default '',
  new_text       text not null default '',
  -- The plain question a `needs-input` patch asks its owner, and the one thing on that patch
  -- that is the point of it. The CLI writes it only for that status; no constraint ties the two
  -- together, because a future status that also had something to ask would then be refused at
  -- import rather than shown. Null when the file carried none.
  question       text,
  imported_at    timestamptz not null default now(),
  constraint run_patches_unique unique (run_id, finding_hash),
  constraint run_patches_sizes check (
    char_length(old_text) <= 8000
    and char_length(new_text) <= 8000
    and char_length(description) <= 500
    and char_length(path) <= 1000
    and char_length(criterion) <= 20
    and char_length(rule_id) <= 120
    and coalesce(char_length(question), 0) <= 2000
  ),
  constraint run_patches_finding foreign key (run_id, finding_hash)
    references public.run_findings (run_id, finding_hash) on delete cascade
);

create index if not exists run_patches_run_idx on public.run_patches (run_id);

-- ---------------------------------------------------------------- the decision

create table if not exists public.patch_reviews (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null,
  finding_hash text not null,
  -- 'pending' is a row that exists but has not been decided. A patch with no row at all is
  -- pending too, which is why the screen counts pending from the patches rather than here.
  -- 'applied' is a person saying they made the edit in their own working copy; it is a record
  -- of what a human did, never something this dashboard does.
  decision     text not null check (
    decision in ('pending', 'accepted', 'rejected', 'applied')
  ),
  -- Optional, and only when rejecting: why the proposed edit was not taken.
  reason       text,
  -- Who decided, stamped by the trigger below from the caller's own token, never from the
  -- request body. The email is the claim in that token, kept so the record reads as a name.
  decided_by       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  decided_by_email text,
  decided_at       timestamptz not null default now(),
  constraint patch_reviews_unique unique (run_id, finding_hash),
  constraint patch_reviews_reason_only_on_reject check (reason is null or decision = 'rejected'),
  constraint patch_reviews_sizes check (coalesce(char_length(reason), 0) <= 1000),
  constraint patch_reviews_finding foreign key (run_id, finding_hash)
    references public.run_findings (run_id, finding_hash) on delete cascade
);

create index if not exists patch_reviews_run_idx on public.patch_reviews (run_id);

-- Who decided and when are the server's to write, not the caller's. A user holds a token that
-- can write this table directly, so the columns are stamped here rather than trusted from the
-- request: `auth.uid()` and the email claim of that same token, and the database clock.
create or replace function public.patch_reviews_stamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.decided_by       := coalesce(auth.uid(), new.decided_by);
  new.decided_by_email := coalesce(nullif(auth.jwt() ->> 'email', ''), new.decided_by_email);
  new.decided_at       := now();
  return new;
end;
$$;

drop trigger if exists patch_reviews_stamp on public.patch_reviews;
create trigger patch_reviews_stamp
  before insert or update on public.patch_reviews
  for each row execute function public.patch_reviews_stamp();

-- ---------------------------------------------------------------- row-level security
--
-- The same shape as run_pages and run_findings in 0001, and as run_suggestions and fix_reviews
-- in 0005: reachable only through one of the caller's own runs. The dashboard talks to Postgres
-- as the signed-in user and never uses the service-role key, so these policies are the whole of
-- the access control.

alter table public.run_patches    enable row level security;
alter table public.patch_reviews  enable row level security;

drop policy if exists run_patches_select on public.run_patches;
create policy run_patches_select on public.run_patches
  for select using (exists (
    select 1 from public.runs r where r.id = run_patches.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_patches_insert on public.run_patches;
create policy run_patches_insert on public.run_patches
  for insert with check (exists (
    select 1 from public.runs r where r.id = run_patches.run_id and r.user_id = auth.uid()
  ));

-- Re-importing the patch file for a run replaces its patches in place, which is an update.
drop policy if exists run_patches_update on public.run_patches;
create policy run_patches_update on public.run_patches
  for update using (exists (
    select 1 from public.runs r where r.id = run_patches.run_id and r.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.runs r where r.id = run_patches.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_patches_delete on public.run_patches;
create policy run_patches_delete on public.run_patches
  for delete using (exists (
    select 1 from public.runs r where r.id = run_patches.run_id and r.user_id = auth.uid()
  ));

drop policy if exists patch_reviews_select on public.patch_reviews;
create policy patch_reviews_select on public.patch_reviews
  for select using (exists (
    select 1 from public.runs r where r.id = patch_reviews.run_id and r.user_id = auth.uid()
  ));

drop policy if exists patch_reviews_insert on public.patch_reviews;
create policy patch_reviews_insert on public.patch_reviews
  for insert with check (exists (
    select 1 from public.runs r where r.id = patch_reviews.run_id and r.user_id = auth.uid()
  ));

drop policy if exists patch_reviews_update on public.patch_reviews;
create policy patch_reviews_update on public.patch_reviews
  for update using (exists (
    select 1 from public.runs r where r.id = patch_reviews.run_id and r.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.runs r where r.id = patch_reviews.run_id and r.user_id = auth.uid()
  ));

-- Clearing a decision removes the row, which is how a patch goes back to "not yet reviewed".
drop policy if exists patch_reviews_delete on public.patch_reviews;
create policy patch_reviews_delete on public.patch_reviews
  for delete using (exists (
    select 1 from public.runs r where r.id = patch_reviews.run_id and r.user_id = auth.uid()
  ));
