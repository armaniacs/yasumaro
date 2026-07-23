/**
 * SW↔offscreen 間の SQLite メッセージ型の単一ソース。
 * src/background/sqliteClient.ts (送信側) と src/offscreen/offscreen.ts (受信側)
 * の両方がこの discriminated union を参照する。
 *
 * スコープ: SW↔offscreen 間のみ。offscreen↔Worker 間（opfsWorker.ts の
 * Worker.postMessage 通信）は offscreen.ts に閉じた実装詳細であり、
 * 意図的にこの型定義の対象外としている（PBI: 2026-07-16-05）。
 */

import type { BrowsingLogRecord, QueryOptions } from '../utils/sqlite-types.js';

export type SqliteMessage =
  | { type: 'SQLITE_HEALTH_CHECK'; payload?: never }
  | { type: 'SQLITE_INIT'; payload?: never }
  | { type: 'SQLITE_INSERT'; payload: Record<string, unknown> }
  | { type: 'SQLITE_INSERT_BATCH'; payload: { records: Record<string, unknown>[] } }
  | { type: 'SQLITE_QUERY'; payload?: Partial<QueryOptions> }
  | { type: 'SQLITE_AUDIT_LOG_INSERT'; payload: { provider: string; url: string; created_at: number } }
  | { type: 'SQLITE_AUDIT_LOG_QUERY'; payload?: { limit?: number; offset?: number } }
  | { type: 'SQLITE_SEARCH'; payload: { query: string; limit?: number; offset?: number } }
  | { type: 'SQLITE_UPDATE'; payload: { id: number } & Partial<Record<string, unknown>> }
  | { type: 'SQLITE_DELETE'; payload: { id: number } }
  | { type: 'SQLITE_TOGGLE_STAR'; payload: { id: number } }
  | { type: 'SQLITE_COUNT'; payload?: never }
  | { type: 'SQLITE_STATUS'; payload?: never }
  | { type: 'SQLITE_CLEAR_ALL'; payload?: never }
  | { type: 'SQLITE_EXPORT'; payload?: never }
  | { type: 'SQLITE_BACKUP'; payload?: never }
  | { type: 'SQLITE_RESTORE'; payload: { data: number[] } }
  | { type: 'SQLITE_PURGE'; payload?: { retentionDays?: number; maxRecords?: number } }
  | { type: 'CONTENT_PURGE'; payload?: { retentionDays?: number; maxRecords?: number; includeStarred?: boolean } }
  | { type: 'SQLITE_OPFS_SPIKE'; payload?: never };

export type SqliteMessageType = SqliteMessage['type'];

/** SqliteMessage として扱う type の一覧。offscreen.ts の送信元検証で使用する。 */
export const SQLITE_MESSAGE_TYPES: readonly SqliteMessageType[] = [
  'SQLITE_HEALTH_CHECK',
  'SQLITE_INIT',
  'SQLITE_INSERT',
  'SQLITE_INSERT_BATCH',
  'SQLITE_QUERY',
  'SQLITE_AUDIT_LOG_INSERT',
  'SQLITE_AUDIT_LOG_QUERY',
  'SQLITE_SEARCH',
  'SQLITE_UPDATE',
  'SQLITE_DELETE',
  'SQLITE_TOGGLE_STAR',
  'SQLITE_COUNT',
  'SQLITE_STATUS',
  'SQLITE_CLEAR_ALL',
  'SQLITE_EXPORT',
  'SQLITE_BACKUP',
  'SQLITE_RESTORE',
  'SQLITE_PURGE',
  'CONTENT_PURGE',
  'SQLITE_OPFS_SPIKE',
];

/** message.type が SqliteMessage の既知の type と一致するか判定する型ガード。 */
export function isSqliteMessageType(type: unknown): type is SqliteMessageType {
  return typeof type === 'string' && (SQLITE_MESSAGE_TYPES as readonly string[]).includes(type);
}
