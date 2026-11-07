// src/offscreen/purgeRunner.ts
// Purge execution: retention cutoff, the executor seam, and the shared purge
// sequence runner.
//
// Moved verbatim from sqliteQueryBuilder.ts (PBI 2026-11-07-12): the builder
// keeps SQL assembly only (the DELETE/UPDATE statement builders stay there).
// The runner lives here — not in the policy module — because it executes
// against a live engine via `withTransaction`, and the split requires the
// policy layer to hold no transaction import or execution.

import type { SqliteValue } from './sqliteEngine.js';
import { withTransaction } from './sqliteTransaction.js';

/** Retention cutoff in epoch ms. `now` is injectable for tests. */
export function purgeCutoffMs(retentionDays: number, now: number = Date.now()): number {
  return now - retentionDays * 24 * 60 * 60 * 1000;
}

/**
 * The statements one purge sequence runs, in execution order. Both backends
 * construct these from the shared builders; the runner binds the values.
 */
export interface PurgeSequenceStatements {
  /** Deletes/clears rows older than the retention cutoff (one cutoff bind). */
  deleteOldSql: string;
  /** Reads the row count the cap gate compares against maxRecords. */
  countSql: string;
  /** Deletes/clears `count - maxRecords` rows, oldest first (one bind). */
  deleteExcessSql: string;
}

/**
 * Executor seam for `runPurgeSequence`: each backend binds its own engine, so
 * the sequence stays engine-agnostic. The two backends genuinely read scalars
 * differently (IDB positional callback vs the worker's named `row.c`), so the
 * seam — not the runner — owns that shape.
 * - `exec` runs a write (DELETE/UPDATE) with its binds.
 * - `count` runs a scalar COUNT and returns its single value.
 * - `changes` runs `SELECT changes()` (spelled per backend) after a write and
 *   returns the number of rows that write actually touched.
 */
export interface PurgeExecutor {
  exec(sql: string, params: SqliteValue[]): Promise<void>;
  count(sql: string, params: SqliteValue[]): Promise<number>;
  changes(): Promise<number>;
}

/**
 * The one documented difference between the two purge ops, made explicit.
 * 'always' (purgeOldRecords): the cap COUNT runs even when maxRecords is
 * absent. 'when-max-records' (content purge): the COUNT is skipped entirely
 * unless maxRecords > 0. Collapsing them would change the emitted sequence.
 */
export type PurgeCountPolicy = 'always' | 'when-max-records';

export interface PurgeSequencePolicy {
  retentionDays?: number | null | undefined;
  maxRecords?: number | null | undefined;
  countPolicy: PurgeCountPolicy;
}

/**
 * Run the shared purge sequence inside ONE `withTransaction` and return the
 * executed-row count. Policy, shared verbatim by both backends:
 *
 * - TRANSACTION: the whole sequence runs in one BEGIN IMMEDIATE … COMMIT.
 *   Every purge here reads between writes — `SELECT changes()` feeds the
 *   reported count, and the cap COUNT decides the next write's LIMIT. A
 *   recording landing between the two would otherwise report a count taken
 *   from one snapshot while deleting rows selected from another.
 * - SKIP GUARDS (PBI 2026-09-12-36): an absent or non-positive
 *   `retentionDays` / `maxRecords` skips that dimension entirely, so "no
 *   window" never degrades into "cutoff = now" (the old (0,0)
 *   deleted-everything divergence). `countPolicy` is the one intentional
 *   cross-op difference, preserved here rather than re-decided per backend.
 * - COUNTING: `purged` is the sum of `SELECT changes()` after each write. The
 *   computed excess is only what the cap statement was asked to touch, not
 *   what it touched, so reporting it would turn a disagreement between the
 *   count and the delete into a wrong number.
 */
export async function runPurgeSequence(
  executor: PurgeExecutor,
  stmts: PurgeSequenceStatements,
  policy: PurgeSequencePolicy,
): Promise<number> {
  const { retentionDays, maxRecords, countPolicy } = policy;
  let purged = 0;

  await withTransaction({ exec: (sql) => executor.exec(sql, []) }, async () => {
    if (retentionDays != null && retentionDays > 0) {
      await executor.exec(stmts.deleteOldSql, [purgeCutoffMs(retentionDays)]);
      purged += await executor.changes();
    }

    if (countPolicy === 'always' || (maxRecords != null && maxRecords > 0)) {
      const count = await executor.count(stmts.countSql, []);
      if (maxRecords != null && maxRecords > 0 && count > maxRecords) {
        await executor.exec(stmts.deleteExcessSql, [count - maxRecords]);
        purged += await executor.changes();
      }
    }
  });

  return purged;
}
