/**
 * auditLog.ts
 * Records cloud AI provider send events for user-facing transparency.
 * Metadata only (provider, url, timestamp) — never content or PII.
 */

import { getSharedSqliteClient } from '../background/sqliteClient.js';
import { logError } from './logger.js';
import { errorMessage } from './errorUtils.js';

export interface AuditLogEntry {
  id: number;
  provider: string;
  url: string;
  created_at: number;
}

const sqliteClient = getSharedSqliteClient();

/**
 * Record that content was sent to a cloud AI provider.
 * Best-effort: failures are logged but never thrown, so summary generation is never blocked.
 */
export async function recordAuditLog({ provider, url }: { provider: string; url: string }): Promise<void> {
  try {
    const result = await sqliteClient.insertAuditLog({ provider, url, created_at: Date.now() });
    if (result === null) {
      logError('Failed to record audit log', { provider, error: 'insertAuditLog returned null' });
    }
  } catch (error: unknown) {
    logError('Failed to record audit log', { provider, error: errorMessage(error) });
  }
}

/**
 * Retrieve audit log entries, most recent first.
 */
export async function getAuditLogs({ limit = 100, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const result = await sqliteClient.queryAuditLog({ limit, offset });
  return result ?? { rows: [], total: 0 };
}
