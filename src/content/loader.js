/**
 * loader.js
 * Content script loader for ESM.
 * Dynamically imports the extractor module to support ESM features.
 */
(async () => {
    const src = chrome.runtime.getURL('src/content/extractor.js');
    await import(src);
})();
