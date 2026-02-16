/**
 * TabCache_TEST.js
 * TabCacheクラスの単体テスト
 */

import { TabCache } from '../tabCache.js';

describe('TabCache', () => {
    let tabCache;

    beforeEach(() => {
        tabCache = new TabCache();
    });

    afterEach(() => {
        tabCache.clear();
    });

    describe('初期化', () => {
        it('初期化状態はfalseであること', () => {
            expect(tabCache.isInitializedCache()).toBe(false);
        });

        it('isInitializedメソッドで初期化状態を取得できること', () => {
            expect(tabCache.isInitializedCache()).toBe(false);
        });
    });

    describe('タブ情報の追加', () => {
        it('有効なhttp URLのタブを追加できること', () => {
            const tab = {
                id: 1,
                title: 'Test Page',
                url: 'https://example.com',
                favIconUrl: 'https://example.com/favicon.ico'
            };
            tabCache.add(tab);
            expect(tabCache.size()).toBe(1);
        });

        it('有効なhttps URLのタブを追加できること', () => {
            const tab = {
                id: 2,
                title: 'Test Page',
                url: 'http://example.com',
                favIconUrl: 'http://example.com/favicon.ico'
            };
            tabCache.add(tab);
            expect(tabCache.size()).toBe(1);
        });

        it('非http URLのタブは追加されないこと', () => {
            const tab = {
                id: 3,
                title: 'Chrome Extensions',
                url: 'chrome://extensions/',
                favIconUrl: null
            };
            tabCache.add(tab);
            expect(tabCache.size()).toBe(0);
        });

        it('タブIDがない場合は追加されないこと', () => {
            const tab = {
                url: 'https://example.com',
                title: 'Test Page'
            };
            tabCache.add(tab);
            expect(tabCache.size()).toBe(0);
        });

        it('URLがない場合は追加されないこと', () => {
            const tab = {
                id: 1,
                title: 'Test Page'
            };
            tabCache.add(tab);
            expect(tabCache.size()).toBe(0);
        });

        it('複数のタブを一度に追加できること', () => {
            const tabs = [
                { id: 1, title: 'Page 1', url: 'https://example.com/page1' },
                { id: 2, title: 'Page 2', url: 'https://example.com/page2' },
                { id: 3, title: 'Page 3', url: 'https://example.com/page3' }
            ];
            tabCache.addTabs(tabs);
            expect(tabCache.size()).toBe(3);
        });
    });

    describe('タブ情報の取得', () => {
        it('存在するタブIDで情報を取得できること', () => {
            const tab = {
                id: 1,
                title: 'Test Page',
                url: 'https://example.com',
                favIconUrl: 'https://example.com/favicon.ico'
            };
            tabCache.add(tab);
            const retrieved = tabCache.get(1);
            expect(retrieved).not.toBeNull();
            expect(retrieved.title).toBe('Test Page');
            expect(retrieved.url).toBe('https://example.com');
            expect(retrieved.favIconUrl).toBe('https://example.com/favicon.ico');
        });

        it('存在しないタブIDではnullを返すこと', () => {
            const retrieved = tabCache.get(999);
            expect(retrieved).toBeNull();
        });
    });

    describe('タブ情報の更新', () => {
        it('存在するタブの情報を更新できること', () => {
            const tab = {
                id: 1,
                title: 'Old Title',
                url: 'https://example.com',
                favIconUrl: null
            };
            tabCache.add(tab);
            tabCache.update(1, { title: 'New Title', content: 'Test content' });
            const retrieved = tabCache.get(1);
            expect(retrieved.title).toBe('New Title');
            expect(retrieved.content).toBe('Test content');
            expect(retrieved.url).toBe('https://example.com');
        });

        it('存在しないタブIDで更新してもエラーにならないこと', () => {
            expect(() => {
                tabCache.update(999, { title: 'New Title' });
            }).not.toThrow();
        });
    });

    describe('タブ情報の削除', () => {
        it('存在するタブIDで削除できること', () => {
            const tab = {
                id: 1,
                title: 'Test Page',
                url: 'https://example.com'
            };
            tabCache.add(tab);
            expect(tabCache.size()).toBe(1);
            tabCache.remove(1);
            expect(tabCache.size()).toBe(0);
            expect(tabCache.get(1)).toBeNull();
        });

        it('存在しないタブIDで削除してもエラーにならないこと', () => {
            expect(() => {
                tabCache.remove(999);
            }).not.toThrow();
        });

        it('複数のタブを一度に削除できること', () => {
            tabCache.add({ id: 1, title: 'Page 1', url: 'https://example.com/page1' });
            tabCache.add({ id: 2, title: 'Page 2', url: 'https://example.com/page2' });
            tabCache.add({ id: 3, title: 'Page 3', url: 'https://example.com/page3' });
            expect(tabCache.size()).toBe(3);
            tabCache.removeAll([1, 3]);
            expect(tabCache.size()).toBe(1);
            expect(tabCache.get(2)).not.toBeNull();
        });
    });

    describe('キャッシュクリア', () => {
        it('全キャッシュをクリアできること', () => {
            tabCache.add({ id: 1, title: 'Page 1', url: 'https://example.com/page1' });
            tabCache.add({ id: 2, title: 'Page 2', url: 'https://example.com/page2' });
            expect(tabCache.size()).toBe(2);
            tabCache.clear();
            expect(tabCache.size()).toBe(0);
            expect(tabCache.isInitializedCache()).toBe(false);
        });
    });

    describe('全タブ情報の取得', () => {
        it('全てのタブ情報をイテレータとして取得できること', () => {
            tabCache.add({ id: 1, title: 'Page 1', url: 'https://example.com/page1' });
            tabCache.add({ id: 2, title: 'Page 2', url: 'https://example.com/page2' });
            const all = Array.from(tabCache.getAll());
            expect(all).toHaveLength(2);
            expect(all[0].title).toBe('Page 1');
            expect(all[1].title).toBe('Page 2');
        });

        it('空のキャッシュから取得してもエラーにならないこと', () => {
            expect(() => {
                const all = Array.from(tabCache.getAll());
                expect(all).toHaveLength(0);
            }).not.toThrow();
        });
    });

    describe('初期化Promise', () => {
        it('初期化メソッドが呼ばれると初期化フラグがtrueになること', async () => {
            // chrome.tabs.queryをモック
            global.chrome = {
                tabs: {
                    query: (query, callback) => {
                        callback([
                            { id: 1, title: 'Page 1', url: 'https://example.com/page1' }
                        ]);
                    }
                }
            };

            await tabCache.initialize();
            expect(tabCache.isInitializedCache()).toBe(true);
            expect(tabCache.size()).toBe(1);

            // cleanup
            global.chrome = undefined;
        });

        it('連続呼び出し時に適切に処理されること', async () => {
            // chrome.tabs.queryをモック
            let callCount = 0;
            global.chrome = {
                tabs: {
                    query: (query, callback) => {
                        callCount++;
                        callback([{ id: 1, title: 'Page 1', url: 'https://example.com/page1' }]);
                    }
                }
            };

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
            global.chrome = undefined;
        });
    });

    describe('エッジケース', () => {
        it('同じIDでタブを追加すると上書きされること', () => {
            tabCache.add({ id: 1, title: 'Page 1', url: 'https://example.com/page1' });
            tabCache.add({ id: 1, title: 'Page 1 (Updated)', url: 'https://example.com/page1-updated' });
            expect(tabCache.size()).toBe(1);
            const retrieved = tabCache.get(1);
            expect(retrieved.title).toBe('Page 1 (Updated)');
            expect(retrieved.url).toBe('https://example.com/page1-updated');
        });

        it('不正な形式のURLでもhttp始まりなら追加されること', () => {
            const tab = {
                id: 1,
                title: 'Test Page',
                url: 'http://invalid-url-without-tld'
            };
            tabCache.add(tab);
            expect(tabCache.size()).toBe(1);
        });
    });
});