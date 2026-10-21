import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Content script - loader that runs on page load
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    void startContentLoader(() => import('../../src/content/loader.js'));
  },
});

/**
 * Load the content loader module and report a failure instead of leaving it
 * as a silent unhandled rejection. The dynamic import is the only path into
 * the content bundle — the 2026-04-15 web_accessible_resources regression
 * rejected exactly here ("Failed to fetch dynamically imported module") and
 * stayed invisible. Until the loader chunk resolves, nothing in the page can
 * reach the structured logger (it lives in that same chunk), so console.error
 * is the deliberate sink (flushScheduler precedent).
 *
 * The loader is injectable so tests never exercise the real import.
 */
export async function startContentLoader(loader: () => Promise<unknown>): Promise<void> {
  try {
    await loader();
  } catch (error: unknown) {
    console.error('[Yasumaro] Failed to load the content loader module', error);
  }
}
