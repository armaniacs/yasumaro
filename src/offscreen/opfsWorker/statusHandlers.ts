/**
 * statusHandlers.ts
 * Status and diagnostics handlers.
 */

import { sqlQuery, type HandlerContext } from './handlers.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { DB_FILENAME } from '../dbFilename.js';

export async function handleGetStatus(
  _ctx: HandlerContext,
  fts5Available: boolean,
  cachedCompileOptions: string[] | null,
): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; compileOptions?: string[]; compileOptionsSource: 'opfs-worker' }> {
  return {
    initialized: true,
    path: `OPFS:${DB_FILENAME}`,
    fallback: false,
    fts5: fts5Available,
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
