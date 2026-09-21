/**
 * auditLog.ts
 * Records cloud AI provider send events for user-facing transparency.
 * Metadata only (provider, url, timestamp) — never content or PII.
 */

import { logError } from './logger/api.js';
import { errorMessage } from './errorUtils.js';

export interface AuditLogEntry {
  id: number;
  provider: string;
  url: string;
  created_at: number;
}

// Lazy gateway resolution (storageMaintenance.ts precedent): no static
// utils→background runtime edge. The shared client resolves on first use via
// dynamic import and the promise is cached so the import happens only once.
function loadSharedClient() {
  return import('../background/sqlite/offscreenGateway.js').then((gateway) => gateway.getSharedSqliteClient());
}

let sharedClientPromise: ReturnType<typeof loadSharedClient> | null = null;

function getClient(): ReturnType<typeof loadSharedClient> {
  if (!sharedClientPromise) {
    sharedClientPromise = loadSharedClient();
  }
  return sharedClientPromise;
}

/**
 * Record that content was sent to a cloud AI provider.
 * Best-effort: failures are logged but never thrown, so summary generation is never blocked.
 */
export async function recordAuditLog({ provider, url }: { provider: string; url: string }): Promise<void> {
  try {
    const sqliteClient = await getClient();
    const result = await sqliteClient.mutate({ type: 'insertAuditLog', record: { provider, url, created_at: Date.now() } });
    if (!result.success) {
      logError('Failed to record audit log', { provider, error: result.error.message });
    }
  } catch (error: unknown) {
    logError('Failed to record audit log', { provider, error: errorMessage(error) });
  }
}

/**
 * Retrieve audit log entries, most recent first.
 */
export async function getAuditLogs({ limit = 100, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const sqliteClient = await getClient();
  const result = await sqliteClient.query({ kind: 'auditLog', limit, offset });
  return result.success ? result.data : { rows: [], total: 0 };
}
