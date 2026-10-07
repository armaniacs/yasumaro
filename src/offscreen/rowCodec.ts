/**
 * rowCodec.ts
 * Single owner of browsing_logs and audit_log row shapes: the canonical
 * column lists and the named/positional cell coercions every backend maps
 * through.
 *
 * IdbVfsBackend read positionally (36 full columns for plain listings, 11
 * for LIKE search, 12 for FTS search with rank) while the OPFS worker read
 * by name (16 plain, 11 search); each had a private mapper, so a schema
 * column insertion silently broke the positional readers. Mappers now zip
 * cells against these lists, so SELECT order — not schema order — decides
 * the mapping. The lists must stay exactly as wide as their SELECTs: a name
 * list wider than its SELECT shifts the trailing cells one position each.
 *
 * Response shapes are intentionally NOT unified here: the IDB plain listing
 * returns all entry fields (id + the 35 schema columns), the OPFS plain
 * listing the 16 canonical columns, the search paths the 11 search columns
 * (FTS adds rank). Unifying those would add/remove wire fields the dashboard
 * already tolerates as-is. The codec only guarantees each shape is coerced
 * identically.
 */
import { COLUMN_NAMES } from './schema.js';
import type { SqliteValue } from './sqliteEngine.js';

export type NamedRow = Record<string, SqliteValue | null | undefined>;
export type PositionalRow = readonly (SqliteValue | null | undefined)[];

/**
 * Shared search projection: the LIKE SELECT selects exactly these 11 cells;
 * the FTS SELECT adds the rank pseudo-column on top (SEARCH_COLUMNS_WITH_RANK).
 */
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
  // PBI 05: the diagnosis "Fallback reason" row renders from list/search
  // projections too — without this the column only ever reaches the UI via
  // the IDB full-listing path (backend-dependent display).
  'fallback_reason',
] as const;

/** Search projection plus the relevance pseudo-column (see coerceCell). */
export const SEARCH_COLUMNS_WITH_RANK = [...SEARCH_COLUMNS, 'rank'] as const;

/** Canonical plain-list projection shared by the SQL builders. */
export const BROWSING_LOG_COLUMNS = [
  ...SEARCH_COLUMNS,
  // PBI 03: the navigation trail renders in the dashboard from the list
  // projection, so both columns must survive the OPFS path too. They stay
  // OUT of SEARCH_COLUMNS on purpose: no search SELECT emits them, and a
  // name wider than its SELECT misplaces the cells it zips against.
  'nav_source_url',
  'search_query',
  'is_deleted',
  'obsidian_synced',
  'gist_synced',
] as const;

export const BROWSING_LOG_COLUMNS_SQL = BROWSING_LOG_COLUMNS.join(', ');

/** Full entry projection for the IDB plain listing (id + schema insert order). */
export const BROWSING_LOG_FULL_COLUMNS: readonly string[] = ['id', ...COLUMN_NAMES];

export const BROWSING_LOG_FULL_COLUMNS_SQL = BROWSING_LOG_FULL_COLUMNS.join(', ');

/**
 * Audit-log listing projection: the exact SELECT order of
 * buildAuditLogStatements — both backends zip against this list, so SELECT
 * order decides the mapping and any SELECT change must land here too.
 */
export const AUDIT_LOG_COLUMNS = ['id', 'provider', 'url', 'created_at'] as const;

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
    // Audit provider is TEXT and shares url's unconditional String coercion:
    // without a case here the default branch would run Number() and blank
    // every provider out in the audit trail.
    case 'provider':
      return String(value);
    case 'title':
    case 'summary':
    case 'tags':
    case 'domain':
    case 'content':
    case 'cleansed_reason':
    case 'ai_provider':
    case 'ai_model':
    case 'fallback_reason':
    // WHY listed explicitly: the default branch runs Number(), which would turn
    // these TEXT columns into NaN and blank them out in the UI.
    case 'nav_source_url':
    case 'search_query':
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
