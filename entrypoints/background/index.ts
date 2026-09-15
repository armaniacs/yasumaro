import { defineBackground } from 'wxt/utils/define-background';

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
    void import('../../src/background/service-worker.js').then(({ init }) => {
      init();
    });
  },
});