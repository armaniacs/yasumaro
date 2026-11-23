/**
 * Save to Obsidian step
 * Step 8: Append formatted markdown to Obsidian daily note
 */

import { LogType } from '../../../utils/logger/types.js';
import { addLog } from '../../../utils/logger/core.js';
import { errorMessage, toError } from '../../../utils/errorUtils.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import { resolveFailure } from '../../../utils/failureTaxonomy.js';
import { decideConflictRewrite } from '../../../utils/obsidianConditionalWrite.js';
import { decideSaveSkip } from '../recordingDecision.js';
import type { RecordingContext, StepDeps } from '../types.js';

/**
 * Save formatted markdown to Obsidian daily note
 * Skips silently when Obsidian is not configured.
 *
 * Dependencies are injected via StepDeps instead of creating ObsidianClient
 * internally. This makes the dependency explicit and testable.
 *
 * Notifications are NOT created here — the caller (handler layer) is
 * responsible for notifying the user based on the pipeline result.
 */
export const saveToObsidianStep = async (
  context: RecordingContext,
  deps?: StepDeps
): Promise<RecordingContext> => {
  const { data, markdown } = context;
  const { url, title } = data;

  // PBI 04: regenerate is SQLite-only — the user re-appends manually via the
  // existing "append to Obsidian" button (binding: 副作用skipは両方).
  if (data.skipObsidianAppend) {
    addLog(LogType.INFO, 'Skipping Obsidian append (source policy)', { url, traceId: context.traceId });
    return context;
  }

  if (!markdown) {
    addLog(LogType.WARN, 'No markdown to save to Obsidian', { url, traceId: context.traceId });
    return context;
  }

  // Skip if user explicitly disabled Obsidian or no client is available.
  // I/O (settings read, client presence) stays here; verdict is delegated.
  const settings = context.settings as Record<string, unknown>;
  const obsidianEnabled = settings[StorageKeys.OBSIDIAN_ENABLED];
  const obsidianClient = deps?.obsidian;
  const saveVerdict = decideSaveSkip(obsidianEnabled !== false, Boolean(obsidianClient));
  if (saveVerdict.skip) {
    if (saveVerdict.reason === 'obsidian-disabled') {
      addLog(LogType.INFO, 'Obsidian disabled by user, skipping save', { url, traceId: context.traceId });
      return context;
    }
    addLog(LogType.INFO, 'No Obsidian client available, skipping save', { url, traceId: context.traceId });
    return context;
  }

  const obsidianStart = Date.now();
  try {
    // Write-visibility policy home: a replay write carries dedupe so the
    // section editor skips already-saved content; every other write (first
    // pipeline run, user-invoked append) stays unconditional.
    const append = (): Promise<void> => context.replayWrite === true
      ? obsidianClient!.appendToDailyNote(markdown, context.traceId, { dedupe: true })
      : obsidianClient!.appendToDailyNote(markdown, context.traceId);

    // The rewrite lives here (not in the client) so the client's PUT resend
    // contract stays untouched: each attempt is a fresh GET + If-Match PUT.
    let rewritesDone = 0;
    for (;;) {
      try {
        await append();
        break;
      } catch (writeError: unknown) {
        const decision = decideConflictRewrite(resolveFailure(writeError), rewritesDone);
        if (decision === 'not-conflict') throw writeError;
        addLog(
          LogType.WARN,
          decision === 'rewrite'
            ? 'Obsidian write conflict (412); re-reading and rewriting once'
            : 'Obsidian write conflict (412) persisted after the single rewrite',
          { url, traceId: context.traceId }
        );
        if (decision === 'exhausted') throw writeError;
        rewritesDone += 1;
      }
    }
    const obsidianDuration = Date.now() - obsidianStart;
    addLog(LogType.INFO, 'Saved to Obsidian', { title, url, traceId: context.traceId });

    return { ...context, obsidianDuration };
  } catch (error: unknown) {
    addLog(LogType.ERROR, 'Failed to save to Obsidian', {
      error: errorMessage(error),
      url,
      title,
      traceId: context.traceId
    });
    throw toError(error);
  }
};
