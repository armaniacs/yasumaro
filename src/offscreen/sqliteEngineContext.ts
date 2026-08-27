/**
 * sqliteEngineContext.ts — thin alias to SqliteEngineHost (PBI-14)
 * Backward compatibility: existing imports `from './sqliteEngineContext.js'`
 * continue to work. The canonical implementation lives in sqliteEngineHost.ts
 * with private #state encapsulation; this file re-exports it as
 * SqliteEngineContext.
 */

export { SqliteEngineHost, engine, DB_FILENAME, MAX_QUERY_LIMIT, extractDomain } from './sqliteEngineHost.js';
export type { SqliteValue } from './sqliteEngineHost.js';

// Alias for backward compatibility — value and type share the name
import { SqliteEngineHost } from './sqliteEngineHost.js';
export const SqliteEngineContext = SqliteEngineHost;
export type SqliteEngineContext = SqliteEngineHost;
