/**
 * What to do when the app has no Supabase project behind it yet.
 *
 * An empty screen here would look like a bug. This is the first thing a new checkout shows,
 * so it is written as instructions rather than as an error.
 */
export function SetupNotice() {
  return (
    <div className="stack">
      <h1>Connect a Supabase project</h1>
      <div className="notice notice--warning stack-tight">
        <p className="prose">
          This dashboard stores reports in Supabase, and no project is configured yet. Three steps:
        </p>
        <ol className="prose" style={{ paddingLeft: '1.5rem' }}>
          <li>
            Create a project at <code className="mono">supabase.com</code>.
          </li>
          <li>
            In the SQL editor, run <code className="mono">web/supabase/migrations/0001_schema.sql</code>{' '}
            then <code className="mono">web/supabase/migrations/0002_import_run.sql</code>.
          </li>
          <li>
            Copy <code className="mono">web/.env.example</code> to{' '}
            <code className="mono">web/.env.local</code>, fill in the project URL and the anon
            (publishable) key from Project Settings → API, and restart{' '}
            <code className="mono">npm run dev</code>.
          </li>
        </ol>
        <p className="prose small">
          The service-role key is not needed and must not be put here. Every query runs as the
          signed-in user so that row-level security applies.
        </p>
      </div>
    </div>
  );
}
