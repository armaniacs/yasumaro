import { logError, ErrorCode } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { TOKEN_REQUIRED_SUBTYPES, ALL_DASHBOARD_SQLITE_SUBTYPES, deriveScopeHash } from '../../../messaging/sqliteOperationSecurity.js';
import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../dashboardSqliteProtocol.js';
import type { DashboardSqliteHandlerDeps } from './deps.js';
import { READ_ONLY_SUBTYPES, createReadOnlyHandler } from './readOnlyHandler.js';
import { CORE_CRUD_SUBTYPES, createCoreCrudHandler } from './coreCrudHandler.js';
import { MAINTENANCE_BATCH_SUBTYPES, createMaintenanceBatchHandler } from './maintenanceBatchHandler.js';
import { ARCHIVE_SUBTYPES, createArchiveHandler } from './archiveHandler.js';
import type { ArchiveDeps } from './deps.js';

// Fail fast if the subtype partition ever drifts from the protocol union:
// every subtype must land in exactly one group, so a subtype added to a
// handler but forgotten in the protocol (or vice versa) becomes a startup
// error instead of a silent "Unknown subtype" at runtime.
const GROUPED_SUBTYPES: readonly DashboardSqliteSubtype[] = [
  ...READ_ONLY_SUBTYPES,
  ...CORE_CRUD_SUBTYPES,
  ...MAINTENANCE_BATCH_SUBTYPES,
  ...ARCHIVE_SUBTYPES,
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
  const archiveHandler = createArchiveHandler(deps as DashboardSqliteHandlerDeps & ArchiveDeps);

  return async (
    payload: DashboardSqliteRequest & { confirmToken?: string },
  ): Promise<unknown> => {
    const subtype = payload.subtype;

    if (TOKEN_REQUIRED_SUBTYPES.has(subtype)) {
      if (!(await verifyRequestToken(deps, subtype, payload))) {
        logError(
          'Dashboard SQLite: token mismatch',
          { subtype, hasToken: Boolean(payload.confirmToken) },
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
      if (ARCHIVE_SUBTYPES.has(subtype)) {
        return await archiveHandler(payload);
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

/**
 * verifyRequestToken — the validation seam of the dashboard→offscreen route
 * (PBI 2026-09-11-07 spike slice). Previously inline in the router closure;
 * extracted so the three verification branches (scoped verify fn / legacy
 * getConfirmToken / absent token) are unit-testable without a full handler.
 *
 * Security posture is unchanged: scopeHash is re-derived from the actual
 * incoming payload (PBI 2026-09-06-01), and a missing verifier fails closed.
 */
export async function verifyRequestToken(
  deps: DashboardSqliteHandlerDeps,
  subtype: DashboardSqliteSubtype,
  payload: DashboardSqliteRequest & { confirmToken?: string },
): Promise<boolean> {
  const providedToken = payload.confirmToken;
  if (!providedToken) return false;
  // PBI 2026-09-06-01: archive subtypes bind the token to destructive
  // parameters (cutoff / stagingName). The hash is re-derived from the
  // actual incoming payload so a token issued for one scope cannot be
  // replayed against another.
  const scopeHash = await deriveScopeHash(subtype, payload as Record<string, unknown> | undefined);
  if (typeof deps.verifyConfirmToken === 'function') {
    return deps.verifyConfirmToken(providedToken, subtype, (payload as unknown as { id?: number }).id, scopeHash);
  }
  if (typeof (deps as unknown as { getConfirmToken?: () => Promise<string> }).getConfirmToken === 'function') {
    const valid = await (deps as unknown as { getConfirmToken: () => Promise<string> }).getConfirmToken();
    return providedToken === valid;
  }
  return false;
}

export {
  type DashboardSqliteHandlerDeps,
  type SqliteClientBackedDeps,
  createSqliteClientDeps,
} from './deps.js';
