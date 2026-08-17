/**
 * types.ts
 * Shared type definitions for the OPFS Worker message protocol.
 * Discriminated unions replace the old `type: string` for compile-time safety.
 */

import type { BrowsingLogRecord, SearchResult, QueryOptions } from '../../utils/sqlite-types.js';
import type { SqliteValue, SqliteRow } from '../sqliteEngine.js';

// ---------------------------------------------------------------------------
// Message type constants
// ---------------------------------------------------------------------------

export const WORKER_MESSAGE_TYPES = [
  'INIT',
  'INSERT',
  'QUERY',
  'SEARCH',
  'UPDATE',
  'DELETE',
  'TOGGLE_STAR',
  'GET_COUNT',
  'STATUS',
  'PURGE',
  'CONTENT_PURGE',
  'CLEAR_ALL',
  'SERIALIZE',
  'BACKUP',
  'RESTORE',
  'FTS_INDEX_SIZE',
  'INSERT_BATCH',
  'HEALTH_CHECK',
  'AUDIT_LOG_INSERT',
  'AUDIT_LOG_QUERY',
  'SQL_EXEC',
  'SQL_QUERY',
] as const;

export type WorkerMessageType = typeof WORKER_MESSAGE_TYPES[number];

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export type QueryPayload = QueryOptions & { ids?: number[]; tagFilter?: string; isStarred?: number };

export type SearchPayload = {
  searchQuery: string;
  limit?: number;
  offset?: number;
  orderBy?: 'rank' | 'created_at';
  orderDir?: 'ASC' | 'DESC';
};

export interface AuditLogQueryPayload {
  limit?: number;
  offset?: number;
}

export interface PurgePayload {
  retentionDays: number;
  maxRecords: number;
}

export interface ContentPurgePayload {
  retentionDays?: number | null;
  maxRecords?: number | null;
  includeStarred?: boolean | null;
}

export interface UpdatePayload {
  id: number;
  changes: Record<string, SqliteValue>;
}

export interface DeletePayload {
  id: number;
}

export interface SqlExecPayload {
  sql: string;
  params: SqliteValue[];
}

export interface SqlQueryPayload {
  sql: string;
  params: SqliteValue[];
}

export interface RestorePayload {
  data: number[] | Uint8Array;
}

export interface AuditLogInsertPayload {
  provider: string;
  url: string;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Request / Response messages
// ---------------------------------------------------------------------------

export interface WorkerRequestMessage {
  id: number;
  type: WorkerMessageType;
  payload: unknown;
}

export interface WorkerResponseMessage {
  id: number;
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Log relay message posted to the parent offscreen document, distinguished
 * from WorkerResponseMessage by the __log marker. This Worker has no chrome.*
 * access, so sqliteEngineContext.ts's worker.onmessage handler forwards
 * these to the Service Worker (or logs them directly, since it runs in the
 * offscreen document and can import ../utils/logger.js).
 */
export interface WorkerLogMessage {
  __log: true;
  level: 'warn' | 'error' | 'info';
  message: string;
  details?: Record<string, unknown>;
}
