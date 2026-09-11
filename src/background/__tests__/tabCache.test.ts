/**
 * TabCache_TEST.js
 * TabCacheクラスの単体テスト
 */

import { TabCache } from '../tabCache.js';
import type { TabData } from '../tabCache.js';

// getAll() is declared as Iterator<TabData> (no Symbol.iterator in its type);
// at runtime it is a Map values iterator, so wrap it as an Iterable for Array.from.
const collectAll = (cache: TabCache): TabData[] =>
    Array.from(cache.getAll() as unknown as Iterable<TabData>);

// The suite exercises add()/initialize() with intentionally partial tab shapes
// (missing id, non-http url, ...) to assert filtering behaviour.
type PartialTab = Partial<Record<keyof chrome.tabs.Tab, unknown>> & Record<string, unknown>;
const asTab = (tab: PartialTab): chrome.tabs.Tab => tab as unknown as chrome.tabs.Tab;
const asTabs = (tabs: PartialTab[]): chrome.tabs.Tab[] =>
    tabs as unknown as chrome.tabs.Tab[];

type QueryCallback = (result: chrome.tabs.Tab[]) => void;
function stubChromeTabsQuery(impl: (query: chrome.tabs.QueryInfo, cb: QueryCallback) => void): void {
    (global as { chrome?: typeof chrome }).chrome = {
        tabs: { query: impl },
    } as unknown as typeof chrome;
}
function clearChromeStub(): void {
    delete (global as { chrome?: typeof chrome }).chrome;
}

describe('TabCache', () => {
    let tabCache: TabCache;

    beforeEach(() => {
        tabCache = new TabCache();
    });

    afterEach(() => {
        tabCache.clear();
    });

    describe('初期化', () => {
        it('reports false as the initial state', () => {
            expect(tabCache.isInitializedCache()).toBe(false);
        });

        it('returns the initialization state via the isInitialized method', () => {
            expect(tabCache.isInitializedCache()).toBe(false);
        });

        it('loads the tab list into the cache via initialize()', async () => {
          // Mock chrome.tabs.query to return some tabs (callback-style API)
          const mockTabs = asTabs([
            { id: 1, title: 'Tab 1', url: 'https://example.com/1', favIconUrl: null },
            { id: 2, title: 'Tab 2', url: 'http://test.com', favIconUrl: null },
            { id: 3, title: 'Invalid', url: 'chrome://extensions', favIconUrl: null }
          ]);
          const queryImpl = (_query: chrome.tabs.QueryInfo, callback?: QueryCallback): void => {
            callback?.(mockTabs);
          };
          vi.mocked(chrome.tabs.query).mockImplementation(
            queryImpl as unknown as typeof chrome.tabs.query,
          );

          await tabCache.initialize();

          expect(chrome.tabs.query).toHaveBeenCalledWith({}, expect.any(Function));
          // Only HTTP/HTTPS tabs with id and url should be cached
          expect(tabCache.size()).toBe(2);
          expect(tabCache.get(1)).toEqual({
            title: 'Tab 1',
            url: 'https://example.com/1',
            favIconUrl: null,
            lastUpdated: expect.any(Number),
            isValidVisit: false
          });
        });
      });

    describe('タブ情報の追加', () => {
        it('adds a tab with a valid http URL', () => {
            const tab = {
                id: 1,
                title: 'Test Page',
                url: 'https://example.com',
                favIconUrl: 'https://example.com/favicon.ico'
            };
            tabCache.add(asTab(tab));
            expect(tabCache.size()).toBe(1);
        });

        it('adds a tab with a valid https URL', () => {
            const tab = {
                id: 2,
                title: 'Test Page',
                url: 'http://example.com',
                favIconUrl: 'http://example.com/favicon.ico'
            };
            tabCache.add(asTab(tab));
            expect(tabCache.size()).toBe(1);
        });

        it('does not add a tab with a non-http URL', () => {
            const tab = {
                id: 3,
                title: 'Chrome Extensions',
                url: 'chrome://extensions/',
                favIconUrl: null
            };
            tabCache.add(asTab(tab));
            expect(tabCache.size()).toBe(0);
        });

        it('does not add a tab without a tab ID', () => {
            const tab = {
                url: 'https://example.com',
                title: 'Test Page'
            };
            tabCache.add(asTab(tab));
            expect(tabCache.size()).toBe(0);
        });

        it('does not add a tab without a URL', () => {
            const tab = {
                id: 1,
                title: 'Test Page'
            };
            tabCache.add(asTab(tab));
            expect(tabCache.size()).toBe(0);
        });

        it('adds multiple tabs at once', () => {
            const tabs = [
                { id: 1, title: 'Page 1', url: 'https://example.com/page1' },
                { id: 2, title: 'Page 2', url: 'https://example.com/page2' },
                { id: 3, title: 'Page 3', url: 'https://example.com/page3' }
            ];
            tabCache.addTabs(asTabs(tabs));
            expect(tabCache.size()).toBe(3);
        });
    });

    describe('タブ情報の取得', () => {
        it('retrieves info for an existing tab ID', () => {
            const tab = {
                id: 1,
                title: 'Test Page',
                url: 'https://example.com',
                favIconUrl: 'https://example.com/favicon.ico'
            };
            tabCache.add(asTab(tab));
            const retrieved = tabCache.get(1);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.title).toBe('Test Page');
            expect(retrieved!.url).toBe('https://example.com');
            expect(retrieved!.favIconUrl).toBe('https://example.com/favicon.ico');
        });

        it('returns null for an unknown tab ID', () => {
            const retrieved = tabCache.get(999);
            expect(retrieved).toBeNull();
        });
    });

    describe('タブ情報の更新', () => {
        it('updates info for an existing tab', () => {
            const tab = {
                id: 1,
                title: 'Old Title',
                url: 'https://example.com',
                favIconUrl: null
            };
            tabCache.add(asTab(tab));
            tabCache.update(1, { title: 'New Title', isValidVisit: true });
            const retrieved = tabCache.get(1);
            expect(retrieved!.title).toBe('New Title');
            expect(retrieved!.isValidVisit).toBe(true);
            expect(retrieved!.url).toBe('https://example.com');
        });

        it('does not throw when updating an unknown tab ID', () => {
            expect(() => {
                tabCache.update(999, { title: 'New Title' });
            }).not.toThrow();
        });
    });

    describe('タブ情報の削除', () => {
        it('removes an existing tab ID', () => {
            const tab = {
                id: 1,
                title: 'Test Page',
                url: 'https://example.com'
            };
            tabCache.add(asTab(tab));
            expect(tabCache.size()).toBe(1);
            tabCache.remove(1);
            expect(tabCache.size()).toBe(0);
            expect(tabCache.get(1)).toBeNull();
        });

        it('does not throw when removing an unknown tab ID', () => {
            expect(() => {
                tabCache.remove(999);
            }).not.toThrow();
        });

        it('removes multiple tabs at once', () => {
            tabCache.add(asTab({ id: 1, title: 'Page 1', url: 'https://example.com/page1' }));
            tabCache.add(asTab({ id: 2, title: 'Page 2', url: 'https://example.com/page2' }));
            tabCache.add(asTab({ id: 3, title: 'Page 3', url: 'https://example.com/page3' }));
            expect(tabCache.size()).toBe(3);
            tabCache.removeAll([1, 3]);
            expect(tabCache.size()).toBe(1);
            expect(tabCache.get(2)).not.toBeNull();
        });
    });

    describe('キャッシュクリア', () => {
        it('clears the entire cache', () => {
            tabCache.add(asTab({ id: 1, title: 'Page 1', url: 'https://example.com/page1' }));
            tabCache.add(asTab({ id: 2, title: 'Page 2', url: 'https://example.com/page2' }));
            expect(tabCache.size()).toBe(2);
            tabCache.clear();
            expect(tabCache.size()).toBe(0);
            expect(tabCache.isInitializedCache()).toBe(false);
        });
    });

    describe('全タブ情報の取得', () => {
        it('returns all tab info as an iterator', () => {
            tabCache.add(asTab({ id: 1, title: 'Page 1', url: 'https://example.com/page1' }));
            tabCache.add(asTab({ id: 2, title: 'Page 2', url: 'https://example.com/page2' }));
            const all = collectAll(tabCache);
            expect(all).toHaveLength(2);
            expect(all[0]!.title).toBe('Page 1');
            expect(all[1]!.title).toBe('Page 2');
        });

        it('does not throw when reading from an empty cache', () => {
            expect(() => {
                const all = collectAll(tabCache);
                expect(all).toHaveLength(0);
            }).not.toThrow();
        });
    });

    describe('初期化Promise', () => {
        it('sets the initialized flag to true when initialize is called', async () => {
            // chrome.tabs.queryをモック
            stubChromeTabsQuery((_query, callback) => {
                callback(asTabs([
                    { id: 1, title: 'Page 1', url: 'https://example.com/page1' }
                ]));
            });

            await tabCache.initialize();
            expect(tabCache.isInitializedCache()).toBe(true);
            expect(tabCache.size()).toBe(1);

            // cleanup
            clearChromeStub();
        });

        it('initializes only once on concurrent calls', async () => {
            // chrome.tabs.queryをモック
            let callCount = 0;
            stubChromeTabsQuery((_query, callback) => {
                callCount++;
                callback(asTabs([{ id: 1, title: 'Page 1', url: 'https://example.com/page1' }]));
            });

            // 複数回呼び出しても、初期化ロジックは1回だけ実行される
            await Promise.all([
                tabCache.initialize(),
                tabCache.initialize(),
                tabCache.initialize()
            ]);

            expect(callCount).toBe(1);
            expect(tabCache.isInitializedCache()).toBe(true);
            expect(tabCache.size()).toBe(1);

            // 初期化済みの状態で再度呼び出しても問題ない
            await tabCache.initialize();
            expect(callCount).toBe(1);

            // cleanup
            clearChromeStub();
        });
    });

    describe('エッジケース', () => {
        it('overwrites the tab when adding the same ID', () => {
            tabCache.add(asTab({ id: 1, title: 'Page 1', url: 'https://example.com/page1' }));
            tabCache.add(asTab({ id: 1, title: 'Page 1 (Updated)', url: 'https://example.com/page1-updated' }));
            expect(tabCache.size()).toBe(1);
            const retrieved = tabCache.get(1);
            expect(retrieved!.title).toBe('Page 1 (Updated)');
            expect(retrieved!.url).toBe('https://example.com/page1-updated');
        });

        it('adds a malformed URL when it starts with http', () => {
            const tab = {
                id: 1,
                title: 'Test Page',
                url: 'http://invalid-url-without-tld'
            };
            tabCache.add(asTab(tab));
            expect(tabCache.size()).toBe(1);
        });
    });
});