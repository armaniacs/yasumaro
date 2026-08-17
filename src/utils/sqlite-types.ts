/**
 * sqlite-types.ts
 * Shared type definitions for SQLite browsing log records.
 * Single source of truth — used by offscreen, background, and dashboard layers.
 */

// ============================================================================
// Core Types
// ============================================================================

export interface BrowsingLogRecord {
  id?: number;
  url: string;
  title?: string | null;
  summary?: string | null;
  tags?: string | null;
  created_at: number;
  domain?: string | null;
  visit_duration?: number | null;
  scroll_ratio?: number | null;
  is_starred?: number;
  is_deleted?: number;
  obsidian_synced?: number;
  gist_synced?: number;
  content?: string | null;
  masked_count?: number | null;
  cleansed_reason?: string | null;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_duration_ms?: number | null;
  obsidian_duration_ms?: number | null;
  sent_tokens?: number | null;
  received_tokens?: number | null;
  original_tokens?: number | null;
  cleansed_tokens?: number | null;
  page_bytes?: number | null;
  candidate_bytes?: number | null;
  original_bytes?: number | null;
  cleansed_bytes?: number | null;
  ai_summary_original_bytes?: number | null;
  ai_summary_cleansed_bytes?: number | null;
  extracted_sentences_bytes?: number | null;
  extracted_sentences_original_bytes?: number | null;
  fallback_triggered?: number | null;
}

// Dashboard row type derived from BrowsingLogRecord (id is required)
export type BrowsingLogEntry = BrowsingLogRecord & { id: number };

/**
 * Unified read query — replaces the separate query(QueryOptions) and
 * search(query, limit, offset, options) signatures on StorageBackend.
 *
 * When `text` is present the backend decides FTS5 vs LIKE internally
 * (same trigram-length check as before).  When absent, the query is a
 * plain filtered listing without text relevance.
 *
 * This is a plain-data interface (no class instances) so it can cross
 * postMessage / chrome.runtime.sendMessage boundaries unchanged.
 */
export interface StorageQuery {
  /** Full-text search term (triggers FTS5 MATCH or LIKE when >= 3 chars) */
  text?: string;
  /** Tag filter (client-side in dashboard, FTS5 match in OPFS worker) */
  tag?: string;
  /** Starred-only filter */
  starred?: boolean;
  /** Domain filter (exact match) */
  domain?: string;
  /** Sort column: 'created_at' (default) or 'rank' (FTS5 relevance) */
  orderBy?: 'created_at' | 'rank';
  /** Sort direction (default: DESC) */
  orderDir?: 'ASC' | 'DESC';
  /** Maximum rows to return (default: 100, capped at MAX_QUERY_LIMIT) */
  limit?: number;
  /** Rows to skip (default: 0) */
  offset?: number;
  /** Epoch-ms lower bound (inclusive) */
  dateFrom?: number;
  /** Epoch-ms upper bound (inclusive) */
  dateTo?: number;
  /** Filter by gist_synced status (0 = unsynced, 1 = synced) */
  gistSynced?: number;
  /** Filter by specific IDs (targeted query, bypasses normal paging) */
  ids?: number[];
  /** Filter out deleted records (default: true) */
  excludeDeleted?: boolean;
}

export interface QueryOptions {
  /** Maximum number of rows to return */
  limit?: number;
  /** Number of rows to skip */
  offset?: number;
  /** Column to order by (default: created_at) */
  orderBy?: string;
  /** Sort direction (default: DESC) */
  orderDir?: 'ASC' | 'DESC';
  /** Filter by domain (exact match) */
  domain?: string;
  /** Filter by starred status */
  isStarred?: boolean;
  /** Filter out deleted records (default: true) */
  excludeDeleted?: boolean;
  /** Filter records on or after this timestamp (Unix ms) */
  since?: number;
  /** Filter records on or before this timestamp (Unix ms) */
  until?: number;
  /** Filter by specific IDs (targeted query, bypasses limit if set) */
  ids?: number[];
  /** Filter by tag name (FTS5 match on tags column, without # prefix) */
  tagFilter?: string;
  /** Filter by gist_synced status (0 = unsynced, 1 = synced) */
  gistSynced?: number;
}

export interface SearchResult {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
  tags: string | null;
  created_at: number;
  domain: string | null;
  visit_duration: number | null;
  scroll_ratio: number | null;
  is_starred: number;
  /** FTS5 rank (relevance score) */
  rank: number;
}

export interface AuditLogRecord {
  provider: string;
  url: string;
  created_at: number;
}

export interface AuditLogEntry extends AuditLogRecord {
  id: number;
}
