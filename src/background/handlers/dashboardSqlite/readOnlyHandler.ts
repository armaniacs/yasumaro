import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../dashboardSqliteProtocol.js';
import type { ReadOnlyDeps } from './deps.js';
import { toFailure } from './deps.js';
import { pickDefined } from '../../../utils/objectUtils.js';
import { clampLimit } from '../../../offscreen/queryPlan.js';

/**
 * Subtypes this handler owns. The router derives its dispatch from this set,
 * so a new read-only subtype becomes reachable the moment it lands here.
 */
export const READ_ONLY_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'create_confirm_token', 'query', 'search', 'get_count', 'status', 'opfs_spike', 'audit_log_query',
]);

export function createReadOnlyHandler(deps: ReadOnlyDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const subtype = payload.subtype;
    switch (subtype) {
      case 'create_confirm_token': {
        const action = (payload as { action?: string }).action;
        const id = (payload as { id?: number }).id;
        if (!action || typeof action !== 'string') {
          return { success: false, error: 'action is required' };
        }
        const token = await deps.createConfirmToken(action, id);
        return { success: true, confirmToken: token };
      }
      case 'query': {
        const result = await deps.query({
          limit: clampLimit(payload.limit, 1000, 100),
          offset: payload.offset ?? 0,
          domain: payload.domain,
          isStarred: payload.isStarred,
          since: payload.since,
          until: payload.until,
          orderBy: payload.orderBy || 'created_at',
          orderDir: payload.orderDir || 'DESC',
          tagFilter: payload.tagFilter,
        });
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true, rows: result.data.rows, total: result.data.total };
      }
      case 'search': {
        const result = await deps.search(
          payload.query || '',
          clampLimit(payload.limit, 100000, 50),
          payload.offset ?? 0,
          pickDefined({ orderBy: payload.orderBy, orderDir: payload.orderDir }),
        );
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true, rows: result.data.rows, total: result.data.total };
      }
      case 'get_count': {
        const result = await deps.getCount();
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true, count: result.data };
      }
      case 'status': {
        const status = await deps.getStatus();
        if (status) {
          return { success: true, ...status };
        }
        // Unreachable via a real SqliteClient (getStatus() always resolves
        // to an object, even on failure — see its doc comment), but the
        // type keeps `| null` since deps.getStatus is not a DepsResult.
        return { success: false, error: 'Status check failed' };
      }
      case 'opfs_spike': {
        const result = await deps.runOpfsSpike();
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true, report: result.data };
      }
      case 'audit_log_query': {
        const result = await deps.queryAuditLog(
          pickDefined({
            limit: payload.limit === undefined ? undefined : clampLimit(payload.limit, 1000, 1000),
            offset: payload.offset,
          }),
        );
        if (!result.success) {
          return toFailure(result);
        }
        return { success: true, rows: result.data.rows, total: result.data.total };
      }
      default:
        // Defensive: unreachable while the router dispatches only
        // READ_ONLY_SUBTYPES here, but kept so a drifted set entry
        // degrades to a graceful error instead of an undefined response.
        return { success: false, error: `Unknown subtype: ${subtype}` };
    }
  };
}
