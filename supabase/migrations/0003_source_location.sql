-- Keep each finding's source location.
--
-- A finding carries `source_location` ({path, line, column}) when the CLI can map the element
-- back to the file it was written in, and null when it cannot. Every report the CLI produces
-- today scans a live URL, so today it is always null — but "cannot map to source" is an answer
-- the dashboard shows, and a mapped location must not be thrown away once the CLI can produce
-- one.
--
-- Safe to run on a project that already holds runs: the column is nullable and existing rows
-- read back as "not mapped", which is exactly what they were. Until this has been run, uploads
-- still work (the old import_run ignores the extra key) and the dashboard shows every finding
-- as not mapped.

alter table public.run_findings add column if not exists source_location jsonb;

create or replace function public.import_run(
  p_run      jsonb,
  p_pages    jsonb,
  p_findings jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if auth.uid() is null then
    raise exception 'import_run requires a signed-in user';
  end if;

  insert into public.runs (
    user_id, kind, schema_version, target_url, tool_version,
    rule_versions, run_meta, site_bands, label
  )
  values (
    auth.uid(),
    p_run ->> 'kind',
    (p_run ->> 'schema_version')::int,
    p_run ->> 'target_url',
    p_run ->> 'tool_version',
    coalesce(p_run -> 'rule_versions', '{}'::jsonb),
    coalesce(p_run -> 'run_meta', '{}'::jsonb),
    coalesce(p_run -> 'site_bands', '{}'::jsonb),
    nullif(btrim(coalesce(p_run ->> 'label', '')), '')
  )
  returning id into v_run_id;

  insert into public.run_pages (
    run_id, url, depth, status, http_status, error_kind, bands, pass_count
  )
  select v_run_id, page.url, page.depth, page.status, page.http_status,
         page.error_kind, coalesce(page.bands, '{}'::jsonb), coalesce(page.pass_count, 0)
  from jsonb_to_recordset(coalesce(p_pages, '[]'::jsonb)) as page(
    url text, depth int, status text, http_status int,
    error_kind text, bands jsonb, pass_count int
  );

  insert into public.run_findings (
    run_id, finding_hash, criterion, criterion_name, rule_id, rule_version,
    outcome, severity, band, tag, selector, snippet, evidence, message, pages,
    source_location
  )
  select v_run_id, finding.finding_hash, finding.criterion, finding.criterion_name,
         finding.rule_id, finding.rule_version, finding.outcome, finding.severity,
         finding.band, finding.tag, finding.selector, finding.snippet,
         coalesce(finding.evidence, '{}'::jsonb), finding.message,
         coalesce(finding.pages, '[]'::jsonb),
         -- jsonb 'null' and SQL null both mean "not mapped"; store only the latter.
         nullif(finding.source_location, 'null'::jsonb)
  from jsonb_to_recordset(coalesce(p_findings, '[]'::jsonb)) as finding(
    finding_hash text, criterion text, criterion_name text, rule_id text, rule_version text,
    outcome text, severity text, band text, tag text, selector text, snippet text,
    evidence jsonb, message text, pages jsonb, source_location jsonb
  );

  return v_run_id;
end;
$$;

revoke all on function public.import_run(jsonb, jsonb, jsonb) from public;
grant execute on function public.import_run(jsonb, jsonb, jsonb) to authenticated;
