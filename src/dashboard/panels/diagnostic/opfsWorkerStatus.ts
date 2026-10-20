/**
 * opfsWorkerStatus.ts
 * The one predicate deciding whether a SQLite STATUS response describes the
 * OPFS sync-access-handle worker.
 *
 * WHY shared: the diagnostics collector and the diagnostics panel re-derived
 * the same condition under drifted names (isOpfsWorker vs isOpfs). One
 * predicate keeps the compileOptionsSource contract and the legacy 'OPFS:'
 * path shape in one place, so a new source value needs one edit
 * (PBI 2026-10-20-17).
 */

/**
 * The STATUS fields the predicate reads. SqliteStatusResult (the
 * getSqliteStatus return type) and the diagnostics snapshot's sqlite section
 * both carry them.
 */
interface SqliteStatusShape {
  compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
  path: string;
}

/**
 * True when the STATUS response describes the OPFS worker engine: the
 * response names the opfs-worker source, or the path is an OPFS location
 * (the legacy migration-era shape the status contract still reports).
 */
export function isOpfsWorkerStatus(status: SqliteStatusShape): boolean {
  return status.compileOptionsSource === 'opfs-worker' || status.path.startsWith('OPFS:');
}
