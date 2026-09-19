-- Audit jobs: scans started from the dashboard.
--
-- A signed-in user submits the Run audit form; the dashboard inserts one row here as that user
-- and asks the scan worker to run it. The worker reads the row with the user's own token (so
-- row-level security proves the job is theirs), runs the AccessLens CLI, and writes the result
-- back into the same row, again as that user. When the user opens the results, the dashboard
-- validates `report` through exactly the same path as a file upload (`parseReport`,
-- `toImportPayload`, `import_run`) and records the new run's id in `run_id`.
--
-- No service-role key is involved anywhere: the worker holds only the project URL and the
-- anon key, and every read and write below is the signed-in user's own.
--
-- Limits, enforced here rather than only in the form: one active audit per user, and 10 audits
-- per user per 24 hours. A queued or running job older than 30 minutes is treated as stale and
-- no longer blocks a new one, so a worker that died mid-job cannot lock a user out.
--
-- Safe to run on a project that already holds runs: it only adds a table, its policies, a
-- trigger function and an index, and touches nothing that exists. Re-running it is harmless.
-- Until it has been run, the rest of the dashboard works unchanged; only the Run audit form
-- reports that the table is missing.

create table if not exists public.scan_jobs (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url                  text not null
                         check (url ~* '^https?://' and char_length(url) <= 2048),
  kind                 text not null check (kind in ('scan', 'crawl')),
  max_pages            int  not null default 1 check (max_pages between 1 and 20),
  permission_confirmed boolean not null default false,
  status               text not null default 'queued'
                         check (status in ('queued', 'running', 'done', 'failed')),
  -- One of the worker's fixed messages, never raw stderr or a traceback.
  error                text,
  -- The CLI's standard output (schema 1 or 2), exactly as written. Validated on import.
  report               jsonb,
  -- Set once the report has been imported as a run.
  run_id               uuid references public.runs (id) on delete set null,
  created_at           timestamptz not null default now(),
  started_at           timestamptz,
  finished_at          timestamptz,
  -- A scan is one page.
  constraint scan_jobs_scan_is_one_page check (kind <> 'scan' or max_pages = 1),
  -- A crawl visits pages the user did not name, so it needs their say-so.
  constraint scan_jobs_crawl_needs_permission check (kind = 'scan' or permission_confirmed)
);

create index if not exists scan_jobs_user_created_idx
  on public.scan_jobs (user_id, created_at desc);

-- ---------------------------------------------------------------- row-level security

alter table public.scan_jobs enable row level security;

drop policy if exists scan_jobs_select on public.scan_jobs;
create policy scan_jobs_select on public.scan_jobs
  for select using (user_id = auth.uid());

drop policy if exists scan_jobs_insert on public.scan_jobs;
create policy scan_jobs_insert on public.scan_jobs
  for insert with check (user_id = auth.uid());

drop policy if exists scan_jobs_update on public.scan_jobs;
create policy scan_jobs_update on public.scan_jobs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists scan_jobs_delete on public.scan_jobs;
create policy scan_jobs_delete on public.scan_jobs
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------- quota

create or replace function public.scan_jobs_enforce_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Two submissions racing each other would both see zero active jobs. Serialise the check
  -- per user for the rest of this transaction; other users are not affected.
  perform pg_advisory_xact_lock(hashtextextended('scan_jobs:' || new.user_id::text, 0));

  if exists (
    select 1
    from public.scan_jobs j
    where j.user_id = new.user_id
      and (
        (j.status = 'queued' and j.created_at > now() - interval '30 minutes')
        or (j.status = 'running'
            and coalesce(j.started_at, j.created_at) > now() - interval '30 minutes')
      )
  ) then
    raise exception 'One audit at a time: wait for the current one to finish.';
  end if;

  if (
    select count(*)
    from public.scan_jobs j
    where j.user_id = new.user_id
      and j.created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'Daily limit reached: 10 audits per 24 hours.';
  end if;

  return new;
end;
$$;

drop trigger if exists scan_jobs_enforce_quota on public.scan_jobs;
create trigger scan_jobs_enforce_quota
  before insert on public.scan_jobs
  for each row execute function public.scan_jobs_enforce_quota();
