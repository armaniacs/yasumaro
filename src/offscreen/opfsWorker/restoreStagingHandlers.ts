/**
 * restoreStagingHandlers.ts
 * OPFS-worker handlers for the chunked restore staging session:
 * STAGE_RESTORE_BEGIN / STAGE_RESTORE_APPEND / STAGE_RESTORE_COMMIT /
 * STAGE_RESTORE_ABORT.
 *
 * Safety invariants:
 * - The staging name must have been issued by the registry (fail-closed).
 * - APPEND writes at the caller-declared BYTE offset through an OPFS sync
 *   access handle (seek-free: `write(data, { at: offset })` positions it),
 *   opened and closed per call so no handle stays held across messages.
 * - COMMIT first checks the declared totalBytes against the staged file's
 *   real size and the received chunk count against the declared totalChunks,
 *   then reuses the single-shot restore's validation (SQLite openable, no
 *   archive meta, own-trigger allowlist) before the staging file replaces
 *   the live DB. A mismatch or invalid file leaves the existing DB
 *   untouched — and the swap itself is guarded: the live DB moves to a
 *   backup name first, a failed staging move rolls it back, and the backup
 *   is only deleted after the swap succeeds.
 * - BEGIN sweeps leftovers of earlier sessions before issuing the name, so
 *   a crashed session cannot leak staging files forever.
 */

import type { HandlerContext } from './handlers.js';
import type {
  StageRestoreBeginPayload,
  StageRestoreAppendPayload,
  StageRestoreCommitPayload,
  StageRestoreAbortPayload,
} from './types.js';
import { DB_FILENAME } from '../dbFilename.js';
import { MAX_RESTORE_SESSION_BYTES } from '../../utils/limits.js';
import {
  assertRegisteredRestoreStagingName,
  getRestoreStagingRecord,
  prepareRestoreIncoming,
  recordRestoreAppendChunk,
  releaseRestoreStaging,
  removeRestoreStagingFile,
} from './restoreStaging.js';
import { validateFullBackupFile } from './backupHandlers.js';
import { errorMessage } from '../../utils/errorUtils.js';

/** Where the live DB hides during the swap, so a failed staging move can be rolled back. */
const PRE_RESTORE_BACKUP_SUFFIX = '.pre-restore';

export async function handleStageRestoreBegin(
  _ctx: HandlerContext,
  payload: StageRestoreBeginPayload,
): Promise<{ stagingName: string }> {
  // Worker-side re-check of the wire contract (the DASHBOARD_SQLITE
  // validator already enforces it): begin must declare a non-empty DB
  // inside the session byte ceiling, BEFORE any staging file is created.
  if (!Number.isSafeInteger(payload.totalBytes) || payload.totalBytes < 1) {
    throw new Error('restore_begin: totalBytes must be a positive integer');
  }
  if (payload.totalBytes > MAX_RESTORE_SESSION_BYTES) {
    throw new Error(
      `restore_begin: totalBytes (${payload.totalBytes}) exceeds the session ceiling (${MAX_RESTORE_SESSION_BYTES})`,
    );
  }
  if (!Number.isSafeInteger(payload.totalChunks) || payload.totalChunks < 1) {
    throw new Error('restore_begin: totalChunks must be a positive integer');
  }
  const stagingName = await prepareRestoreIncoming(payload.totalBytes, payload.totalChunks);
  return { stagingName };
}

export async function handleStageRestoreAppend(
  _ctx: HandlerContext,
  payload: StageRestoreAppendPayload,
): Promise<{ written: number }> {
  assertRegisteredRestoreStagingName(payload.stagingName);
  if (!Number.isSafeInteger(payload.offset) || payload.offset < 0) {
    throw new Error('restore_append: offset must be a non-negative integer');
  }
  const data = payload.data;
  if (!(data instanceof Uint8Array) || data.byteLength === 0) {
    throw new Error('restore_append: data must be a non-empty byte array');
  }
  // Offset progression and the session byte ceiling are validated BEFORE any
  // OPFS access: a chunk that would leave a gap, overwrite accepted bytes, or
  // extend past the declared totalBytes never reaches the staging file.
  recordRestoreAppendChunk(payload.stagingName, payload.offset, data.byteLength);

  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(payload.stagingName, { create: false });
  const access = await (handle as unknown as {
    createSyncAccessHandle: () => Promise<{
      write: (data: ArrayBuffer, options?: { at?: number }) => number;
      flush: () => void;
      close: () => void;
    }>;
  }).createSyncAccessHandle();
  try {
    // WHY: OPFS write() wants a plain ArrayBuffer; the chunk arrives as a
    // Uint8Array view whose .buffer may be typed as ArrayBufferLike.
    const written = access.write(data.slice().buffer as ArrayBuffer, { at: payload.offset });
    access.flush();
    return { written };
  } finally {
    access.close();
  }
}

export async function handleStageRestoreCommit(
  _ctx: HandlerContext,
  payload: StageRestoreCommitPayload,
  getEngine: () => import('../sqliteEngine.js').SqliteEngine | null,
  setEngine: (e: import('../sqliteEngine.js').SqliteEngine | null) => void,
  initSqlite: () => Promise<void>,
): Promise<{ committed: true }> {
  const record = getRestoreStagingRecord(payload.stagingName);
  assertRegisteredRestoreStagingName(payload.stagingName);
  if (!record) {
    throw new Error(`Unknown restore staging file: ${payload.stagingName}`);
  }
  if (record.totalBytes !== payload.totalBytes) {
    throw new Error(
      `Restore commit rejected: declared totalBytes (${payload.totalBytes}) does not match the session's begin totalBytes (${record.totalBytes})`,
    );
  }
  if (record.appendedChunks !== record.totalChunks) {
    throw new Error(
      `Restore commit rejected: received ${record.appendedChunks} chunk(s) but begin declared totalChunks (${record.totalChunks})`,
    );
  }

  const root = await navigator.storage.getDirectory();
  const stagingHandle = await root.getFileHandle(payload.stagingName, { create: false });
  const stagedFile = await stagingHandle.getFile();
  // BDD: a commit whose declared size differs from the actual transfer is
  // rejected — the existing DB must never be swapped for a partial file.
  if (stagedFile.size !== payload.totalBytes) {
    throw new Error(
      `Restore commit rejected: staged size (${stagedFile.size}) does not match declared totalBytes (${payload.totalBytes})`,
    );
  }

  // Full-backup validation runs on the staging file BEFORE anything is
  // replaced; the live DB stays untouched on failure.
  await validateFullBackupFile(payload.stagingName);

  // Close the live engine before the file swap, the same replacement
  // sequence the single-shot restore uses.
  const currentEngine = getEngine();
  if (currentEngine) {
    await currentEngine.close();
    setEngine(null);
  }

  // WHY: the swap below is not atomic in OPFS (removeEntry then move leaves
  // a window where the live DB is gone but the staging move has not
  // landed). The live DB is moved to a backup name first and only deleted
  // after the staging file is in place, so a transient move failure rolls
  // the live DB back instead of losing the user's history.
  const backupName = `${DB_FILENAME}${PRE_RESTORE_BACKUP_SUFFIX}`;
  const dbHandle = await root
    .getFileHandle(DB_FILENAME, { create: false })
    .catch(() => null);
  if (dbHandle) {
    await (dbHandle as unknown as { move: (name: string) => Promise<void> }).move(backupName);
  }
  try {
    // WHY: Chromium's FileSystemFileHandle.move() exists at runtime but not in TS types
    await (stagingHandle as unknown as { move: (name: string) => Promise<void> }).move(DB_FILENAME);
  } catch (error) {
    const backupHandle = await root
      .getFileHandle(backupName, { create: false })
      .catch(() => null);
    if (backupHandle) {
      await (backupHandle as unknown as { move: (name: string) => Promise<void> }).move(DB_FILENAME);
    }
    throw error;
  }
  releaseRestoreStaging(payload.stagingName);
  await root.removeEntry(backupName).catch(() => {});

  try {
    await initSqlite();
  } catch (error) {
    // The staged DB is already live at this point — the user must not be
    // told the restore failed without that fact on the record.
    throw new Error(
      `Restore commit: the staged DB is already live but re-initialization failed: ${errorMessage(error)}`,
    );
  }
  return { committed: true };
}

export async function handleStageRestoreAbort(
  _ctx: HandlerContext,
  payload: StageRestoreAbortPayload,
): Promise<{ aborted: true }> {
  assertRegisteredRestoreStagingName(payload.stagingName);
  releaseRestoreStaging(payload.stagingName);
  await removeRestoreStagingFile(payload.stagingName);
  return { aborted: true };
}
