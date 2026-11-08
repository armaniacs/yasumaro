import { defineBackground } from 'wxt/utils/define-background';
import { logError } from '../../src/utils/logger/api.js';
import { ErrorCode } from '../../src/utils/logger/types.js';
import { errorMessage } from '../../src/utils/errorUtils.js';
import type { StartupPhaseResult } from '../../src/background/service-worker.js';

/**
 * Background service worker entry point
 */

// Observable startup handle (PBI 2026-11-08-13): main() stays synchronous
// (Firefox requires it), but the load promise is retained so completion and
// phase order are observable instead of fire-and-forget. Resolves with the
// service-worker startup phase results, or [] when the module failed to load
// (that path keeps its existing logError).
let backgroundStartup: Promise<readonly StartupPhaseResult[]> | null = null;

/** Returns the in-flight (or settled) background startup promise, if main() ran. */
export function getBackgroundStartup(): Promise<readonly StartupPhaseResult[]> | null {
  return backgroundStartup;
}

export default defineBackground({
  manifest: {
    persistent: false,
  },
  main() {
    // Firefox requires the background main() to be synchronous (the event
    // page warns "must be synchronous" for an async main), so the service
    // worker module load is fire-and-forget instead of awaited.
    backgroundStartup = import('../../src/background/service-worker.js')
      .then(({ init }) => init())
      .catch((error: unknown) => {
        void logError('[yasumaro] background service-worker load failed', { error: errorMessage(error) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
        return [];
      });
  },
});
