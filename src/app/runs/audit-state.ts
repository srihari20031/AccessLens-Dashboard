/**
 * What the Run audit form and the Open results button report back.
 *
 * Kept out of audit-actions.ts because a `'use server'` module may only export async functions.
 */
import type { AuditFieldErrors } from '@/lib/audit/input';

export type AuditFormValues = {
  url: string;
  kind: 'scan' | 'crawl';
  max_pages: string;
  permission: boolean;
};

export type AuditFormState = {
  /** 'started' shows the confirmation; 'error' shows `message` and any field errors. */
  status: 'idle' | 'started' | 'error';
  message: string | null;
  fieldErrors: AuditFieldErrors;
  /** What was submitted, so a rejected form comes back filled in. */
  values: AuditFormValues;
};

export const EMPTY_AUDIT_VALUES: AuditFormValues = {
  url: '',
  kind: 'scan',
  max_pages: '10',
  permission: false,
};

export const EMPTY_AUDIT_STATE: AuditFormState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
  values: EMPTY_AUDIT_VALUES,
};

export type OpenResultsState = { error: string | null; issues: string[] };

export const EMPTY_OPEN_RESULTS_STATE: OpenResultsState = { error: null, issues: [] };
