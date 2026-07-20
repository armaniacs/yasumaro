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
