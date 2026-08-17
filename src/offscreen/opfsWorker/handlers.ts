/**
 * handlers.ts
 * Shared SQL execution helpers used by all handler modules.
 * Kept separate to avoid circular imports between handler modules.
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
