/**
 * opfsWorkerFactory.ts — Chromium-only worker construction.
 *
 * Contains the ONLY `new Worker(new URL(...))` literal for the OPFS worker.
 * This module is loaded exclusively by the offscreen document (Chromium):
 * the vite:worker-import-meta-url plugin bundles `../opfsWorker.js` as a
 * worker asset here. The Firefox background injects its own factory
 * (chrome.runtime.getURL-based, see PBI 2026-09-14-09) via
 * setOpfsWorkerFactory — importing this module from the background bundle
 * would break the service worker build.
 */
export function createOpfsWorkerFromBundle(): Worker {
  return new Worker(
    new URL('../opfsWorker.js', import.meta.url),
    { type: 'module' }
  );
}
