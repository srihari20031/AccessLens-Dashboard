import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * The fix-review boundary, enforced rather than promised.
 *
 * Two claims in this repository's README are the kind a later change can break while every
 * other test still passes: that a review decision never touches a finding's outcome, severity
 * or band, and that nothing in the project renders untrusted text as markup. Both are checked
 * here against the source itself, because there is no unit test of a screen that would notice.
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

const WRITE_PATHS = ['src/lib/db/reviews.ts', 'src/app/runs/[id]/review/actions.ts'] as const;

describe('a decision never changes a finding', () => {
  it.each(WRITE_PATHS)('%s never writes to run_findings', (file) => {
    // Reading the findings of a run is another module's job; this one has no business
    // naming that table in a query at all.
    expect(read(file)).not.toMatch(/from\(\s*['"]run_findings['"]/);
  });

  it.each(WRITE_PATHS)('%s selects and writes no outcome, severity or band', (file) => {
    const code = read(file)
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/\b(outcome|severity|band)\b/);
  });

  it('gives the review tables no outcome, severity or band column', () => {
    const sql = sqlWithoutComments('supabase/migrations/0005_fix_reviews.sql');
    expect(sql).toMatch(/create table if not exists public\.fix_reviews/);
    expect(sql).toMatch(/create table if not exists public\.run_suggestions/);
    expect(sql).not.toMatch(/\b(outcome|severity|band)\b/);
  });

  it('adds no column to run_findings and alters no existing table', () => {
    const sql = sqlWithoutComments('supabase/migrations/0005_fix_reviews.sql');
    expect(sql).not.toMatch(/alter table public\.run_findings/);
    expect(sql).not.toMatch(/alter table public\.runs\b/);
    // The only `alter table` statements are the two that switch row-level security on.
    const alters = sql.match(/alter table [^;]+;/g) ?? [];
    expect(alters.every((statement) => /enable row level security/.test(statement))).toBe(true);
  });
});

describe('nothing is rendered as markup', () => {
  it('has no dangerouslySetInnerHTML anywhere in src', () => {
    const offenders = filesUnder('src', ['.ts', '.tsx']).filter((file) =>
      /dangerouslySetInnerHTML\s*=/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
