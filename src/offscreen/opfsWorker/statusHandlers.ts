/**
 * statusHandlers.ts
 * Status and diagnostics handlers.
 */

import { sqlQuery, type HandlerContext } from './handlers.js';
import { pickDefined } from '../../utils/objectUtils.js';

const DB_FILENAME = 'yasumaro.db';

export async function handleGetStatus(
  ctx: HandlerContext,
  fts5Available: boolean,
  cachedCompileOptions: string[] | null,
): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; count: number; compileOptions?: string[]; compileOptionsSource: 'opfs-worker' }> {
  let count = 0;
  await sqlQuery(ctx, 'SELECT COUNT(*) AS c FROM browsing_logs', [], (row) => { count = Number(row.c); });

  return {
    initialized: true,
    path: `OPFS:${DB_FILENAME}`,
    fallback: false,
    fts5: fts5Available,
    count,
    compileOptionsSource: 'opfs-worker',
    ...pickDefined({ compileOptions: cachedCompileOptions ?? undefined }),
  };
}

export async function handleFtsIndexSize(ctx: HandlerContext, fts5Available: boolean): Promise<{ count: number }> {
  if (!fts5Available) return { count: 0 };
  let count = 0;
  await sqlQuery(ctx, 'SELECT COUNT(*) AS c FROM browsing_logs_fts', [], (row) => { count = Number(row.c); });
  return { count };
}
