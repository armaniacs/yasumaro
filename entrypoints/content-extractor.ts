import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript({
  main() {
    void import('../src/content/extractor.js').then((m) => {
      // Mirrors the previous module-side chrome guard: without a chrome
      // runtime there is nothing to register and nothing to initialise.
      if (typeof globalThis.chrome === 'undefined' || !chrome.runtime?.onMessage) return;
      m.registerGetContentListener();
      void m.init();
    });
  },
});
