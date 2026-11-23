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
      // Review S6 — half-init policy (fail-closed, no auto-retry): init()
      // either fully arms the visit pipeline (deadline timer, scroll/SPA
      // seams) or rejects with none of it armed, so a failed init leaves
      // only the message listeners (GET_CONTENT/GET_SELECTION answers still
      // work) while visit gating stays silent instead of running on
      // unloaded thresholds. The MAIN-world SPA poll starts only on success
      // for the same reason. Recovery is a page reload (which re-runs this
      // entrypoint); no in-page retry loop is attempted.
      void m.init().then(() => {
        try {
          m.startSpaUrlPolling();
        } catch {
          /* MAIN-world poll is best-effort — the isolated seams still stand */
        }
      }).catch((e: unknown) => {
        try {
          console.warn('[OWeave] content-extractor init failed', e);
        } catch {
          /* logging must never throw */
        }
      });
    });
  },
});
