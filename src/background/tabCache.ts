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

export class TabCache {
    private cache: Map<number, TabData>;
    private isInitialized: boolean;
    private initPromise: Promise<void> | null;

    constructor() {
        this.cache = new Map();
        this.isInitialized = false;
        this.initPromise = null;
    }

    /**
     * キャッシュを初期化
     */
    initialize(): Promise<void> {
        if (this.isInitialized) return Promise.resolve();
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve) => {
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.id && tab.url && tab.url.startsWith('http')) {
                        this.cache.set(tab.id, {
                            title: tab.title,
                            url: tab.url,
                            favIconUrl: tab.favIconUrl,
                            lastUpdated: Date.now(),
                            isValidVisit: false,
                            content: null
                        });
                    }
                });
                this.isInitialized = true;
                resolve();
            });
        });
        return this.initPromise;
    }

    /**
     * 複数のタブを追加
     */
    addTabs(tabs: chrome.tabs.Tab[]): void {
        tabs.forEach(tab => this.add(tab));
    }

    /**
     * タブ情報を追加
     */
    add(tab: chrome.tabs.Tab): void {
        if (tab.id && tab.url && tab.url.startsWith('http')) {
            this.cache.set(tab.id, {
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                lastUpdated: Date.now(),
                isValidVisit: false,
                content: null
            });
        }
    }

    /**
     * タブ情報を取得
     */
    get(tabId: number): TabData | null {
        return this.cache.get(tabId) || null;
    }

    /**
     * タブ情報を更新
     */
    update(tabId: number, data: Partial<TabData>): void {
        const current = this.cache.get(tabId);
        if (current) {
            this.cache.set(tabId, { ...current, ...data });
        }
    }

    /**
     * タブ情報を削除
     */
    remove(tabId: number): void {
        this.cache.delete(tabId);
    }

    /**
     * 複数のタブを削除
     */
    removeAll(tabIds: number[]): void {
        tabIds.forEach(tabId => this.remove(tabId));
    }

    /**
     * 全キャッシュをクリア
     */
    clear(): void {
        this.cache.clear();
        this.isInitialized = false;
        this.initPromise = null;
    }

    /**
     * キャッシュサイズを取得
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * 全てのタブ情報を取得
     */
    getAll(): Iterator<TabData> {
        return this.cache.values();
    }

    /**
     * キャッシュが初期化済みかどうか
     */
    isInitializedCache(): boolean {
        return this.isInitialized;
    }
}