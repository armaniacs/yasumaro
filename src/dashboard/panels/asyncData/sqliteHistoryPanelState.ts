/**
 * sqliteHistoryPanelState.ts
 * Re-export shim — canonical definitions now live in sqliteHistoryModel.ts
 * (PBI-17 HistoryModel shrink integration). Kept for backwards compatibility
 * so existing imports from `.../sqliteHistoryPanelState.js` keep working.
 */

export type {
  SqliteHistoryState,
  SqliteHistoryAction,
} from './sqliteHistoryModel.js';
export {
  createInitialHistoryState,
  historyStateReducer,
} from './sqliteHistoryModel.js';
