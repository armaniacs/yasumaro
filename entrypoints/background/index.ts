import { defineBackground } from 'wxt/utils/define-background';

/**
 * Background service worker entry point
 */
export default defineBackground(() => {
  console.log('[Background Entrypoint] Initializing...');
  // Import the service worker logic
  import('../../src/background/service-worker');
});