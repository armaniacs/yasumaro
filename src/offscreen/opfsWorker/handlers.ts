/**
 * handlers.ts
 * Shared SQL execution helpers used by all handler modules.
 * Kept separate to avoid circular imports between handler modules.
 *
 * NOTE: SqliteWorkerApi integration deferred — per PBI-16 why-why, merging
 * 19 WorkerMessageType branches into 5 methods would re-introduce branching
 * and duplicate OpfsWorkerBackend's parallel implementation does not share a
 * transaction, so re-evaluate after PBI-12/14.
 */

import type { SqliteEngine, SqliteValue, SqliteRow } from '../sqliteEngine.js';
import { withTransaction as withTransactionNeutral } from '../sqliteTransaction.js';

export interface HandlerContext {
  engine: SqliteEngine;
}

export async function sqlExec(ctx: HandlerContext, sql: string, params: SqliteValue[] = []): Promise<void> {
  await ctx.engine.exec(sql, params);
}

export async function sqlQuery(
  ctx: HandlerContext,
  sql: string, params: SqliteValue[], callback: (row: SqliteRow) => void
): Promise<void> {
  const rows = await ctx.engine.query(sql, params);
  for (const row of rows) callback(row);
}

/**
 * Execute `fn` inside a `BEGIN IMMEDIATE` / `COMMIT` transaction.
 * PBI 2026-09-12-20: the discipline moved to the neutral
 * `sqliteTransaction.ts` (the host-layer IdbVfsBackend must not import
 * worker internals). Worker call sites keep this one-line adapter over
 * `sqlExec`.
 */
export function withTransaction<T>(ctx: HandlerContext, fn: () => Promise<T>): Promise<T> {
  return withTransactionNeutral({ exec: (sql) => sqlExec(ctx, sql) }, fn);
}
