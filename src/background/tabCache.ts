import { SessionStore, SESSION_KEYS } from './sessionStore.js';
import { pickDefined } from '../utils/objectUtils.js';

export interface TabData {
    title?: string;
    url: string;
    favIconUrl?: string;
    lastUpdated: number;
    isValidVisit: boolean;
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

        this.initPromise = new Promise<void>((resolve, reject) => {
            chrome.tabs.query({}, (tabs) => {
                // PBI 2026-09-12-08: check lastError and settle the promise on
                // failure — an unchecked query error left initPromise pending
                // forever and hung every message awaiting initialize().
                const error = chrome.runtime?.lastError;
                if (error) {
                    reject(new Error(error.message || 'chrome.tabs.query failed'));
                    return;
                }
                tabs.forEach(tab => {
                    if (tab.id && tab.url && tab.url.startsWith('http')) {
                        this.cache.set(tab.id, {
                            url: tab.url,
                            lastUpdated: Date.now(),
                            isValidVisit: false,
                            ...pickDefined({ title: tab.title, favIconUrl: tab.favIconUrl }),
                        });
                    }
                });
                this.isInitialized = true;
                resolve();
            });
        });
        try {
            await this.initPromise;
        } catch (error) {
            // A failed probe must not poison later initialize() calls: reset
            // so the next message retries instead of reusing the rejected
            // promise forever.
            this.initPromise = null;
            throw error;
        }
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
     * PBI 2026-09-12-24: `remove` は SW suspend に消え得るため即時 flush
     * （rateLimiter の flushImmediately 紀律と同一）。hot path の add/update
     * は debounced のまま。
     */
    private saveToSession(immediate = false): void {
        this.sessionStore.set(SESSION_KEYS.TAB_CACHE, SessionStore.mapToEntries(this.cache), immediate ? { flushImmediately: true } : undefined);
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
                url: tab.url,
                lastUpdated: Date.now(),
                isValidVisit: false,
                ...pickDefined({ title: tab.title, favIconUrl: tab.favIconUrl }),
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
        this.saveToSession(true);
    }

    /**
     * タブ情報を削除し、session への即時 flush を await する（PBI
     * 2026-09-12-24）。SW suspend 窓で削除が消えないよう、remove を
     * 待ち合わせたい呼び出し側（handleTabRemoved）向け。
     */
    async removeAndFlush(tabId: number): Promise<void> {
        this.cache.delete(tabId);
        await this.sessionStore.set(SESSION_KEYS.TAB_CACHE, SessionStore.mapToEntries(this.cache), { flushImmediately: true });
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
