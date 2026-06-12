import { SqliteClient } from '../sqliteClient.js';
import { logError, ErrorCode } from '../../utils/logger.js';

const ALLOWED_UPDATE_FIELDS = ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted', 'obsidian_synced'];

export async function handleDashboardSqlite(
    payload: Record<string, unknown>,
    sqliteClient: SqliteClient
): Promise<unknown> {
    const subtype = payload.subtype as string;

    try {
        switch (subtype) {
            case 'query': {
                const result = await sqliteClient.query({
                    limit: (payload.limit as number) ?? 100,
                    offset: (payload.offset as number) ?? 0,
                    domain: payload.domain as string | undefined,
                    isStarred: payload.isStarred as boolean | undefined,
                    since: payload.since as number | undefined,
                    until: payload.until as number | undefined,
                    orderBy: (payload.orderBy as string) || 'created_at',
                    orderDir: (payload.orderDir as 'ASC' | 'DESC') || 'DESC',
                });
                return result ?? { success: false, error: 'Query failed' };
            }
            case 'search': {
                const result = await sqliteClient.search(
                    payload.query as string || '',
                    (payload.limit as number) ?? 50,
                    (payload.offset as number) ?? 0
                );
                return result ?? { success: false, error: 'Search failed' };
            }
            case 'toggle_star': {
                const result = await sqliteClient.toggleStar(payload.id as number);
                return result ?? { success: false, error: 'Toggle star failed' };
            }
            case 'delete': {
                const result = await sqliteClient.delete(payload.id as number);
                return { success: result };
            }
            case 'update': {
                const changes = (payload.changes || {}) as Record<string, unknown>;
                const invalidKeys = Object.keys(changes).filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
                if (invalidKeys.length > 0) {
                    return { success: false, error: `Invalid update fields: ${invalidKeys.join(', ')}` };
                }
                const result = await sqliteClient.update(
                    payload.id as number,
                    changes
                );
                return { success: result };
            }
            case 'get_count': {
                const count = await sqliteClient.getCount();
                return { success: true, count: count ?? 0 };
            }
            case 'clear_all': {
                const ok = await sqliteClient.clearAll();
                return { success: ok };
            }
            case 'status': {
                const status = await sqliteClient.getStatus();
                if (status) {
                    return { success: true, ...status };
                } else {
                    return { success: false, error: 'Status check failed' };
                }
            }
            default:
                return { success: false, error: `Unknown subtype: ${subtype}` };
        }
    } catch (error) {
        logError('Dashboard SQLite error', {
            subtype,
            error: error instanceof Error ? error.message : String(error),
        }, ErrorCode.UNKNOWN_ERROR);
        return { success: false, error: String(error) };
    }
}
