import { defineBackground } from 'wxt/utils/define-background';

/**
 * Background service worker entry point
 */
export default defineBackground({
  manifest: {
    persistent: false,
  },
  main() {
    // Import the service worker logic
    import('../../src/background/service-worker.js');
  },
});