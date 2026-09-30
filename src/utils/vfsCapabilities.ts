// @layer 0 — Foundation: OPFS capability detection and VFS strategy selection
/**
 * vfsCapabilities.ts
 * Pure core of the OPFS probe. It takes the globals to inspect as an argument,
 * so every context (offscreen document, dashboard page, jsdom tests) decides
 * for itself which scope to read; only `probeOpfsGlobals` knows about an
 * ambient scope object.
 *
 * Lives in utils rather than offscreen because the dashboard needs the same
 * decision to report its own divergence, and a dashboard → offscreen runtime
 * import is an unchecked edge (dev-docs/LAYERS.md).
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
 * - `idb`:              OPFS 利用不可環境の実行時選択（IDB VFS。resolver が権威）
 * - `fallback`:         chrome.storage.local FallbackStorage (OPFS unavailable)
 */
export type VfsStrategy = 'opfs-sync-worker' | 'idb' | 'fallback';

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
  // OPFS ディレクトリはあるが sync handle / Worker が無い環境 — resolver は
  // ここで IDB へ転落させるため、実行時に選ばれるのは IDB VFS（案B は未実装）。
  return 'idb';
}

/** The ambient globals the probe reads, as the host lib types them. */
interface AmbientOpfsGlobals {
  navigator?: { storage?: OpfsProbeGlobals['storage'] } | undefined;
  FileSystemFileHandle?: OpfsProbeGlobals['fileSystemFileHandle'];
  Worker?: unknown;
}

/**
 * Read the probe inputs out of an ambient global scope (globalThis in a browser
 * context). Typed as unknown because the host lib declares these constructors
 * with its own shapes; the cast narrows to the fields the probe reads and
 * nothing else is claimed.
 */
export function probeOpfsGlobals(scope: unknown): OpfsProbeGlobals {
  const g = scope as AmbientOpfsGlobals;
  return {
    storage: g.navigator?.storage,
    fileSystemFileHandle: g.FileSystemFileHandle,
    worker: g.Worker,
  };
}
