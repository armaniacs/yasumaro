/**
 * dbFilename.ts — the SQLite database file name, declared exactly once.
 *
 * The OPFS worker, the IDB VFS engine, the backup/restore path and the status
 * path all open the same file, and each used to carry its own `const
 * DB_FILENAME = 'yasumaro.db'`. A rename then needed four edits, and a partial
 * rename is not a failure that announces itself: the backend opens a second,
 * empty database and the history simply reads as gone.
 *
 * `LEGACY_OPFS_DB_FILENAME` (src/messaging/sqliteMessages.ts) stays a separate
 * declaration on purpose — it names the retired AccessHandlePoolVFS file the
 * migration readers and the diagnostics panel look for. It must keep pointing
 * at the historical name, whatever this one becomes.
 */
export const DB_FILENAME = 'yasumaro.db';
