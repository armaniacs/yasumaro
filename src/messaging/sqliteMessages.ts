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
  | { type: 'SQLITE_HEALTH_CHECK'; payload?: never; traceId?: string }
  | { type: 'SQLITE_INIT'; payload?: never; traceId?: string }
  | { type: 'SQLITE_INSERT'; payload: Record<string, unknown>; traceId?: string }
  | { type: 'SQLITE_INSERT_BATCH'; payload: { records: Record<string, unknown>[] }; traceId?: string }
  | { type: 'SQLITE_QUERY'; payload?: Partial<QueryOptions>; traceId?: string }
  | { type: 'SQLITE_AUDIT_LOG_INSERT'; payload: { provider: string; url: string; created_at: number }; traceId?: string }
  | { type: 'SQLITE_AUDIT_LOG_QUERY'; payload?: { limit?: number; offset?: number }; traceId?: string }
  | { type: 'SQLITE_SEARCH'; payload: { query: string; limit?: number; offset?: number }; traceId?: string }
  | { type: 'SQLITE_UPDATE'; payload: { id: number } & Partial<Record<string, unknown>>; traceId?: string }
  | { type: 'SQLITE_DELETE'; payload: { id: number }; traceId?: string }
  | { type: 'SQLITE_TOGGLE_STAR'; payload: { id: number }; traceId?: string }
  | { type: 'SQLITE_COUNT'; payload?: never; traceId?: string }
  | { type: 'SQLITE_STATUS'; payload?: never; traceId?: string }
  | { type: 'SQLITE_CLEAR_ALL'; payload?: never; traceId?: string }
  | { type: 'SQLITE_EXPORT'; payload?: never; traceId?: string }
  | { type: 'SQLITE_BACKUP'; payload?: never; traceId?: string }
  | { type: 'SQLITE_RESTORE'; payload: { data: number[] }; traceId?: string }
  | { type: 'SQLITE_PURGE'; payload?: { retentionDays?: number; maxRecords?: number }; traceId?: string }
  | { type: 'CONTENT_PURGE'; payload?: { retentionDays?: number; maxRecords?: number; includeStarred?: boolean }; traceId?: string }
  | { type: 'SQLITE_OPFS_SPIKE'; payload?: never; traceId?: string };

/**
 * SqliteMessage として扱う type の一覧。offscreen.ts の送信元検証で使用する。
 *
 * This array is the single source: SqliteMessageType is derived from it.
 * The reverse direction is impossible — types are erased at runtime and the
 * sender check needs actual values — so the array is what gets written by
 * hand, and the union below is checked against it rather than duplicating it.
 */
export const SQLITE_MESSAGE_TYPES = [
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
] as const;

export type SqliteMessageType = typeof SQLITE_MESSAGE_TYPES[number];

/**
 * Fails to compile when the union and the array drift apart in either
 * direction: a variant whose type is absent from the array (offscreen.ts
 * would reject that message at runtime), or an array entry with no variant
 * (a type nothing can actually construct).
 */
type _UnionCoversArray = SqliteMessageType extends SqliteMessage['type'] ? true : never;
type _ArrayCoversUnion = SqliteMessage['type'] extends SqliteMessageType ? true : never;
const _assertUnionCoversArray: _UnionCoversArray = true;
const _assertArrayCoversUnion: _ArrayCoversUnion = true;
void _assertUnionCoversArray;
void _assertArrayCoversUnion;

/** message.type が SqliteMessage の既知の type と一致するか判定する型ガード。 */
export function isSqliteMessageType(type: unknown): type is SqliteMessageType {
  return typeof type === 'string' && (SQLITE_MESSAGE_TYPES as readonly string[]).includes(type);
}
