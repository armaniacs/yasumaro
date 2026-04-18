import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Content script - extractor for content extraction
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    import('../../src/content/extractor.js');
  },
});