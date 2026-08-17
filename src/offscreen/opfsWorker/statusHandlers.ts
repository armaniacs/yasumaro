/**
 * statusHandlers.ts
 * Status, diagnostics, and migration-escape-hatch SQL handlers.
 */

import type { SqliteValue, SqliteRow } from '../sqliteEngine.js';
import { sqlQuery, type HandlerContext } from './handlers.js';

const DB_FILENAME = 'yasumaro.db';

export async function handleGetStatus(
  ctx: HandlerContext,
  fts5Available: boolean,
  cachedCompileOptions: string[] | null,
): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; count: number; compileOptions?: string[] }> {
  let count = 0;
  await sqlQuery(ctx, 'SELECT COUNT(*) AS c FROM browsing_logs', [], (row) => { count = Number(row.c); });

  return {
    initialized: true,
    path: `OPFS:${DB_FILENAME}`,
    fallback: false,
    fts5: fts5Available,
    count,
    compileOptions: cachedCompileOptions ?? undefined,
  };
}

export async function handleFtsIndexSize(ctx: HandlerContext, fts5Available: boolean): Promise<{ count: number }> {
  if (!fts5Available) return { count: 0 };
  let count = 0;
  await sqlQuery(ctx, 'SELECT COUNT(*) AS c FROM browsing_logs_fts', [], (row) => { count = Number(row.c); });
  return { count };
}

/**
 * SQL_EXEC and SQL_QUERY are migration escape hatches — kept isolated here.
 * WARNING: They accept raw SQL strings. Use ONLY for schema migrations
 * (MigrationEngine). Never expose to user input.
 */
export async function handleSqlExec(
  ctx: HandlerContext,
  sql: string,
  params: SqliteValue[],
): Promise<{ changes: number }> {
  await ctx.engine.exec(sql, params);
  return { changes: 0 };
}

export async function handleSqlQuery(
  ctx: HandlerContext,
  sql: string,
  params: SqliteValue[],
): Promise<{ rows: SqliteRow[] }> {
  const rows = await ctx.engine.query(sql, params);
  return { rows };
}
