/**
 * TabCache
 * Service Workerにおけるタブ情報のキャッシュ管理
 */
export interface TabData {
    title?: string;
    url: string;
    favIconUrl?: string;
    lastUpdated: number;
    isValidVisit: boolean;
    content: string | null;
    [key: string]: any;
}
export declare class TabCache {
    private cache;
    private isInitialized;
    private initPromise;
    constructor();
    /**
     * キャッシュを初期化
     */
    initialize(): Promise<void>;
    /**
     * 複数のタブを追加
     */
    addTabs(tabs: chrome.tabs.Tab[]): void;
    /**
     * タブ情報を追加
     */
    add(tab: chrome.tabs.Tab): void;
    /**
     * タブ情報を取得
     */
    get(tabId: number): TabData | null;
    /**
     * タブ情報を更新
     */
    update(tabId: number, data: Partial<TabData>): void;
    /**
     * タブ情報を削除
     */
    remove(tabId: number): void;
    /**
     * 複数のタブを削除
     */
    removeAll(tabIds: number[]): void;
    /**
     * 全キャッシュをクリア
     */
    clear(): void;
    /**
     * キャッシュサイズを取得
     */
    size(): number;
    /**
     * 全てのタブ情報を取得
     */
    getAll(): Iterator<TabData>;
    /**
     * キャッシュが初期化済みかどうか
     */
    isInitializedCache(): boolean;
}
//# sourceMappingURL=tabCache.d.ts.map