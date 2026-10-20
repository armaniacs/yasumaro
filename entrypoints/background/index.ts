import { defineBackground } from 'wxt/utils/define-background';
import { logError } from '../../src/utils/logger/api.js';
import { ErrorCode } from '../../src/utils/logger/types.js';
import { errorMessage } from '../../src/utils/errorUtils.js';

/**
 * Background service worker entry point
 */
export default defineBackground({
  manifest: {
    persistent: false,
  },
  main() {
    // Firefox requires the background main() to be synchronous (the event
    // page warns "must be synchronous" for an async main), so the service
    // worker module load is fire-and-forget instead of awaited.
    void import('../../src/background/service-worker.js')
      .then(({ init }) => {
        init();
      })
      .catch((error: unknown) => {
        void logError('[yasumaro] background service-worker load failed', { error: errorMessage(error) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
      });
  },
});