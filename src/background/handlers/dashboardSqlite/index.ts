import { logError, ErrorCode } from '../../../utils/logger.js';
import { TOKEN_REQUIRED_SUBTYPES } from '../../../messaging/sqliteOperationSecurity.js';
import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../dashboardSqliteProtocol.js';
import type { DashboardSqliteHandlerDeps } from './deps.js';
import { createReadOnlyHandler } from './readOnlyHandler.js';
import { createCoreCrudHandler } from './coreCrudHandler.js';
import { createMaintenanceBatchHandler } from './maintenanceBatchHandler.js';

/** Which of the three sub-handlers owns each subtype. Single source of truth for the routing decision. */
const READ_ONLY_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'confirm_token', 'query', 'search', 'get_count', 'status', 'opfs_spike', 'audit_log_query',
]);
const CORE_CRUD_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'toggle_star', 'delete', 'update', 'clear_all', 'append_to_obsidian',
]);
// Everything else (migrate, import, restore_db, backup_db, backfill_metadata,
// cleanup_legacy, purge_now, content_purge_now) falls through to maintenance.
// An unrecognised subtype string also falls through here, and is reported by
// maintenanceBatchHandler's own `default` case.

export function createDashboardSqliteHandler(deps: DashboardSqliteHandlerDeps) {
  const readOnlyHandler = createReadOnlyHandler(deps);
  const coreCrudHandler = createCoreCrudHandler(deps);
  const maintenanceBatchHandler = createMaintenanceBatchHandler(deps);

  return async (
    payload: DashboardSqliteRequest & { confirmToken?: string },
  ): Promise<unknown> => {
    const subtype = payload.subtype;

    if (TOKEN_REQUIRED_SUBTYPES.has(subtype)) {
      const providedToken = payload.confirmToken;
      const validConfirmToken = await deps.getConfirmToken();
      if (!providedToken || providedToken !== validConfirmToken) {
        logError(
          'Dashboard SQLite: token mismatch',
          { subtype, hasToken: Boolean(providedToken) },
          ErrorCode.INTERNAL_ERROR,
        );
        return { success: false, error: 'Confirmation token mismatch' };
      }
    }

    if (READ_ONLY_SUBTYPES.has(subtype)) {
      return readOnlyHandler(payload);
    }
    if (CORE_CRUD_SUBTYPES.has(subtype)) {
      return coreCrudHandler(payload);
    }
    return maintenanceBatchHandler(payload);
  };
}

export {
  type DashboardSqliteHandlerDeps,
  type ReadOnlyDeps,
  type CoreCrudDeps,
  type MaintenanceBatchDeps,
  type SqliteClientBackedDeps,
  type DepsResult,
  createSqliteClientDeps,
  toFailure,
  ALLOWED_UPDATE_FIELDS,
  MAX_APPEND_IDS,
  MAX_IMPORT_ROWS,
} from './deps.js';
