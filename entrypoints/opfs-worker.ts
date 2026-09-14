import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
// Static import: wires self.onmessage at script evaluation. The background
// sends INIT right after creating this worker, so the wiring must be
// synchronous — a dynamic import would race it.
import '../src/offscreen/opfsWorker.js';

/**
 * opfs-worker.ts — Firefox container for the OPFS worker (PBI 2026-09-14-09).
 *
 * Firefox has no offscreen document, so the background event page creates the
 * storage worker directly: new Worker(chrome.runtime.getURL('opfs-worker.js')).
 * The worker bootstrap lives in src/offscreen/opfsWorker.ts. Built as a
 * standalone bundle, loadable as a module worker. Chromium builds exclude this
 * entrypoint (the offscreen document hosts the same worker there) — a 10MB
 * dead duplicate in dist/chromium-mv3 would blow the bundle-size gate.
 */
export default defineUnlistedScript({
  include: ['firefox'],
  main() {
    // Worker bootstrap is wired by the side-effect import above.
  },
});
