import { ErrorCode } from '../../../utils/logger/types.js';
import { logError, logInfo } from '../../../utils/logger/api.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';
import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../dashboardSqliteProtocol.js';
import type { CoreCrudDeps, DepsResult } from './deps.js';
import { toFailure, DASHBOARD_MUTABLE_SUBSET, MAX_APPEND_IDS } from './deps.js';
import { SQLITE_WIRE_DESCRIPTORS, type SqliteWireDescriptor, type SqliteDashboardHop } from '../../../messaging/sqliteWireTable.js';

/**
 * Rows the coreCrud group drives from the wire table. The Required<>
 * forces every driven row to carry the full dashboard block (validate /
 * depsArgs / projectDeps) — a row that drops one fails here instead of
 * throwing at request time.
 */
type DrivenRow = SqliteWireDescriptor & { dashboard: Required<SqliteDashboardHop<unknown>> };
const CORE_CRUD_WIRE = {
  toggleStar: SQLITE_WIRE_DESCRIPTORS.toggleStar,
  delete: SQLITE_WIRE_DESCRIPTORS.delete,
  update: SQLITE_WIRE_DESCRIPTORS.update,
} as const satisfies Record<string, DrivenRow>;

export async function runCoreCrud(
  descriptor: DrivenRow,
  payload: DashboardSqliteRequest,
  deps: CoreCrudDeps,
): Promise<unknown> {
  const raw = payload as unknown as Record<string, unknown>;
  const invalid = descriptor.dashboard.validate(raw);
  if (invalid !== null) return { success: false, error: invalid };
  const invoke = (deps as unknown as Record<string, (...args: unknown[]) => Promise<DepsResult<unknown>>>)[descriptor.depsMethod as string];
  if (typeof invoke !== 'function') return { success: false, error: `Unknown coreCrud deps method: ${String(descriptor.depsMethod)}` };
  const result = await invoke(...descriptor.dashboard.depsArgs(raw));
  if (!result.success) return toFailure(result);
  return { success: true, ...descriptor.dashboard.projectDeps(result.data) };
}

/**
 * Subtypes this handler owns. The router derives its dispatch from this set,
 * so a new CRUD subtype becomes reachable the moment it lands here.
 */
export const CORE_CRUD_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'toggle_star', 'delete', 'update', 'clear_all', 'append_to_obsidian',
]);

export function createCoreCrudHandler(deps: CoreCrudDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const subtype = payload.subtype;
    switch (subtype) {
      // Table-driven (PBI 2026-09-20-16): validate -> delegate -> project
      // all live in the wire-table row; runCoreCrud executes the shared
      // shape like runArchive does for the archive group.
      case 'toggle_star': {
        return runCoreCrud(CORE_CRUD_WIRE.toggleStar, payload, deps);
      }
      case 'delete': {
        return runCoreCrud(CORE_CRUD_WIRE.delete, payload, deps);
      }
      case 'update': {
        // Dashboard policy (not wire codec): only the mutable subset may be
        // edited from the dashboard, so telemetry columns stay untouched.
        // Stays here, next to DASHBOARD_MUTABLE_SUBSET, rather than in the
        // neutral row.
        const changes = payload.changes || {};
        const invalidKeys = Object.keys(changes).filter((k) => !DASHBOARD_MUTABLE_SUBSET.includes(k));
        if (invalidKeys.length > 0) {
          return { success: false, error: `Invalid update fields: ${invalidKeys.join(', ')}` };
        }
        return runCoreCrud(CORE_CRUD_WIRE.update, payload, deps);
      }
      case 'clear_all': {
        const result = await deps.clearAll();
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true };
      }
      case 'append_to_obsidian': {
        const ids = payload.ids;
        // Check 1: array shape
        if (!Array.isArray(ids) || ids.length === 0) {
          return { success: false, error: 'No IDs provided' };
        }
        // Check 2: upper bound (before type check — safe on length property)
        if (ids.length > MAX_APPEND_IDS) {
          return { success: false, error: `Maximum ${MAX_APPEND_IDS} IDs allowed` };
        }
        // Check 3: all elements are finite numbers (safe — at most 100 elements)
        if (!ids.every((id: unknown): id is number => typeof id === 'number' && Number.isFinite(id))) {
          return { success: false, error: 'All IDs must be finite numbers' };
        }

        const allSettings = await deps.getSettings();
        const apiKey = allSettings[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
        if (!apiKey || apiKey.length < 16) {
          return { success: false, error: 'Obsidian API key not configured' };
        }

        const allResult = await deps.query({ ids, limit: ids.length, orderBy: 'id', orderDir: 'ASC' });
        if (!allResult.success) {
          // Report the read failure rather than letting it fall through to
          // "No matching entries found", which suggests the ids were wrong.
          return { success: false, error: allResult.error.message };
        }
        const selectedEntries = allResult.data.rows as BrowsingLogEntry[];

        if (selectedEntries.length === 0) {
          return { success: false, error: 'No matching entries found' };
        }

        const markdown = deps.formatEntriesToMarkdown(selectedEntries);
        if (!markdown) {
          return { success: false, error: 'Failed to format entries' };
        }

        try {
          await deps.appendToDailyNote(markdown);
          logInfo('Appended entries to Obsidian', { count: selectedEntries.length });
          return { success: true, appended: selectedEntries.length };
        } catch (error) {
          logError('Failed to append to Obsidian', {
            error: errorMessage(error),
            count: selectedEntries.length,
          }, ErrorCode.UNKNOWN_ERROR);
          return { success: false, error: errorMessage(error) };
        }
      }
      default:
        // Defensive: unreachable while the router dispatches only
        // CORE_CRUD_SUBTYPES here, but kept so a drifted set entry
        // degrades to a graceful error instead of an undefined response.
        return { success: false, error: `Unknown subtype: ${subtype}` };
    }
  };
}
