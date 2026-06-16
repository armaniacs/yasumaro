/**
 * opfsMigrationV2Reader.ts
 * Worker-only reader for the OLD wa-sqlite AccessHandlePoolVFS database.
 *
 * This file is intentionally isolated so that all wa-sqlite / old-VFS code lives
 * in one place. Once migration is universally complete it can be removed from the
 * bundle without touching any other module.
 *
 * NOT unit-tested (requires real OPFS + createSyncAccessHandle, Worker-only API).
 */

import type { BrowsingLogRecord } from '../utils/sqlite-types.js';

// ---------------------------------------------------------------------------
// Old constants (do NOT change — must match the pre-migration paths)
// ---------------------------------------------------------------------------

const OLD_POOL_DIR = 'yasumaro-opfs';
const OLD_DB_FILENAME = 'yasumaro.db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the old OPFS pool directory exists.
 * Catching the DOMException (NotFoundError) is the standard existence check.
 */
async function oldDirExists(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.getDirectoryHandle(OLD_POOL_DIR, { create: false });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Reads all rows from the OLD wa-sqlite AccessHandlePoolVFS database.
 * Returns an empty array if the old directory/database does not exist.
 *
 * Must run inside a Web Worker (createSyncAccessHandle is not available in
 * the main thread or offscreen document).
 */
export async function readOldDbRecords(): Promise<BrowsingLogRecord[]> {
  if (!(await oldDirExists())) {
    return [];
  }

  // Dynamic imports keep wa-sqlite out of the main bundle tree-shake.
  // These modules are only available in Worker context.
  const [SQLiteESMFactory, SQLiteModule, { AccessHandlePoolVFS }] = await Promise.all([
    import('wa-sqlite/dist/wa-sqlite.mjs').then((m) => m.default as (opts?: object) => Promise<unknown>),
    import('wa-sqlite'),
    import('wa-sqlite/src/examples/AccessHandlePoolVFS.js'),
  ]);

  // Boot the old SQLite engine (wa-sqlite ESM factory returns the WASM module)
  const sqlite3Module = await (SQLiteESMFactory as (opts?: object) => Promise<unknown>)();

  // wa-sqlite's named exports: Factory builds the API; constants live at module level.
  // Cast through unknown to avoid the structural overlap check for incompatible types.
  const SQLite = SQLiteModule as unknown as {
    Factory: (module: unknown) => {
      open_v2(filename: string, flags: number, vfs: string): Promise<number>;
      close(db: number): Promise<void>;
      exec(db: number, sql: string, callback?: (row: (string | number | null)[], cols: string[]) => void): Promise<void>;
    };
    SQLITE_OPEN_READWRITE: number;
  };

  const sqlite3 = SQLite.Factory(sqlite3Module);
  const SQLITE_OPEN_READWRITE = SQLite.SQLITE_OPEN_READWRITE;

  // Register the AccessHandlePoolVFS pointing at the old pool directory.
  // The VFS shim may expose `registerVFS`, `vfs_register`, or a constructor that
  // self-registers via its `isReady` promise — handle all three forms.
  const vfsInstance = new AccessHandlePoolVFS(OLD_POOL_DIR) as {
    isReady?: Promise<void>;
    hasAsyncMethod?: () => boolean;
  };

  // Ensure all file handles are ready before opening the database.
  if (vfsInstance.isReady) {
    await vfsInstance.isReady;
  }

  // Override hasAsyncMethod so wa-sqlite treats it as synchronous.
  if (typeof vfsInstance.hasAsyncMethod === 'function') {
    (vfsInstance as { hasAsyncMethod: () => boolean }).hasAsyncMethod = () => false;
  }

  const vfsApi = sqlite3 as unknown as {
    vfs_register?: (vfs: unknown, makeDefault?: boolean) => void;
    registerVFS?: (vfs: unknown, makeDefault?: boolean) => void;
  };

  if (typeof vfsApi.vfs_register === 'function') {
    vfsApi.vfs_register(vfsInstance, false);
  } else if (typeof vfsApi.registerVFS === 'function') {
    vfsApi.registerVFS(vfsInstance, false);
  }
  // If neither exists, the VFS may self-register via constructor — proceed.

  const vfsName = (vfsInstance as { name?: string }).name ?? OLD_POOL_DIR;

  let db: number | null = null;
  const records: BrowsingLogRecord[] = [];

  try {
    db = await sqlite3.open_v2(OLD_DB_FILENAME, SQLITE_OPEN_READWRITE, vfsName);

    await sqlite3.exec(
      db,
      'SELECT url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted FROM browsing_logs',
      (row: (string | number | null)[]) => {
        records.push({
          url: String(row[0] ?? ''),
          title: (row[1] as string | null) ?? null,
          summary: (row[2] as string | null) ?? null,
          tags: (row[3] as string | null) ?? null,
          created_at: Number(row[4] ?? 0),
          domain: (row[5] as string | null) ?? null,
          visit_duration: row[6] !== null ? Number(row[6]) : null,
          scroll_ratio: row[7] !== null ? Number(row[7]) : null,
          is_starred: Number(row[8] ?? 0),
          is_deleted: Number(row[9] ?? 0),
        });
      }
    );
  } catch (err) {
    // If the table doesn't exist (fresh install or already wiped), return [].
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('no such table')) {
      return [];
    }
    throw err;
  } finally {
    if (db !== null) {
      await sqlite3.close(db);
    }
  }

  return records;
}

/**
 * Removes the old OPFS pool directory so the migration cannot run twice
 * and the storage is reclaimed.
 *
 * Silently ignores errors (e.g. already removed by another run).
 */
export async function deleteOldDbFile(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OLD_POOL_DIR, { recursive: true });
  } catch {
    // Directory already absent or removal failed — either way, treat as success.
  }
}
