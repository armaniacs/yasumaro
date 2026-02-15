/**
 * sourceManager.ts
 * uBlockインポートモジュール - ソース管理機能
 */
interface Source {
    url: string;
    importedAt: number;
    ruleCount: number;
    blockDomains: string[];
    exceptionDomains: string[];
}
interface ReloadResult {
    sources: Source[];
    ruleCount: number;
}
interface SaveResult {
    sources: Source[];
    action: string;
    ruleCount: number;
}
/**
 * 保存済みソース一覧を読み込んで表示
 */
export declare function loadAndDisplaySources(renderCallback?: (sources: Source[]) => void): Promise<void>;
/**
 * ソースを削除
 * @param {number} index - 削除するソースのインデックス
 */
export declare function deleteSource(index: number, renderCallback?: (sources: Source[]) => void): Promise<void>;
/**
 * ソースを再読み込み
 * @param {number} index - 再読み込みするソースのインデックス
 * @param {Function} fetchFromUrlCallback - URL読み込みコールバック
 * @returns {Promise<Object>} 更新結果
 */
export declare function reloadSource(index: number, fetchFromUrlCallback: (url: string) => Promise<string>): Promise<ReloadResult>;
/**
 * uBlock設定の保存（軽量化版）
 * @param {string} text - 保存するフィルターテキスト
 * @param {string|null} url - ソースURL（手動入力の場合はnull）
 */
export declare function saveUblockSettings(text: string, url?: string | null): Promise<SaveResult>;
export {};
//# sourceMappingURL=sourceManager.d.ts.map