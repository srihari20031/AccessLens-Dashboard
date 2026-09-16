import type { RunKind } from '@/lib/report/schema';

/** The history screen for one site: a kind and a target URL together. */
export function historyHref(site: { kind: RunKind; target_url: string }): string {
  const params = new URLSearchParams({ kind: site.kind, url: site.target_url });
  return `/history?${params.toString()}`;
}
