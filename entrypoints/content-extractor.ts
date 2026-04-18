import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript({
  main() {
    import('../src/content/extractor.js');
  },
});