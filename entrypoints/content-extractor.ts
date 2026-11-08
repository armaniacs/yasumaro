import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript({
  main() {
    void import('../src/content/extractor.js').then((m) => {
      // Mirrors the previous module-side chrome guard: without a chrome
      // runtime there is nothing to register and nothing to initialise.
      if (typeof globalThis.chrome === 'undefined' || !chrome.runtime?.onMessage) return;
      m.registerGetContentListener();
      // PBI 2026-10-31-03: the selection-capture ask (popup → content script).
      m.registerGetSelectionListener();
      // PBI 2026-11-08-05: init reads settings — a rejection used to vanish
      // silently (listeners armed, clock never started). Surface it so a
      // settings failure is visible instead of a quiet dead extractor.
      void m.init().catch((e: unknown) => {
        try {
          console.warn('[OWeave] content-extractor init failed', e);
        } catch {
          /* logging must never throw */
        }
      });
    });
  },
});
