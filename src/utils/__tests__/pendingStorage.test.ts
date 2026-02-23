/**
 * pendingStorage.test.ts
 * pendingStorage モジュールのテスト
 */

import { addPendingPage, getPendingPages, removePendingPages, clearExpiredPages } from '../pendingStorage';

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};

const mockChrome = {
    storage: {
        local: {
            get: jest.fn((keys: string | string[] | null) => {
                if (keys === null) {
                    return Promise.resolve({ ...mockStorage });
                }
                if (Array.isArray(keys)) {
                    const result: Record<string, unknown> = {};
                    for (const key of keys) {
                        if (key in mockStorage) {
                            result[key] = mockStorage[key];
                        }
                    }
                    return Promise.resolve(result);
                }
                if (typeof keys === 'string') {
                    return Promise.resolve({ [keys]: mockStorage[keys] });
                }
                return Promise.resolve({});
            }),
            set: jest.fn((items: Record<string, unknown>) => {
                Object.assign(mockStorage, items);
                return Promise.resolve();
            }),
            remove: jest.fn((keys: string | string[]) => {
                if (Array.isArray(keys)) {
                    for (const key of keys) {
                        delete mockStorage[key];
                    }
                } else {
                    delete mockStorage[keys];
                }
                return Promise.resolve();
            })
        }
    }
};

global.chrome = mockChrome as unknown as typeof chrome;

describe('pendingStorage', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        jest.clearAllMocks();
    });

    describe('addPendingPage', () => {
        it('should add a pending page to storage', async () => {
            const now = Date.now();
            const pendingPage = {
                url: 'https://example.com/page',
                title: 'Test Page',
                timestamp: now,
                reason: 'cache-control' as const,
                headerValue: 'Cache-Control: private',
                expiry: now + 24 * 60 * 60 * 1000
            };

            await addPendingPage(pendingPage);

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual([pendingPage]);
        });

        it('should exclude duplicate pages with same URL', async () => {
            const now = Date.now();
            const existingPage = {
                url: 'https://example.com/page',
                title: 'Test Page',
                timestamp: now,
                reason: 'cache-control' as const,
                headerValue: 'Cache-Control: private',
                expiry: now + 24 * 60 * 60 * 1000
            };
            mockStorage['osh_pending_pages'] = [existingPage];

            const duplicatePage = {
                url: 'https://example.com/page',
                title: 'Updated Test Page',
                timestamp: now + 1000,
                reason: 'set-cookie' as const,
                headerValue: 'Set-Cookie: session=abc',
                expiry: now + 24 * 60 * 60 * 1000
            };

            await addPendingPage(duplicatePage);

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual([existingPage]);
        });
    });

    describe('getPendingPages', () => {
        it('should return all pending pages', async () => {
            const now = Date.now();
            const pendingPage = {
                url: 'https://example.com/page',
                title: 'Test Page',
                timestamp: now,
                reason: 'cache-control' as const,
                headerValue: 'Cache-Control: private',
                expiry: now + 24 * 60 * 60 * 1000
            };

            mockStorage['osh_pending_pages'] = [pendingPage];

            const result = await getPendingPages();

            expect(result).toEqual([pendingPage]);
        });

        it('should expire pages past expiry time', async () => {
            const now = Date.now();
            const expiredPage = {
                url: 'https://example.com/expired',
                title: 'Expired Page',
                timestamp: now - 25 * 60 * 60 * 1000,
                reason: 'cache-control' as const,
                expiry: now - 1000
            };

            const validPage = {
                url: 'https://example.com/valid',
                title: 'Valid Page',
                timestamp: now,
                reason: 'cache-control' as const,
                expiry: now + 24 * 60 * 60 * 1000
            };

            mockStorage['osh_pending_pages'] = [expiredPage, validPage];

            const result = await getPendingPages();

            expect(result).toEqual([validPage]);
        });
    });

    describe('removePendingPages', () => {
        it('should remove specified pages', async () => {
            const now = Date.now();
            const pages = [
                { url: 'https://example.com/page1', title: 'Page 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 },
                { url: 'https://example.com/page2', title: 'Page 2', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
            ];

            mockStorage['osh_pending_pages'] = pages;

            await removePendingPages(['https://example.com/page1']);

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual([pages[1]]);
        });

        it('should remove multiple specified pages', async () => {
            const now = Date.now();
            const pages = [
                { url: 'https://example.com/page1', title: 'Page 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 },
                { url: 'https://example.com/page2', title: 'Page 2', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 },
                { url: 'https://example.com/page3', title: 'Page 3', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
            ];

            mockStorage['osh_pending_pages'] = pages;

            await removePendingPages(['https://example.com/page1', 'https://example.com/page3']);

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual([pages[1]]);
        });

        it('should handle empty list of URLs to remove', async () => {
            const now = Date.now();
            const pages = [
                { url: 'https://example.com/page1', title: 'Page 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
            ];

            mockStorage['osh_pending_pages'] = pages;

            await removePendingPages([]);

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual(pages);
        });
    });

    describe('clearExpiredPages', () => {
        it('should clear expired pages', async () => {
            const now = Date.now();
            const pages = [
                { url: 'https://example.com/expired', title: 'Expired', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now - 1000 },
                { url: 'https://example.com/valid', title: 'Valid', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
            ];

            mockStorage['osh_pending_pages'] = pages;

            await clearExpiredPages();

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual([pages[1]]);
        });

        it('should clear all pages when all are expired', async () => {
            const now = Date.now();
            const pages = [
                { url: 'https://example.com/expired1', title: 'Expired 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now - 1000 },
                { url: 'https://example.com/expired2', title: 'Expired 2', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now - 2000 }
            ];

            mockStorage['osh_pending_pages'] = pages;

            await clearExpiredPages();

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual([]);
        });

        it('should keep all pages when none are expired', async () => {
            const now = Date.now();
            const pages = [
                { url: 'https://example.com/valid1', title: 'Valid 1', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 },
                { url: 'https://example.com/valid2', title: 'Valid 2', timestamp: now, reason: 'cache-control' as const, headerValue: 'Cache-Control: private', expiry: now + 86400000 }
            ];

            mockStorage['osh_pending_pages'] = pages;

            await clearExpiredPages();

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual(pages);
        });
    });
});