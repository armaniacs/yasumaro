/**
 * opfsCapabilities.ts
 * OPFS feature detection and VFS strategy selection for the SQLite storage layer.
 *
 * Carried forward from the OPFS feasibility spike (PBI-10). Pure, dependency-injected
 * functions so the probing logic is testable in jsdom where the OPFS APIs are absent.
 */

/** Injectable view of the globals we probe for OPFS support. */
export interface OpfsProbeGlobals {
  /** navigator.storage */
  storage?: { getDirectory?: unknown } | undefined;
  /** globalThis.FileSystemFileHandle */
  fileSystemFileHandle?: { prototype?: { createSyncAccessHandle?: unknown } } | undefined;
  /** globalThis.Worker constructor */
  worker?: unknown;
}

export interface OpfsCapabilities {
  /** navigator.storage.getDirectory() is available (OPFS root reachable). */
  opfsDirectory: boolean;
  /** FileSystemFileHandle.prototype.createSyncAccessHandle is available (Worker-only sync API). */
  syncAccessHandle: boolean;
  /** The Worker constructor is available. */
  worker: boolean;
}

/**
 * VFS strategy chosen for the current environment.
 * - `opfs-sync-worker`: 案A — Worker + OPFS SyncAccessHandle (preferred, high performance)
 * - `opfs-async-main`:  案B — main-thread async OPFS (no Worker)
 * - `fallback`:         chrome.storage.local FallbackStorage (OPFS unavailable)
 */
export type VfsStrategy = 'opfs-sync-worker' | 'opfs-async-main' | 'fallback';

/** Probe the given globals and report which OPFS capabilities are present. */
export function detectOpfsCapabilities(env: OpfsProbeGlobals): OpfsCapabilities {
  return {
    opfsDirectory: typeof env.storage?.getDirectory === 'function',
    syncAccessHandle: typeof env.fileSystemFileHandle?.prototype?.createSyncAccessHandle === 'function',
    worker: typeof env.worker === 'function',
  };
}

/** Choose the best available VFS strategy for the detected capabilities. */
export function selectVfsStrategy(caps: OpfsCapabilities): VfsStrategy {
  if (!caps.opfsDirectory) return 'fallback';
  if (caps.syncAccessHandle && caps.worker) return 'opfs-sync-worker';
  return 'opfs-async-main';
}

/** Probe the live runtime globals (navigator.storage, FileSystemFileHandle, Worker). */
function probeLiveEnv(): OpfsProbeGlobals {
  const g = globalThis as typeof globalThis & {
    FileSystemFileHandle?: OpfsProbeGlobals['fileSystemFileHandle'];
    Worker?: unknown;
  };
  return {
    storage: typeof navigator !== 'undefined' ? navigator.storage : undefined,
    fileSystemFileHandle: g.FileSystemFileHandle,
    worker: g.Worker,
  };
}

/** Detect capabilities and strategy for the current runtime in one call. */
export function detectLiveVfsStrategy(): { caps: OpfsCapabilities; strategy: VfsStrategy } {
  const caps = detectOpfsCapabilities(probeLiveEnv());
  return { caps, strategy: selectVfsStrategy(caps) };
}
