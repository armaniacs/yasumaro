import { StorageKeys } from '../../../utils/storage/types.js';
import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../../../messaging/dashboardSqliteProtocol.js';
import { bytesToBase64, base64ToBytes } from '../../../utils/crypto/index.js';
import type { DepsResult, MaintenanceBatchDeps } from './deps.js';
import { toFailure, MAX_IMPORT_ROWS, MAX_RESTORE_BASE64_BYTES } from './deps.js';

/**
 * Subtypes this handler owns. The router derives its dispatch from this set
 * (everything not in this set, including unrecognised strings, also lands
 * here via the router's fallthrough and is reported by the `default` case).
 */
export const MAINTENANCE_BATCH_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'migrate', 'import', 'restore_db', 'backup_db', 'backfill_metadata', 'resync_legacy', 'cleanup_legacy', 'purge_now', 'content_purge_now',
]);

/**
 * Settings-keys spec table for the two retention subtypes (PBI 2026-10-16-11).
 * The twins differ only in keys and the deps call — adding a retention
 * dimension is one row here, and a key rename cannot land on one twin and
 * miss the other.
 */
const SETTINGS_PURGE_SPEC = {
  purge_now: {
    daysKey: StorageKeys.SQLITE_RETENTION_DAYS,
    maxKey: StorageKeys.SQLITE_MAX_RECORDS,
  },
  content_purge_now: {
    daysKey: StorageKeys.CONTENT_RETENTION_DAYS,
    maxKey: StorageKeys.CONTENT_MAX_RECORDS,
    starredKey: StorageKeys.CONTENT_PURGE_INCLUDE_STARRED,
  },
} as const;

type SettingsPurgePlan =
  | { skip: true }
  | { ok: true; retentionDays?: number | undefined; maxRecords?: number | undefined; includeStarred?: boolean | undefined }
  | { ok: false; error: string };

const isPurgeAbsent = (raw: unknown): boolean => raw === undefined || raw === null;

/**
 * Layer-local mirror of offscreen `queryPlanner.planSettingsPurge`
 * (PBI 2026-10-16-11). The background cannot statically import the planner
 * (background→offscreen import ban, PBI 2026-09-21-20), so the same contract
 * lives here: both-absent → skip, present sides checked as non-negative
 * integers with `0` normalizing to "skip this dimension", garbage failing
 * closed instead of being coerced through Number(). Parity with the planner
 * is pinned by maintenanceBatchHandler-purge-plan.test.ts — change the rule
 * in the planner first, then mirror it here.
 */
function planSettingsPurge(
  settings: Record<string, unknown>,
  daysKey: string,
  maxKey: string,
  includeStarredKey?: string,
): SettingsPurgePlan {
  const daysRaw = settings[daysKey];
  const maxRaw = settings[maxKey];
  if (isPurgeAbsent(daysRaw) && isPurgeAbsent(maxRaw)) {
    return { skip: true };
  }
  const planDim = (raw: unknown, name: string): number | undefined | string => {
    if (isPurgeAbsent(raw)) return undefined;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
      return `${name} must be a non-negative integer, got ${String(raw)}`;
    }
    return raw === 0 ? undefined : raw;
  };
  const days = planDim(daysRaw, 'retentionDays');
  if (typeof days === 'string') return { ok: false, error: days };
  const max = planDim(maxRaw, 'maxRecords');
  if (typeof max === 'string') return { ok: false, error: max };
  const starredRaw = includeStarredKey !== undefined ? settings[includeStarredKey] : undefined;
  return {
    ok: true,
    retentionDays: days,
    maxRecords: max,
    ...(typeof starredRaw === 'boolean' ? { includeStarred: starredRaw } : {}),
  };
}

export function createMaintenanceBatchHandler(deps: MaintenanceBatchDeps) {
  /**
   * Shared settings-purge flow: the two retention subtypes differ only in the
   * spec row and the deps call, so plan -> invoke -> toFailure -> response
   * projection lives here once. Kept as a single seam so a guard or
   * response-shape fix cannot land on one twin and miss the other.
   */
  const runSettingsPurge = async (
    spec: { daysKey: string; maxKey: string; starredKey?: string },
    purge: (
      days: number | undefined,
      max: number | undefined,
      includeStarred: boolean | undefined,
    ) => Promise<DepsResult<{ purged: number }>>,
  ): Promise<unknown> => {
    const settings = await deps.getSettings();
    const planned = planSettingsPurge(settings, spec.daysKey, spec.maxKey, spec.starredKey);
    if ('skip' in planned) {
      return { success: true, purged: 0, skipped: true };
    }
    if (!planned.ok) {
      return { success: false, error: planned.error };
    }
    const result = await purge(
      planned.retentionDays,
      planned.maxRecords,
      spec.starredKey !== undefined ? (planned.includeStarred ?? false) : undefined,
    );
    if (!result.success) {
      return toFailure(result);
    }
    return { success: true, purged: result.data.purged, skipped: false };
  };

  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const subtype = payload.subtype;
    switch (subtype) {
      case 'migrate': {
        const migrateResult = await deps.runMigration();
        return migrateResult.success
          ? { success: true, count: migrateResult.count, read: migrateResult.read, inserted: migrateResult.inserted, error: migrateResult.error }
          : { success: false, error: migrateResult.error || 'Migration failed' };
      }
      case 'import': {
        const rows = payload.rows;
        if (!Array.isArray(rows) || rows.length === 0) {
          return { success: false, error: 'No rows provided' };
        }
        // VULN-006: reject oversized collections instead of looping unbounded.
        if (rows.length > MAX_IMPORT_ROWS) {
          return { success: false, error: `Maximum ${MAX_IMPORT_ROWS} rows allowed` };
        }
        // PBI 2026-09-11-07: one insertBatch round trip instead of one `insert`
        // per row (MAX_IMPORT_ROWS round trips over SW→offscreen→backend).
        // Duplicates surface as `skipped` from the backend's INSERT OR IGNORE
        // instead of per-row errors that only kept the last reason.
        const result = await deps.insertBatch(rows.map(row => ({
          url: row.url,
          title: row.title ?? null,
          summary: row.summary ?? null,
          tags: row.tags ?? null,
          created_at: row.created_at,
          domain: row.domain ?? null,
          visit_duration: row.visit_duration ?? null,
          scroll_ratio: row.scroll_ratio ?? null,
          is_starred: row.is_starred ?? 0,
          is_deleted: row.is_deleted ?? 0,
        })));
        if (!result.success) {
          return { success: false, error: result.error.message };
        }
        return { success: true, inserted: result.data.count, skipped: result.data.skipped, total: rows.length };
      }
      case 'restore_db': {
        const data = payload.data;
        if (typeof data !== 'string' || data.length === 0) {
          return { success: false, error: 'No data provided' };
        }
        // VULN-008 fix: reject oversized base64 payload before decoding
        // 100MB raw → ~134MB base64; use 150MB base64 as safe ceiling
        if (data.length > MAX_RESTORE_BASE64_BYTES) {
          return { success: false, error: `Restore data exceeds maximum size (${Math.round(data.length / 1024 / 1024)}MB > 100MB)` };
        }
        const result = await deps.restoreDb(base64ToBytes(data));
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true };
      }
      case 'purge_now':
        return runSettingsPurge(
          SETTINGS_PURGE_SPEC.purge_now,
          (days, max) => deps.purgeOldRecords(days, max),
        );
      case 'content_purge_now':
        return runSettingsPurge(
          SETTINGS_PURGE_SPEC.content_purge_now,
          (days, max, includeStarred) => deps.purgeContent(
            days,
            max,
            includeStarred ?? false,
          ),
        );
      case 'backup_db': {
        const result = await deps.backupDb();
        if (result.success) {
          return { success: true, data: bytesToBase64(result.data) };
        }
        return toFailure(result);
      }
      case 'backfill_metadata': {
        try {
          const backfillResult = await deps.runBackfill();
          return { success: true, ...backfillResult };
        } catch {
          return { success: false, error: 'Backfill not available' };
        }
      }
      case 'resync_legacy': {
        try {
          // Manual-only SQLite → legacy resync (PBI 22). The bound is
          // re-clamped inside resyncLegacyFromSqlite; a non-numeric payload
          // value falls back to the default there.
          const maxRecords = typeof payload.maxRecords === 'number' ? payload.maxRecords : undefined;
          const resyncResult = await deps.runLegacyResync(
            maxRecords === undefined ? undefined : { maxRecords },
          );
          return { success: true, ...resyncResult };
        } catch {
          return { success: false, error: 'Resync not available' };
        }
      }
      case 'cleanup_legacy': {
        try {
          const cleanupResult = await deps.runCleanup();
          return { success: true, ...cleanupResult };
        } catch {
          return { success: false, error: 'Cleanup not available' };
        }
      }
      default:
        return { success: false, error: `Unknown subtype: ${subtype}` };
    }
  };
}
