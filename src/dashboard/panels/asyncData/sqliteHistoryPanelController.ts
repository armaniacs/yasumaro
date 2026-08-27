/**
 * sqliteHistoryPanelController.ts
 * Backwards-compatibility shim — canonical implementation is now
 * sqliteHistoryModel.ts (PBI-17). New code should import
 * `createSqliteHistoryModel` from `sqliteHistoryModel.js`.
 */

import {
  createSqliteHistoryModel,
  persistSort,
  type FetchDataOptions,
  type SqliteHistoryModelDeps,
  type SqliteHistoryModel,
  type AppendResult,
} from './sqliteHistoryModel.js';
import type { SqliteHistoryState } from './sqliteHistoryModel.js';

export type { FetchDataOptions, AppendResult };
export type SqliteHistoryControllerDeps = SqliteHistoryModelDeps & { onStateChange: () => void };
export type SqliteHistoryController = SqliteHistoryModel & {
  /** @deprecated Use model.subscribe() instead */
  onStateChange?: () => void;
};

export function createSqliteHistoryController(deps: SqliteHistoryControllerDeps): SqliteHistoryController {
  return createSqliteHistoryModel(deps) as SqliteHistoryController;
}

export { persistSort };
