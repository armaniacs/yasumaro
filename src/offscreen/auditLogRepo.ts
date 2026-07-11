/**
 * auditLogRepo.ts
 * Audit log for cloud AI provider send events (separate `audit_log` table —
 * unrelated to browsing-log record CRUD).
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 */

import { errorMessage } from '../utils/errorUtils.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { engine, MAX_QUERY_LIMIT } from './sqliteEngineContext.js';
import type { SqliteValue } from './sqliteEngineContext.js';

import type { AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';

/**
 * Insert an audit log entry for cloud AI provider send events.
 */
export async function insertAuditLog(record: AuditLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  try {
    // OPFS Worker path
    if (engine.opfsWorker) {
      const result = await engine.sendToOpfsWorker('AUDIT_LOG_INSERT', record) as { id: number };
      return { success: true, id: result.id };
    }

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (engine.opfsWorker) {
      const result = await engine.sendToOpfsWorker('AUDIT_LOG_INSERT', record) as { id: number };
      return { success: true, id: result.id };
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await engine.execWithCache(
      `INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)`,
      [record.provider, record.url, record.created_at]
    );

    let newId = 0;
    await engine.execWithCache('SELECT last_insert_rowid()', [], (row: SqliteValue[]) => {
      newId = Number(row[0]);
    });

    return { success: true, id: newId };
  } catch (error) {
    logError('SQLite: insertAuditLog failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Query audit log entries, most recent first by default.
 */
export async function queryAuditLog(options: { limit?: number; offset?: number } = {}): Promise<
  { success: true; rows: AuditLogEntry[]; total: number } | { success: false; error: string }
> {
  try {
    const limit = Math.min(options.limit ?? 100, MAX_QUERY_LIMIT);
    const offset = options.offset ?? 0;

    // OPFS Worker path
    const opfsResult = await engine.tryOpfsProxy<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>('AUDIT_LOG_QUERY', {
      limit,
      offset,
    });
    if (opfsResult !== null) {
      return { success: true, rows: opfsResult.rows, total: opfsResult.total };
    }

    if (!engine.dbHandle && !engine.usingFallbackStorage) {
      await engine.init();
    }

    if (!engine.dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const rows: AuditLogEntry[] = [];
    await engine.execWithCache(
      `SELECT id, provider, url, created_at FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]),
          provider: String(row[1]),
          url: String(row[2]),
          created_at: Number(row[3]),
        });
      }
    );

    let total = 0;
    await engine.execWithCache('SELECT COUNT(*) FROM audit_log', [], (row: SqliteValue[]) => {
      total = Number(row[0]);
    });

    return { success: true, rows, total };
  } catch (error) {
    logError('SQLite: queryAuditLog failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}
