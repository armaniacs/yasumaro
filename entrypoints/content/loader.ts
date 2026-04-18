import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Content script - loader that runs on page load
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    import('../../src/content/loader.js');
  },
});