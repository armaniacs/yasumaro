/**
 * index.ts
 * uBlockインポートモジュール - メインエントリーポイント
 */
import { readFile } from './fileReader.js';
import { fetchFromUrl } from './urlFetcher.js';
import { isValidUrl } from './validation.js';
import { rebuildRulesFromSources, previewUblockFilter } from './rulesBuilder.js';
import { loadAndDisplaySources, deleteSource, reloadSource, saveUblockSettings } from './sourceManager.js';
import { renderSourceList, updatePreviewUI, hidePreview, clearInput } from './uiRenderer.js';
/**
 * uBlockインポートUIを初期化
 */
export declare function init(): Promise<void>;
/**
 * uBlock設定の保存メインハンドラ
 * UIの状態を確認し、必要に応じて実際の保存処理を呼び出す
 */
declare function handleSaveUblockSettings(): Promise<void>;
/**
 * ドラッグ&ドロップの設定
 */
export declare function setupDragAndDrop(): void;
export { isValidUrl, rebuildRulesFromSources, previewUblockFilter, fetchFromUrl, readFile, renderSourceList, updatePreviewUI, hidePreview, clearInput, loadAndDisplaySources, deleteSource, reloadSource, saveUblockSettings, handleSaveUblockSettings };
//# sourceMappingURL=index.d.ts.map