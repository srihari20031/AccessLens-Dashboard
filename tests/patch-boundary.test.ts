import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * The patch-review boundary, enforced rather than promised.
 *
 * The sibling of `review-boundary.test.ts`, and for the same reason: the two claims this
 * screen makes in its own copy are exactly the kind a later change can break while every
 * other test still passes.
 *
 *   1. A decision never changes a finding — not its outcome, not its severity, not its band.
 *   2. Nothing here edits anyone's files. The dashboard stores proposed edits as text and
 *      displays them; applying one is something a person does on their own machine. A single
 *      `writeFile` in this feature would turn a review screen into a tool that edits source
 *      files it has never seen, from a file somebody uploaded.
 *
 * Both are checked against the source itself, because there is no unit test of a screen that
 * would notice.
 */

const root = fileURLToPath(new URL('../', import.meta.url));

function read(relative: string): string {
  return readFileSync(path.join(root, relative), 'utf8');
}

function filesUnder(relative: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.includes(path.extname(entry))) out.push(full);
    }
  };
  walk(path.join(root, relative));
  return out;
}

/** SQL with its `--` comment lines removed, so prose about a column is not read as one. */
function sqlWithoutComments(relative: string): string {
  return read(relative)
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
}

/** Source with its comment lines removed, so prose about a word is not read as code. */
function codeWithoutComments(relative: string): string {
  return read(relative)
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

const MIGRATION = 'supabase/migrations/0006_patch_review.sql';

const WRITE_PATHS = ['src/lib/db/patches.ts', 'src/app/runs/[id]/patches/actions.ts'] as const;

/** Every file this feature is made of. */
const FEATURE_PATHS = [
  'src/lib/review/patches.ts',
  'src/lib/review/patch-decisions.ts',
  'src/lib/db/patches.ts',
  'src/components/PatchSummary.tsx',
  ...filesUnder('src/app/runs/[id]/patches', ['.ts', '.tsx']).map((file) =>
    path.relative(root, file).split(path.sep).join('/'),
  ),
] as const;

describe('a patch decision never changes a finding', () => {
  it.each(WRITE_PATHS)('%s never writes to run_findings', (file) => {
    // Reading the findings of a run is another module's job; this one has no business
    // naming that table in a query at all.
    expect(read(file)).not.toMatch(/from\(\s*['"]run_findings['"]/);
  });

  it.each(WRITE_PATHS)('%s selects and writes no outcome, severity or band', (file) => {
    expect(codeWithoutComments(file)).not.toMatch(/\b(outcome|severity|band)\b/);
  });

  it('gives the patch tables no outcome, severity or band column', () => {
    const sql = sqlWithoutComments(MIGRATION);
    expect(sql).toMatch(/create table if not exists public\.run_patches/);
    expect(sql).toMatch(/create table if not exists public\.patch_reviews/);
    expect(sql).not.toMatch(/\b(outcome|severity|band)\b/);
  });

  it('adds no column to run_findings and alters no existing table', () => {
    const sql = sqlWithoutComments(MIGRATION);
    expect(sql).not.toMatch(/alter table public\.run_findings/);
    expect(sql).not.toMatch(/alter table public\.runs\b/);
    // The only `alter table` statements are the two that switch row-level security on.
    const alters = sql.match(/alter table [^;]+;/g) ?? [];
    expect(alters.every((statement) => /enable row level security/.test(statement))).toBe(true);
  });
});

describe('nothing in patch review edits a file', () => {
  it.each(FEATURE_PATHS)('%s opens no filesystem module', (file) => {
    const code = codeWithoutComments(file);
    expect(code).not.toMatch(/from\s+['"](node:)?fs(\/promises)?['"]/);
    expect(code).not.toMatch(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/);
    expect(code).not.toMatch(/from\s+['"](node:)?child_process['"]/);
  });

  it.each(FEATURE_PATHS)('%s calls no write, unlink or spawn', (file) => {
    const code = codeWithoutComments(file);
    expect(code).not.toMatch(/\b(writeFile|writeFileSync|appendFile|unlink|rmSync|mkdir)\b/);
    expect(code).not.toMatch(/\b(exec|execSync|spawn|spawnSync)\s*\(/);
  });

  it('says so in the words the screen shows the reader', () => {
    // Whitespace-collapsed, because the sentence is wrapped across lines in the JSX.
    const page = read('src/app/runs/[id]/patches/page.tsx').replace(/\s+/g, ' ');
    expect(page).toMatch(/records decisions about proposed edits/i);
    expect(page).toMatch(/does not edit anything/i);
  });
});

describe('the proposed edits are rendered as text', () => {
  it('has no dangerouslySetInnerHTML anywhere in src', () => {
    // The same guard `review-boundary.test.ts` keeps, restated here because this feature is
    // the one that displays raw markup from a scanned file side by side.
    const offenders = filesUnder('src', ['.ts', '.tsx']).filter((file) =>
      /dangerouslySetInnerHTML\s*=/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('puts both sides of the diff in a code element', () => {
    const diff = read('src/app/runs/[id]/patches/PatchDiff.tsx');
    expect(diff).toMatch(/<code className="code-well diff__text">\{side\.text\}<\/code>/);
  });
});

describe('who decided is the database’s to say', () => {
  it('stamps the reviewer from the token, not from the request body', () => {
    const sql = sqlWithoutComments(MIGRATION);
    expect(sql).toMatch(/create or replace function public\.patch_reviews_stamp/);
    expect(sql).toMatch(/new\.decided_by\s*:=\s*coalesce\(auth\.uid\(\)/);
    expect(sql).toMatch(/auth\.jwt\(\) ->> 'email'/);
  });

  it('never sends decided_by, decided_by_email or decided_at from the client', () => {
    // Reading those columns back is fine and is what the screen shows; what must never
    // happen is one of them being *written*, so only the rows sent to the table are checked.
    const code = codeWithoutComments('src/lib/db/patches.ts');
    const written = code
      .split('.upsert(')
      .slice(1)
      .map((segment) => segment.split('onConflict')[0] ?? '');
    expect(written.length).toBeGreaterThan(0);
    for (const rows of written) {
      expect(rows).not.toMatch(/decided_by/);
      expect(rows).not.toMatch(/decided_at/);
    }
  });

  it('reaches every row only through the caller’s own run', () => {
    const sql = sqlWithoutComments(MIGRATION);
    const policies = sql.match(/create policy [^;]+;/g) ?? [];
    expect(policies).toHaveLength(8);
    expect(
      policies.every((policy) => /r\.user_id = auth\.uid\(\)/.test(policy)),
    ).toBe(true);
  });
});
