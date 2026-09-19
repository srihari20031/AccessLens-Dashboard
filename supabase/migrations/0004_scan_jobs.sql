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
-- The user holds a token that can write this table directly, so the limits cannot rest on the
-- dashboard behaving. Three rules close the ways round them:
--   * There is no delete policy. The daily count is over the user's own rows; deleting old
--     ones would reset it. A job row is removed only with its user (on delete cascade).
--   * A before-insert trigger sets every column but url, kind, max_pages and
--     permission_confirmed, so a job cannot be inserted backdated, already running or done.
--   * A before-update trigger keeps the request immutable, lets status only move forward
--     (queued -> running | failed, running -> done | failed), sets every timestamp from the
--     database clock, writes report and error once, and lets run_id point only at one of the
--     caller's own runs, once (or back to null when that run is deleted).
-- A check caps the stored report at 5 MB, the same as a file upload.
--
-- Safe to run on a project that already holds runs: it only adds a table, its policies,
-- trigger functions, a check and an index, and touches nothing that exists. Re-running it is
-- harmless, and on a project that ran an earlier draft of it, it removes the delete policy.
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

-- No delete policy, on purpose (see the header). An earlier draft had one; drop it if present.
drop policy if exists scan_jobs_delete on public.scan_jobs;

-- ---------------------------------------------------------------- quota

create or replace function public.scan_jobs_enforce_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- The caller chooses url, kind, max_pages and permission_confirmed only. Everything else is
  -- the server's, so a job cannot start life backdated (escaping the daily count), running,
  -- done with a forged report, or linked to a run.
  new.user_id     := coalesce(auth.uid(), new.user_id);
  new.status      := 'queued';
  new.error       := null;
  new.report      := null;
  new.run_id      := null;
  new.created_at  := now();
  new.started_at  := null;
  new.finished_at := null;

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

-- ---------------------------------------------------------------- update guard

-- Who updates a job: the worker (queued -> running, running -> done with the report,
-- running -> failed or queued -> failed with a fixed message), the dashboard (queued -> failed
-- when the worker could not be reached; done -> done setting run_id once the report is
-- imported), and Postgres itself (run_id -> null when that run is deleted, through the
-- foreign key's on delete set null). Everything else is refused.
create or replace function public.scan_jobs_guard_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- The request is immutable.
  if new.id is distinct from old.id
  or new.user_id is distinct from old.user_id
  or new.url is distinct from old.url
  or new.kind is distinct from old.kind
  or new.max_pages is distinct from old.max_pages
  or new.permission_confirmed is distinct from old.permission_confirmed
  or new.created_at is distinct from old.created_at then
    raise exception 'scan_jobs: a job''s request cannot be changed';
  end if;

  -- Status only moves forward, and the timestamps are the server's.
  if new.status is distinct from old.status then
    if not ((old.status = 'queued'  and new.status in ('running', 'failed'))
         or (old.status = 'running' and new.status in ('done', 'failed'))) then
      raise exception 'scan_jobs: status cannot go from % to %', old.status, new.status;
    end if;
    if new.status = 'running' and old.created_at <= now() - interval '30 minutes' then
      raise exception 'scan_jobs: a stale job cannot start';
    end if;
    if new.status = 'done' and new.report is null then
      raise exception 'scan_jobs: a finished job needs a report';
    end if;
    if new.status = 'failed' and new.error is null then
      raise exception 'scan_jobs: a failed job needs an error';
    end if;
    if new.status = 'running' then
      new.started_at := now();  new.finished_at := old.finished_at;
    else
      new.started_at := old.started_at;  new.finished_at := now();
    end if;
  else
    new.started_at := old.started_at;
    new.finished_at := old.finished_at;
  end if;

  -- The report and the error are each written once, by the transition that produces them.
  if new.report is distinct from old.report
     and not (old.status = 'running' and new.status = 'done') then
    raise exception 'scan_jobs: the report is written once, when the job finishes';
  end if;
  if new.error is distinct from old.error
     and not (old.status in ('queued', 'running') and new.status = 'failed') then
    raise exception 'scan_jobs: the error is written once, when the job fails';
  end if;

  if new.run_id is distinct from old.run_id then
    if old.status <> 'done' or new.status <> 'done' then
      raise exception 'scan_jobs: only a finished job links to a run';
    end if;
    -- null -> own run (import), or -> null (runs.id on delete set null)
    if new.run_id is not null and (old.run_id is not null or not exists (
         select 1 from public.runs r where r.id = new.run_id and r.user_id = auth.uid())) then
      raise exception 'scan_jobs: run_id must be one of your runs, set once';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scan_jobs_guard_update on public.scan_jobs;
create trigger scan_jobs_guard_update
  before update on public.scan_jobs
  for each row execute function public.scan_jobs_guard_update();

-- ---------------------------------------------------------------- report size

-- The same 5 MB cap as a file upload, measured on the stored JSON text.
alter table public.scan_jobs drop constraint if exists scan_jobs_report_size;
alter table public.scan_jobs add constraint scan_jobs_report_size
  check (report is null or octet_length(report::text) <= 5 * 1024 * 1024);
