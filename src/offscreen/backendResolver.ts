/**
 * backendResolver.ts
 * Single source of truth for the OPFS > IDB > Fallback > None priority.
 *
 * Both ensureBackend() and getBackend() delegate to resolveBackend() so the
 * priority logic is never duplicated.
 *
 * PBI-05: this module is now purely the decision table — the backend adapter
 * construction (and the IDB rung's init precondition, which is init-order
 * knowledge) moved into SqliteEngineHost, so the init/degrade order lives in
 * one place.
 */

/** Backend type tag returned by resolveBackend. */
export type BackendType = 'opfs' | 'idb' | 'fallback' | 'none';

interface PostInitState {
  opfsWorker: boolean;
  idbEngine: boolean;
  usingFallbackStorage: boolean;
  fallbackStorage: boolean;
}

/**
 * Pure decision function: given the post-init state, determine which backend
 * to use. Priority: OPFS > IDB > Fallback > None.
 */
export function resolveBackend(state: PostInitState): BackendType {
  if (state.opfsWorker) return 'opfs';
  if (state.idbEngine) return 'idb';
  if (state.usingFallbackStorage && state.fallbackStorage) return 'fallback';
  return 'none';
}
