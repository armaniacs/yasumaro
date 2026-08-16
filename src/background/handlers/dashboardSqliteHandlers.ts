/**
 * Thin re-export. The implementation lives in ./dashboardSqlite/ — split into
 * a router plus three sub-handlers grouped by concern (read-only / core CRUD /
 * maintenance batch). This file exists only so existing import paths
 * (service-worker.ts, __tests__/*) keep working unchanged.
 */
export {
  createDashboardSqliteHandler,
  type DashboardSqliteHandlerDeps,
  type SqliteClientBackedDeps,
  createSqliteClientDeps,
} from './dashboardSqlite/index.js';
