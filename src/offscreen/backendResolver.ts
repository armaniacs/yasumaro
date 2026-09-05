/**
 * backendResolver.ts
 * Single source of truth for the OPFS > IDB > Fallback > None priority.
 *
 * Both ensureBackend() and getBackend() delegate to resolveBackend() so the
 * priority logic is never duplicated. detectLiveVfsStrategy() from
 * opfsCapabilities is wired in here so the diagnostics panel and the
 * lifecycle share the same capability detection.
 *
 * This module is pure — it owns only the decision, not the side effects
 * (init, worker creation, engine creation).
 */

import type { OpfsCapabilities } from './opfsCapabilities.js';
import { detectLiveVfsStrategy } from './opfsCapabilities.js';
import type { SqliteEngineHost } from './sqliteEngineHost.js';
import type { StorageBackend } from './StorageBackend.js';
import { NoopBackend } from './StorageBackend.js';

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

/**
 * Create the appropriate StorageBackend adapter for the resolved backend type.
 * Uses dynamic imports to avoid loading adapter modules eagerly.
 * Falls back to NoopBackend if the resolved type has no matching adapter.
 */
export async function createBackend(
  context: SqliteEngineHost,
  resolved: BackendType
): Promise<StorageBackend> {
  switch (resolved) {
    case 'opfs': {
      const { OpfsWorkerBackend } = await import('./OpfsWorkerBackend.js');
      return new OpfsWorkerBackend(context);
    }
    case 'idb': {
      // Ensure the IDB engine is initialized — the resolver may have
      // returned 'idb' before the engine was fully set up.
      if (!context.idbEngine) {
        await context.init();
      }
      if (context.idbEngine) {
        const { IdbVfsBackend } = await import('./IdbVfsBackend.js');
        return new IdbVfsBackend(context);
      }
      break;
    }
    case 'fallback': {
      if (context.fallbackStorage) {
        const { FallbackStorageAdapter } = await import('./FallbackStorageAdapter.js');
        return new FallbackStorageAdapter(context.fallbackStorage);
      }
      break;
    }
    case 'none':
      break;
  }

  return new NoopBackend();
}

/**
 * Detect OPFS capabilities using the shared detection from opfsCapabilities.
 * This wires detectLiveVfsStrategy() into the resolver so the diagnostics
 * panel and the lifecycle share the same capability detection.
 */
export function detectOpfsCapabilitiesForResolver(): OpfsCapabilities {
  return detectLiveVfsStrategy().caps;
}
