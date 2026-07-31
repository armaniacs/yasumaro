import { defineBackground } from 'wxt/utils/define-background';

/**
 * Background service worker entry point
 */
export default defineBackground({
  manifest: {
    persistent: false,
  },
  async main() {
    const { init } = await import('../../src/background/service-worker.js');
    init();
  },
});