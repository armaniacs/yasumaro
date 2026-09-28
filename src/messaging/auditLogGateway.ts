/**
 * auditLogGateway.ts
 * Records cloud AI provider send events for user-facing transparency.
 * Metadata only (provider, url, timestamp) — never content or PII.
 *
 * A gateway, not a utils module: the audit log is written through the shared
 * SQLite client, so keeping it under src/utils/ put a utils → background edge
 * (static, dynamic or re-exported) in the codebase, which is the direction
 * dev-docs/LAYERS.md forbids. Sibling of pendingRecordGateway /
 * regenerateSummaryGateway in purpose, not in transport: this hop goes straight
 * to the offscreen document instead of the service worker.
 */

import { logError } from '../utils/logger/api.js';
import { errorMessage } from '../utils/errorUtils.js';

export interface AuditLogEntry {
  id: number;
  provider: string;
  url: string;
  created_at: number;
}

// Lazy gateway resolution: no static messaging → background runtime edge. Only
// the module resolution is memoized here — instance identity belongs to
// getSharedSqliteClient, so this is the single client-promise cache on the path
// and utils/ keeps no copy of the pattern.
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
