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
}

// Dashboard row type derived from BrowsingLogRecord (no is_deleted, id is required)
export type BrowsingLogEntry = Omit<BrowsingLogRecord, 'is_deleted'> & { id: number };

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
