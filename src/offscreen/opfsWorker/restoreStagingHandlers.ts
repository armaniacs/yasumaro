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
 *   real size, then reuses the single-shot restore's validation (SQLite
 *   openable, no archive meta, own-trigger allowlist) before the staging
 *   file replaces the live DB. A mismatch or invalid file leaves the
 *   existing DB untouched.
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
import {
  assertRegisteredRestoreStagingName,
  getRestoreStagingRecord,
  prepareRestoreIncoming,
  releaseRestoreStaging,
  removeRestoreStagingFile,
} from './restoreStaging.js';
import { validateFullBackupFile } from './backupHandlers.js';

export async function handleStageRestoreBegin(
  _ctx: HandlerContext,
  payload: StageRestoreBeginPayload,
): Promise<{ stagingName: string }> {
  // Worker-side re-check of the wire contract (the DASHBOARD_SQLITE
  // validator already enforces it): begin must declare a non-empty DB.
  if (!Number.isSafeInteger(payload.totalBytes) || payload.totalBytes < 1) {
    throw new Error('restore_begin: totalBytes must be a positive integer');
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

  // Close the live engine, swap the file, re-init — the same replacement
  // sequence the single-shot restore uses.
  const currentEngine = getEngine();
  if (currentEngine) {
    await currentEngine.close();
    setEngine(null);
  }
  await root.removeEntry(DB_FILENAME).catch(() => {});
  // WHY: OPFS `FileSystemFileHandle` lacks `move()` in TypeScript types but it exists in Chromium
  await (stagingHandle as unknown as { move: (name: string) => Promise<void> }).move(DB_FILENAME);
  releaseRestoreStaging(payload.stagingName);

  await initSqlite();
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
