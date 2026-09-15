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
// Static imports (not dynamic): the Firefox background hosts the engine
// in-page, and nested dynamic imports inside an IIFE library build force
// rolldown into code-splitting, which IIFE rejects. The adapters are small.
import { OpfsWorkerBackend } from './OpfsWorkerBackend.js';
import { IdbVfsBackend } from './IdbVfsBackend.js';
import { FallbackStorageAdapter } from './FallbackStorageAdapter.js';

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
 * Falls back to NoopBackend if the resolved type has no matching adapter.
 */
export async function createBackend(
  context: SqliteEngineHost,
  resolved: BackendType
): Promise<StorageBackend> {
  switch (resolved) {
    case 'opfs':
      return new OpfsWorkerBackend(context);
    case 'idb': {
      // Ensure the IDB engine is initialized — the resolver may have
      // returned 'idb' before the engine was fully set up.
      if (!context.idbEngine) {
        await context.init();
      }
      if (context.idbEngine) {
        return new IdbVfsBackend(context);
      }
      break;
    }
    case 'fallback': {
      if (context.fallbackStorage) {
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
