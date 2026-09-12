/**
 * sqliteTransaction.ts — neutral BEGIN/COMMIT/ROLLBACK discipline (PBI
 * 2026-09-12-20).
 *
 * `withTransaction` used to live in `opfsWorker/handlers.ts` with a runtime
 * `isHandlerContext` branch serving both the worker (HandlerContext +
 * sqlExec) and the host (IdbVfsBackend + execWithCache) — the host-layer
 * backend imported worker internals, inverting the seam. The discipline now
 * lives here on a minimal `{exec}` interface; each caller supplies a
 * two-line adapter.
 */

export interface TransactionExecutor {
  exec(sql: string): Promise<void>;
}

/**
 * Execute `fn` inside a `BEGIN IMMEDIATE` / `COMMIT` transaction.
 * BEGIN is outside the try so a BEGIN failure does not trigger a spurious
 * ROLLBACK that could hide the original error. On fn/COMMIT failure a
 * best-effort ROLLBACK is attempted but its error never masks the original.
 */
export async function withTransaction<T>(
  executor: TransactionExecutor,
  fn: () => Promise<T>,
): Promise<T> {
  await executor.exec('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    await executor.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      await executor.exec('ROLLBACK');
    } catch {
      // ROLLBACK failure must not hide the original error
    }
    throw err;
  }
}
