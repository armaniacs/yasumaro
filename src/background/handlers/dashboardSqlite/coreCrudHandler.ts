import { logError, logInfo, ErrorCode } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { StorageKeys } from '../../../utils/storage.js';
import type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';
import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../dashboardSqliteProtocol.js';
import type { CoreCrudDeps } from './deps.js';
import { toFailure, ALLOWED_UPDATE_FIELDS, MAX_APPEND_IDS } from './deps.js';

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
      case 'toggle_star': {
        const result = await deps.toggleStar(payload.id);
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true, ...result.data };
      }
      case 'delete': {
        const result = await deps.delete(payload.id);
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true };
      }
      case 'update': {
        const changes = payload.changes || {};
        const invalidKeys = Object.keys(changes).filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
        if (invalidKeys.length > 0) {
          return { success: false, error: `Invalid update fields: ${invalidKeys.join(', ')}` };
        }
        const result = await deps.update(payload.id, changes);
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true };
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
