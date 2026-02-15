/**
 * loader.js
 * Content script loader for ESM.
 * Dynamically imports the extractor module to support ESM features.
 */
// このファイルはContent Scriptとして動作するため、export/importを含めない
// TypeScriptの`isolatedModules`設定により空のexportが追加されるのを防ぐため、
// グローバルスコープで実行する即時実行関数として実装
(async () => {
    // ビルド後のパスを指定（distディレクトリ内）
    const src = chrome.runtime.getURL('content/extractor.js');
    await import(src);
})();

//# sourceMappingURL=loader.js.map