/**
 * rowCodec.ts
 * Single owner of browsing_logs row shapes: the canonical column lists and
 * the named/positional cell coercions every backend maps through.
 *
 * IdbVfsBackend read positionally (33 full columns for plain listings, 11
 * for FTS/LIKE search) while the OPFS worker read by name (13 plain, 11
 * search); each had a private mapper, so a schema column insertion silently
 * broke the positional readers. Mappers now zip cells against these lists,
 * so SELECT order — not schema order — decides the mapping.
 *
 * Response shapes are intentionally NOT unified here: the IDB plain listing
 * returns all 33 entry fields, the OPFS plain listing 13, search paths 11.
 * Unifying those would add/remove wire fields the dashboard already tolerates
 * as-is. The codec only guarantees each shape is coerced identically.
 */
import { COLUMN_NAMES } from './schema.js';
import type { SqliteValue } from './sqliteEngine.js';

export type NamedRow = Record<string, SqliteValue | null | undefined>;
export type PositionalRow = readonly (SqliteValue | null | undefined)[];

/** Shared search projection (FTS and LIKE select the same 10 columns). */
export const SEARCH_COLUMNS = [
  'id',
  'url',
  'title',
  'summary',
  'tags',
  'created_at',
  'domain',
  'visit_duration',
  'scroll_ratio',
  'is_starred',
] as const;

/** Search projection plus the relevance pseudo-column (see coerceCell). */
export const SEARCH_COLUMNS_WITH_RANK = [...SEARCH_COLUMNS, 'rank'] as const;

/** Canonical plain-list projection shared by the SQL builders. */
export const BROWSING_LOG_COLUMNS = [
  ...SEARCH_COLUMNS,
  'is_deleted',
  'obsidian_synced',
  'gist_synced',
] as const;

export const BROWSING_LOG_COLUMNS_SQL = BROWSING_LOG_COLUMNS.join(', ');

/** Full entry projection for the IDB plain listing (id + schema insert order). */
export const BROWSING_LOG_FULL_COLUMNS: readonly string[] = ['id', ...COLUMN_NAMES];

export const BROWSING_LOG_FULL_COLUMNS_SQL = BROWSING_LOG_FULL_COLUMNS.join(', ');

function coerceCell(column: string, value: SqliteValue | null | undefined): SqliteValue | null {
  // LIKE search rows carry no rank column and FTS rows may lack it in
  // hand-built fixtures — default keeps both paths on one mapping.
  if (column === 'rank') return Number((value as number | null | undefined) ?? 0);
  switch (column) {
    case 'id':
    case 'created_at':
    case 'is_starred':
    case 'is_deleted':
    case 'obsidian_synced':
    case 'gist_synced':
    case 'fallback_triggered':
      return Number(value);
    case 'url':
      return String(value);
    case 'title':
    case 'summary':
    case 'tags':
    case 'domain':
    case 'content':
    case 'cleansed_reason':
    case 'ai_provider':
    case 'ai_model':
      return value != null ? String(value) : null;
    default:
      return value != null ? Number(value) : null;
  }
}

/** Map a name-keyed row (OPFS worker engine.query) to exactly `columns`. */
export function mapNamed<T extends object>(row: NamedRow, columns: readonly string[]): T {
  const out: Record<string, SqliteValue | null> = {};
  for (const column of columns) out[column] = coerceCell(column, row[column]);
  return out as T;
}

/** Map a positional row (IDB execWithCache) zipped against `columns`. */
export function mapPositional<T extends object>(row: PositionalRow, columns: readonly string[]): T {
  const out: Record<string, SqliteValue | null> = {};
  columns.forEach((column, index) => {
    out[column] = coerceCell(column, row[index]);
  });
  return out as T;
}
