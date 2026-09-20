-- Fix review: the AI text a run carries, and a reviewer's decision about it.
--
-- The CLI writes an explanations file (`accesslens explain report.json --out f.json`): for each
-- non-passing finding, a plain-language explanation, a suggested fix and a confidence. The
-- text is advisory and unverified — the project brief's rule is that the AI layer never detects
-- and never decides — so it needs a person to accept, edit or reject it before anyone acts on
-- it. This migration adds the two tables that workflow needs.
--
--   public.run_suggestions  the AI text, one row per (run, finding), imported from that file.
--   public.fix_reviews      one reviewer's decision per (run, finding).
--
-- Two tables rather than one because they have different authors. A suggestion is machine
-- output with its own model and prompt version; a review is a human record with a name and a
-- time on it. Keeping them apart means re-importing the AI text cannot quietly rewrite what
-- somebody decided, and the review screen can say plainly when the text arrived after the
-- decision was made.
--
-- **Nothing here changes a finding.** No column of `run_findings` is touched, and neither table
-- carries an outcome, a severity or a band. A decision records a judgement about the suggested
-- *text* only: the scanner's verdict is the scanner's, and stays the scanner's.
--
-- Both tables key on (run_id, finding_hash) with a foreign key onto `run_findings`, whose
-- (run_id, finding_hash) is unique (migration 0001). So a suggestion or a decision can only
-- ever point at a finding that really is in that run, and both disappear with the finding, the
-- run and the user, through the cascade that already exists.
--
-- Row-level security is the same shape as `run_pages` and `run_findings`: a row is reachable
-- only through a run whose `user_id` is the caller. This project has no organisations table —
-- ownership is per user, and every policy in 0001 is written that way — so "only your own
-- organisation's rows" is, here, "only your own account's rows".
--
-- Safe to run on a project that already holds runs: it only adds two tables, their policies,
-- one trigger function and its trigger, and touches nothing that exists. Re-running it is
-- harmless. Until it has been run, the rest of the dashboard works unchanged; the Fix review
-- screen says which file to run and stops there.

-- ---------------------------------------------------------------- the AI text

create table if not exists public.run_suggestions (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null,
  finding_hash   text not null,
  -- What the model wrote. Both are rendered as text, never as markup.
  explanation    text not null default '',
  fix            text not null default '',
  -- The model's own stated confidence. Null when the file did not carry a usable one; it is
  -- never guessed, and it says nothing about whether the fix is correct.
  confidence     text check (confidence in ('low', 'medium', 'high')),
  -- Which model answered, which prompt version asked, and which rule version produced the
  -- finding the text is about. All three are part of the CLI's cache key and are recorded so
  -- a reader can tell one import from another.
  model          text,
  prompt_version text,
  rule_version   text,
  imported_at    timestamptz not null default now(),
  constraint run_suggestions_unique unique (run_id, finding_hash),
  constraint run_suggestions_sizes check (
    char_length(explanation) <= 4000 and char_length(fix) <= 8000
  ),
  constraint run_suggestions_finding foreign key (run_id, finding_hash)
    references public.run_findings (run_id, finding_hash) on delete cascade
);

create index if not exists run_suggestions_run_idx on public.run_suggestions (run_id);

-- ---------------------------------------------------------------- the decision

create table if not exists public.fix_reviews (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null,
  finding_hash text not null,
  -- 'pending' is a row that exists but has not been decided. A finding with no row at all is
  -- pending too, which is why the screen counts pending from the suggestions rather than here.
  decision     text not null check (decision in ('pending', 'accepted', 'edited', 'rejected')),
  -- The reviewer's own wording, kept only for an 'edited' decision: the text somebody stands
  -- behind. Any other decision carries none, so a stale draft can never be shown as accepted.
  edited_fix   text,
  -- Optional, and only when rejecting: why the suggested text was not good enough.
  reason       text,
  -- Who decided, stamped by the trigger below from the caller's own token, never from the
  -- request body. The email is the claim in that token, kept so the record reads as a name.
  decided_by       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  decided_by_email text,
  decided_at       timestamptz not null default now(),
  constraint fix_reviews_unique unique (run_id, finding_hash),
  constraint fix_reviews_edited_has_text check (
    (decision = 'edited') = (edited_fix is not null and btrim(edited_fix) <> '')
  ),
  constraint fix_reviews_reason_only_on_reject check (reason is null or decision = 'rejected'),
  constraint fix_reviews_sizes check (
    coalesce(char_length(edited_fix), 0) <= 8000 and coalesce(char_length(reason), 0) <= 1000
  ),
  constraint fix_reviews_finding foreign key (run_id, finding_hash)
    references public.run_findings (run_id, finding_hash) on delete cascade
);

create index if not exists fix_reviews_run_idx on public.fix_reviews (run_id);

-- Who decided and when are the server's to write, not the caller's. A user holds a token that
-- can write this table directly, so the columns are stamped here rather than trusted from the
-- request: `auth.uid()` and the email claim of that same token, and the database clock.
create or replace function public.fix_reviews_stamp()
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

drop trigger if exists fix_reviews_stamp on public.fix_reviews;
create trigger fix_reviews_stamp
  before insert or update on public.fix_reviews
  for each row execute function public.fix_reviews_stamp();

-- ---------------------------------------------------------------- row-level security
--
-- The same shape as run_pages and run_findings in 0001: reachable only through one of the
-- caller's own runs. The dashboard talks to Postgres as the signed-in user and never uses the
-- service-role key, so these policies are the whole of the access control.

alter table public.run_suggestions enable row level security;
alter table public.fix_reviews     enable row level security;

drop policy if exists run_suggestions_select on public.run_suggestions;
create policy run_suggestions_select on public.run_suggestions
  for select using (exists (
    select 1 from public.runs r where r.id = run_suggestions.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_suggestions_insert on public.run_suggestions;
create policy run_suggestions_insert on public.run_suggestions
  for insert with check (exists (
    select 1 from public.runs r where r.id = run_suggestions.run_id and r.user_id = auth.uid()
  ));

-- Re-importing the file for a run replaces its text in place, which is an update.
drop policy if exists run_suggestions_update on public.run_suggestions;
create policy run_suggestions_update on public.run_suggestions
  for update using (exists (
    select 1 from public.runs r where r.id = run_suggestions.run_id and r.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.runs r where r.id = run_suggestions.run_id and r.user_id = auth.uid()
  ));

drop policy if exists run_suggestions_delete on public.run_suggestions;
create policy run_suggestions_delete on public.run_suggestions
  for delete using (exists (
    select 1 from public.runs r where r.id = run_suggestions.run_id and r.user_id = auth.uid()
  ));

drop policy if exists fix_reviews_select on public.fix_reviews;
create policy fix_reviews_select on public.fix_reviews
  for select using (exists (
    select 1 from public.runs r where r.id = fix_reviews.run_id and r.user_id = auth.uid()
  ));

drop policy if exists fix_reviews_insert on public.fix_reviews;
create policy fix_reviews_insert on public.fix_reviews
  for insert with check (exists (
    select 1 from public.runs r where r.id = fix_reviews.run_id and r.user_id = auth.uid()
  ));

drop policy if exists fix_reviews_update on public.fix_reviews;
create policy fix_reviews_update on public.fix_reviews
  for update using (exists (
    select 1 from public.runs r where r.id = fix_reviews.run_id and r.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.runs r where r.id = fix_reviews.run_id and r.user_id = auth.uid()
  ));

-- Clearing a decision removes the row, which is how a finding goes back to "not yet reviewed".
drop policy if exists fix_reviews_delete on public.fix_reviews;
create policy fix_reviews_delete on public.fix_reviews
  for delete using (exists (
    select 1 from public.runs r where r.id = fix_reviews.run_id and r.user_id = auth.uid()
  ));
