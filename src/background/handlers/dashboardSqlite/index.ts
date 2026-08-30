import { logError, ErrorCode } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { TOKEN_REQUIRED_SUBTYPES, ALL_DASHBOARD_SQLITE_SUBTYPES } from '../../../messaging/sqliteOperationSecurity.js';
import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../dashboardSqliteProtocol.js';
import type { DashboardSqliteHandlerDeps } from './deps.js';
import { READ_ONLY_SUBTYPES, createReadOnlyHandler } from './readOnlyHandler.js';
import { CORE_CRUD_SUBTYPES, createCoreCrudHandler } from './coreCrudHandler.js';
import { MAINTENANCE_BATCH_SUBTYPES, createMaintenanceBatchHandler } from './maintenanceBatchHandler.js';

// Fail fast if the subtype partition ever drifts from the protocol union:
// every subtype must land in exactly one group, so a subtype added to a
// handler but forgotten in the protocol (or vice versa) becomes a startup
// error instead of a silent "Unknown subtype" at runtime.
const GROUPED_SUBTYPES: readonly DashboardSqliteSubtype[] = [
  ...READ_ONLY_SUBTYPES,
  ...CORE_CRUD_SUBTYPES,
  ...MAINTENANCE_BATCH_SUBTYPES,
];
const GROUPED_UNIQUE = new Set<DashboardSqliteSubtype>(GROUPED_SUBTYPES);
if (
  GROUPED_UNIQUE.size !== GROUPED_SUBTYPES.length ||
  GROUPED_UNIQUE.size !== ALL_DASHBOARD_SQLITE_SUBTYPES.length
) {
  throw new Error(
    `Dashboard SQLite subtype partition is inconsistent: ${GROUPED_UNIQUE.size} unique of ${ALL_DASHBOARD_SQLITE_SUBTYPES.length} subtypes`,
  );
}

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
      const action = subtype;
      const id = (payload as unknown as { id?: number }).id;
      let verified = false;
      if (providedToken) {
        if (typeof deps.verifyConfirmToken === 'function') {
          verified = await deps.verifyConfirmToken(providedToken, action, id);
        } else if (typeof (deps as unknown as { getConfirmToken?: () => Promise<string> }).getConfirmToken === 'function') {
          const valid = await (deps as unknown as { getConfirmToken: () => Promise<string> }).getConfirmToken();
          verified = providedToken === valid;
        }
      }
      if (!verified) {
        logError(
          'Dashboard SQLite: token mismatch',
          { subtype, hasToken: Boolean(providedToken) },
          ErrorCode.INTERNAL_ERROR,
        );
        return { success: false, error: 'Confirmation token mismatch' };
      }
    }

    try {
      // `await` each call so a rejection is caught here instead of escaping
      // the try block (a bare `return handler(payload)` would not be).
      if (READ_ONLY_SUBTYPES.has(subtype)) {
        return await readOnlyHandler(payload);
      }
      if (CORE_CRUD_SUBTYPES.has(subtype)) {
        return await coreCrudHandler(payload);
      }
      return await maintenanceBatchHandler(payload);
    } catch (error) {
      logError('Dashboard SQLite error', {
        subtype,
        error: errorMessage(error),
      }, ErrorCode.UNKNOWN_ERROR);
      return { success: false, error: 'An internal error occurred' };
    }
  };
}

export {
  type DashboardSqliteHandlerDeps,
  type SqliteClientBackedDeps,
  createSqliteClientDeps,
} from './deps.js';
