/**
 * restoreSwap.ts
 * Engine-independent OPFS procedure that replaces the live DB file with a
 * verified staging file: the live DB moves to a backup name, the staging
 * file moves onto the live DB path, a failed staging move rolls the backup
 * back, and the backup is removed only after the swap has landed.
 *
 * Pure OPFS file choreography — no SQLite engine, no staging registry — so
 * callers (restore commit today, future swap sites) share one guarded
 * implementation and tests run against a plain directory-handle fake.
 */

import { DB_FILENAME } from '../dbFilename.js';

/** Where the live DB hides during the swap, so a failed staging move can be rolled back. */
const PRE_RESTORE_BACKUP_SUFFIX = '.pre-restore';

// WHY: Chromium's FileSystemFileHandle.move() exists at runtime but not in TS types
type MoveableFileHandle = { move: (name: string) => Promise<void> };

/**
 * Replace the live DB with the given verified staging file. Throws after
 * rolling the live DB back if the staging move fails; the backup is removed
 * (best-effort) only after the swap succeeds.
 */
export async function swapVerifiedStagingIntoLive(
  root: FileSystemDirectoryHandle,
  stagingHandle: FileSystemFileHandle,
): Promise<void> {
  // WHY: this swap is not atomic in OPFS (removeEntry then move leaves a
  // window where the live DB is gone but the staging move has not landed).
  // The live DB is moved to a backup name first and only deleted after the
  // staging file is in place, so a transient move failure rolls the live DB
  // back instead of losing the user's history.
  const backupName = `${DB_FILENAME}${PRE_RESTORE_BACKUP_SUFFIX}`;
  const dbHandle = await root
    .getFileHandle(DB_FILENAME, { create: false })
    .catch(() => null);
  if (dbHandle) {
    await (dbHandle as unknown as MoveableFileHandle).move(backupName);
  }
  try {
    await (stagingHandle as unknown as MoveableFileHandle).move(DB_FILENAME);
  } catch (error) {
    const backupHandle = await root
      .getFileHandle(backupName, { create: false })
      .catch(() => null);
    if (backupHandle) {
      await (backupHandle as unknown as MoveableFileHandle).move(DB_FILENAME);
    }
    throw error;
  }
  await root.removeEntry(backupName).catch(() => {});
}
