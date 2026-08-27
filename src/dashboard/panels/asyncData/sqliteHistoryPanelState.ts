/**
 * sqliteHistoryPanelState.ts
 * Re-export shim — canonical definitions now live in sqliteHistoryModel.ts
 * (PBI-17 HistoryModel shrink integration). Kept for backwards compatibility
 * so existing imports from `.../sqliteHistoryPanelState.js` keep working.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-export shim for backwards compatibility
export type {
  SqliteHistoryState,
  SqliteHistoryAction,
} from './sqliteHistoryModel.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-export shim
export {
  createInitialHistoryState,
  historyStateReducer,
} from './sqliteHistoryModel.js';
