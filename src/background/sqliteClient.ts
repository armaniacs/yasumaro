/**
 * sqliteClient.ts
 * @deprecated — retained for backward compat (PBI 07). New code should import
 * from `src/background/sqlite/offscreenGateway.js` (Service Worker → Offscreen hop)
 * or `src/background/sqlite/dashboardGateway.js` (Dashboard hop).
 *
 * This shim re-exports the deep module's SqliteClient so existing imports
 * keep working while new code migrates to the split gateways.
 */

export { SqliteClient, getSharedSqliteClient } from './sqlite/offscreenGateway.js';
export type { CallResult } from './sqlite/offscreenGateway.js';
export { categorizeError } from '../messaging/sqliteRpcClient.js';
export type { SqliteError } from '../messaging/sqliteRpcClient.js';
export type { SqliteResult } from './sqlite/offscreenGateway.js';
export { SqliteGateway } from './sqlite/offscreenGateway.js';
export type { SqliteGateway as SqliteGatewayType } from './sqlite/offscreenGateway.js';
