/**
 * opfsCapabilities.ts
 * Live OPFS detection for the offscreen document.
 *
 * The decision itself is pure and lives in src/utils/vfsCapabilities.ts, which
 * the dashboard also imports; only the ambient-globals read stays here because
 * the offscreen document is the context the backend resolver asks.
 */

import { detectOpfsCapabilities, probeOpfsGlobals, selectVfsStrategy } from '../utils/vfsCapabilities.js';
import type { OpfsCapabilities, OpfsProbeGlobals, VfsStrategy } from '../utils/vfsCapabilities.js';

// Re-exported so the offscreen consumers of the pure core keep importing it from
// here; the public surface of this module is unchanged by the move.
export { detectOpfsCapabilities, selectVfsStrategy };
export type { OpfsCapabilities, OpfsProbeGlobals, VfsStrategy };

/** Probe the live runtime globals (navigator.storage, FileSystemFileHandle, Worker). */
function probeLiveEnv(): OpfsProbeGlobals {
  return probeOpfsGlobals(globalThis);
}

/** Detect capabilities and strategy for the current runtime in one call. */
export function detectLiveVfsStrategy(): { caps: OpfsCapabilities; strategy: VfsStrategy } {
  const caps = detectOpfsCapabilities(probeLiveEnv());
  return { caps, strategy: selectVfsStrategy(caps) };
}
