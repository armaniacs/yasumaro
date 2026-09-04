import { SettingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { formatEntriesToMarkdown } from '../../../utils/markdownFormatter.js';
import { ObsidianClient } from '../../obsidianClient.js';
import type { BrowsingLogEntry, BrowsingLogRecord } from '../../../utils/sqlite-types.js';
import type { CallResult, SqliteError } from '../../sqlite/offscreenGateway.js';

export const ALLOWED_UPDATE_FIELDS = ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted', 'obsidian_synced'];
export const MAX_APPEND_IDS = 100;
// VULN-006: cap bulk import rows to prevent SW/offscreen queue saturation
// (the append path already caps at MAX_APPEND_IDS).
export const MAX_IMPORT_ROWS = 5000;

/**
 * Every result the SqliteClient-backed deps return carries its own failure
 * reason. The call that produced the failure is the only place that knows
 * why it failed, so the reason travels with the return value instead of
 * being read back out of shared state afterward.
 */
export type DepsResult<T> = CallResult<T>;

/**
 * Common failure mapping: every *Result deps call classifies its failure
 * (kind, message, retriable), so the handler only forwards the message and
 * retriable flag instead of reinterpreting them per case.
 */
export function toFailure(result: { success: false; error: SqliteError }): { success: false; error: string; retriable: boolean } {
  return { success: false, error: result.error.message, retriable: result.error.retriable };
}

/** Deps consumed by the read-only subtype group (never mutates, never needs a confirmToken). */
export interface ReadOnlyDeps {
  query: (params: Record<string, unknown>) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  search: (query: string, limit: number, offset: number, options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' }) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  getCount: () => Promise<DepsResult<number>>;
  /**
   * Deliberately not a DepsResult: getStatus() reports initialization
   * failure inside its success value (as `initError`) so the diagnostics
   * panel can display it, rather than as a DepsResult failure — see
   * SqliteClient.getStatus().
   */
  getStatus: () => Promise<Record<string, unknown> | null>;
  runOpfsSpike: () => Promise<DepsResult<Record<string, unknown>>>;
  queryAuditLog: (options: { limit?: number; offset?: number }) => Promise<DepsResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>>;
  createConfirmToken: (action: string, id?: number) => Promise<string>;
  verifyConfirmToken: (token: string, action: string, id?: number) => Promise<boolean>;
  /** @deprecated legacy - kept for test compat, maps to create/verify */
  getConfirmToken?: () => Promise<string>;
}

/** Deps consumed by the everyday dashboard mutation group (toggle_star/delete/update/clear_all/append_to_obsidian). */
export interface CoreCrudDeps {
  toggleStar: (id: number) => Promise<DepsResult<{ is_starred: number }>>;
  delete: (id: number) => Promise<DepsResult<void>>;
  update: (id: number, changes: Record<string, unknown>) => Promise<DepsResult<void>>;
  clearAll: () => Promise<DepsResult<void>>;
  query: (params: Record<string, unknown>) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  getSettings: () => Promise<Record<string, unknown>>;
  formatEntriesToMarkdown: (entries: BrowsingLogEntry[]) => string | null;
  appendToDailyNote: (markdown: string) => Promise<void>;
}

/** Deps consumed by the maintenance/migration/backup group. */
export interface MaintenanceBatchDeps {
  insert: (record: Record<string, unknown>) => Promise<DepsResult<{ id: number }>>;
  getSettings: () => Promise<Record<string, unknown>>;
  restoreDb: (data: Uint8Array) => Promise<DepsResult<void>>;
  purgeOldRecords: (days?: number, max?: number) => Promise<DepsResult<{ purged: number }>>;
  purgeContent: (days?: number, max?: number, includeStarred?: boolean) => Promise<DepsResult<{ purged: number }>>;
  backupDb: () => Promise<DepsResult<Uint8Array>>;
  runMigration: () => Promise<
    | { success: true; count: number; read: number; inserted: number; error?: string }
    | { success: false; error?: string; count?: number; read?: number; inserted?: number }
  >;
  runBackfill: () => Promise<{ updated: number; total: number }>;
  runCleanup: () => Promise<{ removed: string[]; totalBytes: number }>;
}

/** Union of the three groups — what createDashboardSqliteHandler needs as a whole. Unchanged external shape. */
export type DashboardSqliteHandlerDeps = ReadOnlyDeps & CoreCrudDeps & MaintenanceBatchDeps;

/**
 * The operations this handler needs that a SqliteClient can supply.
 *
 * Everything outside this set (migration, confirm tokens, backfill, cleanup)
 * is owned by the Service Worker and has to be passed in separately.
 */
export interface SqliteClientBackedDeps {
  runMigration: DashboardSqliteHandlerDeps['runMigration'];
  createConfirmToken: DashboardSqliteHandlerDeps['createConfirmToken'];
  verifyConfirmToken: DashboardSqliteHandlerDeps['verifyConfirmToken'];
  runBackfill: DashboardSqliteHandlerDeps['runBackfill'];
  runCleanup: DashboardSqliteHandlerDeps['runCleanup'];
}

/**
 * Builds the handler's dependencies from a SqliteClient.
 *
 * Both the Service Worker and the tests go through this, so there is one
 * answer to "how is this handler wired". Previously the two were assembled
 * independently and had drifted: the test-only wrapper stubbed migration,
 * confirm-token, backfill and cleanup, so the Service Worker's real
 * implementations of those four were never exercised by any test.
 */
export function createSqliteClientDeps(
  sqliteClient: import('../../sqlite/offscreenGateway.js').SqliteClient,
  serviceWorkerDeps: SqliteClientBackedDeps & { getConfirmToken?: () => Promise<string> },
): DashboardSqliteHandlerDeps {
  const normalizedDeps: SqliteClientBackedDeps = (() => {
    const anyDeps = serviceWorkerDeps as unknown as Record<string, unknown>;
    if ('getConfirmToken' in anyDeps && typeof anyDeps['getConfirmToken'] === 'function' && !('verifyConfirmToken' in anyDeps)) {
      const legacyFn = anyDeps['getConfirmToken'] as () => Promise<string>;
      const mapped: Record<string, unknown> = { ...anyDeps };
      if (!mapped['createConfirmToken']) mapped['createConfirmToken'] = async () => await legacyFn();
      if (!mapped['verifyConfirmToken']) mapped['verifyConfirmToken'] = async (token: string) => token === await legacyFn();
      delete mapped['getConfirmToken'];
      return mapped as unknown as SqliteClientBackedDeps;
    }
    return serviceWorkerDeps as SqliteClientBackedDeps;
  })();
  return {
    // Every delegate keeps the failure reason attached to the call that
    // produced it, rather than routing it through shared client state.
    query: (params) => sqliteClient.query(params),
    search: (text, limit, offset, options) =>
      sqliteClient.query({ kind: 'search', text, limit, offset, ...pickDefined({ orderBy: options?.orderBy, orderDir: options?.orderDir }) }),
    toggleStar: (id) => sqliteClient.mutate({ type: 'toggleStar', id }),
    delete: (id) => sqliteClient.mutate({ type: 'delete', id }),
    update: (id, changes) => sqliteClient.mutate({ type: 'update', id, changes }),
    getCount: () => sqliteClient.query({ kind: 'count' }),
    clearAll: () => sqliteClient.maintain({ type: 'clearAll' }),
    // WHY: `Record<string, unknown>` is not structurally compatible with `BrowsingLogRecord` (missing required fields)
    insert: (record) => sqliteClient.mutate({ type: 'insert', record: record as unknown as BrowsingLogRecord }),
    restoreDb: (data) => sqliteClient.maintain({ type: 'restore', data }),
    // Deliberately not a result union: getStatus() reports initialization failure
    // inside its success value so the diagnostics panel can display it.
    getStatus: () => sqliteClient.getStatus(),
runOpfsSpike: () => sqliteClient.maintain({ type: 'opfsSpike' }) as Promise<DepsResult<Record<string, unknown>>>,
     purgeOldRecords: (days?: number, max?: number) => sqliteClient.maintain({ type: 'purgeOldRecords', retentionDays: days, maxRecords: max } as { type: 'purgeOldRecords', retentionDays?: number, maxRecords: number }),
     purgeContent: (days?: number, max?: number, includeStarred?: boolean) =>
      sqliteClient.maintain({ type: 'purgeContent', retentionDays: days, maxRecords: max, includeStarred } as { type: 'purgeContent', retentionDays?: number, maxRecords?: number, includeStarred: boolean }),
     backupDb: () => sqliteClient.maintain({ type: 'backup' }),
      getSettings: () => new SettingsRepository().getAll() as Promise<Record<string, unknown>>,
     formatEntriesToMarkdown: (entries) => formatEntriesToMarkdown(entries),
     queryAuditLog: (options) => sqliteClient.query({ kind: 'auditLog', limit: options?.limit, offset: options?.offset } as { kind: 'auditLog', limit?: number, offset?: number }),
    appendToDailyNote: async (markdown) => {
      const obsidianClient = new ObsidianClient();
      await obsidianClient.appendToDailyNote(markdown);
    },
    ...normalizedDeps,
  };
}
