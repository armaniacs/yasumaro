/**
 * TabCache
 * Service Workerにおけるタブ情報のキャッシュ管理
 */
export class TabCache {
    cache;
    isInitialized;
    initPromise;
    constructor() {
        this.cache = new Map();
        this.isInitialized = false;
        this.initPromise = null;
    }
    /**
     * キャッシュを初期化
     */
    initialize() {
        if (this.isInitialized)
            return Promise.resolve();
        if (this.initPromise)
            return this.initPromise;
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
    addTabs(tabs) {
        tabs.forEach(tab => this.add(tab));
    }
    /**
     * タブ情報を追加
     */
    add(tab) {
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
    get(tabId) {
        return this.cache.get(tabId) || null;
    }
    /**
     * タブ情報を更新
     */
    update(tabId, data) {
        const current = this.cache.get(tabId);
        if (current) {
            this.cache.set(tabId, { ...current, ...data });
        }
    }
    /**
     * タブ情報を削除
     */
    remove(tabId) {
        this.cache.delete(tabId);
    }
    /**
     * 複数のタブを削除
     */
    removeAll(tabIds) {
        tabIds.forEach(tabId => this.remove(tabId));
    }
    /**
     * 全キャッシュをクリア
     */
    clear() {
        this.cache.clear();
        this.isInitialized = false;
        this.initPromise = null;
    }
    /**
     * キャッシュサイズを取得
     */
    size() {
        return this.cache.size;
    }
    /**
     * 全てのタブ情報を取得
     */
    getAll() {
        return this.cache.values();
    }
    /**
     * キャッシュが初期化済みかどうか
     */
    isInitializedCache() {
        return this.isInitialized;
    }
}
//# sourceMappingURL=tabCache.js.map