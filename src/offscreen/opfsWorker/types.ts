/**
 * types.ts
 * Shared type definitions for the OPFS Worker message protocol.
 * Discriminated unions replace the old `type: string` for compile-time safety.
 */

import type { StorageQuery } from '../../utils/sqlite-types.js';
import type { SqliteValue } from '../sqliteEngine.js';

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
  'ARCHIVE_PREVIEW',
  'ARCHIVE_CREATE',
  'ARCHIVE_CLEANUP',
  'ARCHIVE_EXPORT',
  'ARCHIVE_PREPARE_INCOMING',
  'ARCHIVE_RESTORE_PREVIEW',
  'ARCHIVE_RESTORE',
  'ARCHIVE_DELETE_BY_STAGING',
  'ARCHIVE_OPEN',
  'ARCHIVE_QUERY',
  'ARCHIVE_UPDATE',
  'ARCHIVE_SAVE',
  'ARCHIVE_CLOSE',
  'ARCHIVE_STATUS',
  'ARCHIVE_DISCARD',
  'ARCHIVE_SWEEP',
] as const;

export type WorkerMessageType = typeof WORKER_MESSAGE_TYPES[number];

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export type QueryPayload = StorageQuery;

export type SearchPayload = StorageQuery;

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

export interface RestorePayload {
  data: number[] | Uint8Array;
}

export interface AuditLogInsertPayload {
  provider: string;
  url: string;
  created_at: number;
}

export interface ArchivePreviewPayload {
  cutoffDate: string;
  cutoffMs: number;
  includeDeleted: boolean;
}

export interface ArchiveCreatePayload {
  cutoffDate: string;
  cutoffMs: number;
  includeDeleted: boolean;
  yasumaroVersion: string;
}

export interface ArchiveExportPayload {
  stagingName: string;
  offset: number;
  length: number;
}

export interface ArchiveRestorePreviewPayload {
  stagingName: string;
}

export interface ArchiveRestorePayload {
  stagingName: string;
}

export interface ArchiveOpenPayload {
  stagingName: string;
}

export interface ArchiveQueryPayload {
  stagingName: string;
  query: string;
  limit: number;
  offset: number;
}

export interface ArchiveUpdatePayload {
  stagingName: string;
  id: number;
  changes: Record<string, unknown>;
}

export interface ArchiveSavePayload {
  stagingName: string;
}

export interface ArchiveClosePayload {
  stagingName: string;
}

export interface ArchiveOpenPayload {
  stagingName: string;
}

export interface ArchiveQueryPayload {
  stagingName: string;
  query: string;
  limit: number;
  offset: number;
}

export interface ArchiveUpdatePayload {
  stagingName: string;
  id: number;
  changes: Record<string, unknown>;
}

export interface ArchiveSavePayload {
  stagingName: string;
}

export interface ArchiveClosePayload {
  stagingName: string;
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
