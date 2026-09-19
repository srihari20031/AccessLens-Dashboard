'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { announceChanges, type AnnouncedJob } from '@/lib/audit/status';

export const REFRESH_INTERVAL_MS = 3000;

/**
 * Keeps the job list current while an audit is waiting or running, and says what changed.
 *
 * `router.refresh()` re-renders the Server Components of this route without losing client
 * state, so the list below is re-read from the database every few seconds and nothing polls
 * once every job has finished. The live region announces only jobs whose status changed, never
 * every tick; it is always in the DOM, which is what makes a screen reader read new text.
 */
export function AuditRefresher({ active, jobs }: { active: boolean; jobs: AnnouncedJob[] }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, router]);

  // Compared during render (React's "storing information from previous renders" pattern),
  // so the announcement is set in the same render that shows the new statuses.
  const [previous, setPrevious] = useState(jobs);
  const [message, setMessage] = useState('');
  if (previous !== jobs) {
    const changed = announceChanges(previous, jobs);
    setPrevious(jobs);
    if (changed !== '') setMessage(changed);
  }

  return (
    <div aria-live="polite" className="visually-hidden">
      {message}
    </div>
  );
}
