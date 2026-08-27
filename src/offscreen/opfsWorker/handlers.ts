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
 * BEGIN is outside the try so a BEGIN failure does not trigger a spurious
 * ROLLBACK that could hide the original error. On fn/COMMIT failure a
 * best-effort ROLLBACK is attempted but its error never masks the original.
 */
export async function withTransaction<T>(ctx: HandlerContext, fn: () => Promise<T>): Promise<T>;
export async function withTransaction<T>(
  engine: { execWithCache(sql: string, params?: SqliteValue[]): Promise<void> },
  fn: () => Promise<T>,
): Promise<T>;
export async function withTransaction<T>(
  ctxOrEngine: HandlerContext | { execWithCache(sql: string, params?: SqliteValue[]): Promise<void> },
  fn: () => Promise<T>,
): Promise<T> {
  const isHandlerContext = (v: unknown): v is HandlerContext =>
    typeof v === 'object' && v !== null && 'engine' in v;

  const exec = async (sql: string): Promise<void> => {
    if (isHandlerContext(ctxOrEngine)) {
      await sqlExec(ctxOrEngine, sql);
    } else {
      await ctxOrEngine.execWithCache(sql);
    }
  };

  await exec('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    await exec('COMMIT');
    return result;
  } catch (err) {
    try {
      await exec('ROLLBACK');
    } catch {
      // ROLLBACK failure must not hide the original error
    }
    throw err;
  }
}
