import { SessionStore, SESSION_KEYS } from './sessionStore.js';

export interface TabData {
    title?: string;
    url: string;
    favIconUrl?: string;
    lastUpdated: number;
    isValidVisit: boolean;
    content: string | null;
    [key: string]: unknown;
}

export class TabCache {
    private cache: Map<number, TabData>;
    private isInitialized: boolean;
    private initPromise: Promise<void> | null;
    private sessionStore: SessionStore;

    constructor(sessionStore?: SessionStore) {
        this.cache = new Map();
        this.isInitialized = false;
        this.initPromise = null;
        this.sessionStore = sessionStore ?? new SessionStore();
    }

    /**
     * キャッシュを初期化
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;
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
        await this.initPromise;
        await this.loadFromSession();
    }

    /**
     * Session storage から以前のキャッシュエントリを復元
     */
    private async loadFromSession(): Promise<void> {
        const entries = await this.sessionStore.get<[number, TabData][]>(SESSION_KEYS.TAB_CACHE);
        if (entries) {
            for (const [tabId, data] of entries) {
                if (!this.cache.has(tabId)) {
                    this.cache.set(tabId, data);
                }
            }
        }
    }

    /**
     * キャッシュを session storage に保存
     */
    private saveToSession(): void {
        this.sessionStore.set(SESSION_KEYS.TAB_CACHE, SessionStore.mapToEntries(this.cache));
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
            this.saveToSession();
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
            this.saveToSession();
        }
    }

    /**
     * タブ情報を削除
     */
    remove(tabId: number): void {
        this.cache.delete(tabId);
        this.saveToSession();
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
        this.sessionStore.remove(SESSION_KEYS.TAB_CACHE);
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
