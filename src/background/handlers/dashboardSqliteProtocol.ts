/**
 * dashboardSqliteProtocol.ts
 * Discriminated-union payload/response types for the DASHBOARD_SQLITE
 * message channel between the dashboard (dashboardSqliteService.ts,
 * dashboard.ts) and the service worker (dashboardSqliteHandlers.ts).
 *
 * The subtype string is the discriminant. Adding a new subtype here forces
 * both the sender (payload shape) and the handler (switch-case narrowing)
 * to be updated in lockstep — previously each side only agreed by
 * convention, with `payload.x as T` casts hiding any mismatch.
 */

import type { BrowsingLogEntry } from '../../utils/sqlite-types.js';
import type { OpfsSpikeReport } from '../../offscreen/opfsSpike.js';

// ============================================================================
// Requests (subtype -> payload shape, excluding confirmToken which is
// injected by sendDashboardMessage/withConfirmToken)
// ============================================================================

export type DashboardSqliteRequest =
  | { subtype: 'confirm_token' }
  | {
      subtype: 'query';
      limit?: number;
      offset?: number;
      domain?: string;
      isStarred?: boolean;
      since?: number;
      until?: number;
      orderBy?: string;
      orderDir?: 'ASC' | 'DESC';
      tagFilter?: string;
    }
  | { subtype: 'search'; query: string; limit?: number; offset?: number }
  | { subtype: 'toggle_star'; id: number; confirmToken?: string }
  | { subtype: 'delete'; id: number; confirmToken?: string }
  | { subtype: 'update'; id: number; changes: Record<string, unknown>; confirmToken?: string }
  | { subtype: 'migrate'; confirmToken?: string }
  | { subtype: 'opfs_spike' }
  | { subtype: 'clear_all'; confirmToken?: string }
  | { subtype: 'get_count' }
  | { subtype: 'status' }
  | { subtype: 'cleanup_legacy'; confirmToken?: string }
  | { subtype: 'backfill_metadata'; confirmToken?: string }
  | { subtype: 'backup_db'; confirmToken?: string }
  | { subtype: 'restore_db'; data: string; confirmToken?: string }
  | {
      subtype: 'import';
      rows: Array<{
        url: string; title?: string; summary?: string; tags?: string;
        created_at: number; domain?: string; visit_duration?: number;
        scroll_ratio?: number; is_starred?: number; is_deleted?: number;
      }>;
      confirmToken?: string;
    }
  | { subtype: 'append_to_obsidian'; ids: number[] }
  | { subtype: 'purge_now' }
  | { subtype: 'content_purge_now' }
  | { subtype: 'audit_log_query'; limit?: number; offset?: number };

export type DashboardSqliteSubtype = DashboardSqliteRequest['subtype'];

/** Subtypes that require a valid confirmToken (destructive/mutating operations). */
export const TOKEN_REQUIRED_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'toggle_star', 'update', 'delete', 'migrate', 'backfill_metadata', 'cleanup_legacy', 'clear_all', 'import', 'restore_db', 'backup_db',
]);

/** Subtypes whose confirmation UI is a full modal dialog (vs. inline confirm). */
export const MODAL_REQUIRED_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'delete', 'migrate', 'cleanup_legacy', 'clear_all',
]);

// ============================================================================
// Responses (subtype -> response shape)
// ============================================================================

interface DashboardSqliteFailure {
  success: false;
  error: string;
}

export type DashboardSqliteResponseFor<S extends DashboardSqliteSubtype> =
  | DashboardSqliteFailure
  | (
      S extends 'confirm_token' ? { success: true; confirmToken: string } :
      S extends 'query' ? { success: true; rows: BrowsingLogEntry[]; total: number } :
      S extends 'search' ? { success: true; rows: BrowsingLogEntry[]; total: number } :
      S extends 'toggle_star' ? { success: true; is_starred: number } :
      S extends 'delete' ? { success: true } :
      S extends 'update' ? { success: true } :
      S extends 'migrate' ? { success: true; count: number; read?: number; inserted?: number } :
      S extends 'opfs_spike' ? { success: true; report: OpfsSpikeReport } :
      S extends 'clear_all' ? { success: true } :
      S extends 'get_count' ? { success: true; count: number } :
      S extends 'status' ? {
        success: true;
        initialized: boolean;
        path: string;
        fallback: boolean;
        fts5: boolean;
        compileOptions?: string[];
        compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
        initError?: string;
        // OPFS migration status (PBI: 2026-07-17-08)
        opfsMigrationV2Done?: boolean;
        opfsMigrationV2LastAttemptedAt?: string | null;
        opfsMigrationV2CompletedAt?: string | null;
        opfsMigrationV2RecordCount?: number;
      } :
      S extends 'cleanup_legacy' ? { success: true; removed: string[]; totalBytes: number } :
      S extends 'backfill_metadata' ? { success: true; updated: number; total: number } :
      S extends 'backup_db' ? { success: true; data: string } :
      S extends 'restore_db' ? { success: true } :
      S extends 'import' ? { success: true; inserted: number; skipped: number; total: number } :
      S extends 'append_to_obsidian' ? { success: true; appended: number } :
      S extends 'purge_now' ? { success: true; purged: number; skipped: boolean } :
      S extends 'content_purge_now' ? { success: true; purged: number; skipped: boolean } :
      S extends 'audit_log_query' ? { success: true; rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number } :
      never
    );
