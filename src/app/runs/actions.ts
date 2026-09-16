'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { deleteRun, importRun } from '@/lib/db/runs';
import { toImportPayload } from '@/lib/report/map';
import { parseReportText } from '@/lib/report/schema';

import { MAX_UPLOAD_BYTES, type UploadState } from './upload-state';

function failed(error: string, issues: string[] = []): UploadState {
  return { error, issues };
}

/**
 * Validate an uploaded report and store it.
 *
 * Order matters: size, then JSON, then schema, then the database. Nothing from the file is
 * touched as data before it has been through `parseReportText`, and the insert goes through
 * `import_run` so a rejected row cannot leave a half-imported run behind.
 */
export async function uploadReport(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const file = formData.get('report');
  const label = String(formData.get('label') ?? '');

  if (!(file instanceof File) || file.size === 0) {
    return failed('Choose a report file to upload.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const megabytes = (file.size / (1024 * 1024)).toFixed(1);
    return failed(
      `That file is ${megabytes} MB, over the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit. ` +
        'Crawl fewer pages, or raise the limit in web/src/app/runs/actions.ts.',
    );
  }

  const parsed = parseReportText(await file.text());
  if (!parsed.ok) {
    return failed(parsed.message, parsed.issues);
  }

  let runId: string;
  try {
    runId = await importRun(toImportPayload(parsed.value, label));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failed('The report validated, but storing it failed.', [detail]);
  }

  revalidatePath('/runs');
  redirect(`/runs/${runId}`);
}

export async function removeRun(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (id === '') return;
  await deleteRun(id);
  revalidatePath('/runs');
  redirect('/runs');
}
