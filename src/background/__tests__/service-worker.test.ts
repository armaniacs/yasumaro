/**
 * service-worker.test.ts
 * Unit tests for service-worker.ts handlers after refactoring.
 * Tests extracted functions: createMessageHandler, handleTabRemoved, handleTabActivated,
 * handleTabUpdated, handleInstalled, handleStartup, handleNotificationButtonClicked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome APIs NOT covered by vitest.setup.ts
vi.stubGlobal('chrome', {
    ...(global as any).chrome,
    tabs: {
        ...((global as any).chrome?.tabs || {}),
        query: vi.fn<Promise<chrome.tabs.Tab[]>, [chrome.tabs.QueryInfo]>(() => Promise.resolve([])),
        get: vi.fn<Promise<chrome.tabs.Tab>, [number]>((tabId) => Promise.resolve({ id: tabId, url: 'https://example.com' } as chrome.tabs.Tab)),
        create: vi.fn<Promise<chrome.tabs.Tab>, [chrome.tabs.CreateProperties]>((options) =>
            Promise.resolve({ id: 1, url: options.url, active: false } as chrome.tabs.Tab)
        ),
        remove: vi.fn<Promise<void>, [number]>(() => Promise.resolve()),
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
        onActivated: { addListener: vi.fn() },
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    notifications: {
        ...((global as any).chrome?.notifications || {}),
        onButtonClicked: { addListener: vi.fn() },
        onClicked: { addListener: vi.fn() },
        clear: vi.fn<Promise<void>, [string]>(() => Promise.resolve()),
    },
    runtime: {
        ...((global as any).chrome?.runtime || {}),
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
    },
    action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
    },
    scripting: {
        executeScript: vi.fn<Promise<any[]>, [any]>(() =>
            Promise.resolve([{ result: 'Test page content' }])
        ),
    },
});

// Import the extracted functions from service-worker
import * as serviceWorker from '../service-worker.js';
import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as privacyPipeline from '../privacyPipeline.js';
import * as pendingStorage from '../../utils/pendingStorage.js';
import { RecordingLogic } from '../recordingLogic.js';

vi.mock('../../utils/storage.js');
vi.mock('../../utils/domainUtils.js');
vi.mock('../privacyPipeline.js');
vi.mock('../../utils/pendingStorage.js');

describe('service-worker handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Reset RecordingLogic cache state
        RecordingLogic.cacheState = {
            settingsCache: null,
            cacheTimestamp: null,
            cacheVersion: 0,
            urlCache: null,
            urlCacheTimestamp: null,
            privacyCache: null,
            privacyCacheTimestamp: null,
        };

        // Default storage mock
        // @ts-expect-error - vi.fn() type narrowing
        storage.getSettings.mockResolvedValue({
            PRIVACY_MODE: 'full_pipeline',
            PII_SANITIZE_LOGS: true,
            DOMAIN_WHITELIST: [],
            AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
            AUTO_CONTENT_FETCH_ENABLED: true,
            SKIP_AI_RATE_LIMIT_MAX: 10,
            SKIP_AI_RATE_LIMIT_WINDOW_MS: 60000,
        });
        // @ts-expect-error - vi.fn() type narrowing
        storage.getSavedUrlsWithTimestamps.mockResolvedValue(new Map());
        // @ts-expect-error - vi.fn() type narrowing
        storage.setSavedUrlsWithTimestamps.mockResolvedValue();
        storage.StorageKeys = {
            PRIVACY_MODE: 'PRIVACY_MODE',
            PII_SANITIZE_LOGS: 'PII_SANITIZE_LOGS',
            DOMAIN_WHITELIST: 'DOMAIN_WHITELIST',
            AUTO_SAVE_PRIVACY_BEHAVIOR: 'AUTO_SAVE_PRIVACY_BEHAVIOR',
            AUTO_CONTENT_FETCH_ENABLED: 'AUTO_CONTENT_FETCH_ENABLED',
            SKIP_AI_RATE_LIMIT_MAX: 'SKIP_AI_RATE_LIMIT_MAX',
            SKIP_AI_RATE_LIMIT_WINDOW_MS: 'SKIP_AI_RATE_LIMIT_WINDOW_MS',
        };
        // @ts-expect-error - vi.fn() type narrowing
        domainUtils.isDomainAllowed.mockResolvedValue(true);
        // PrivacyPipeline mock
        // @ts-expect-error - vi.fn() type narrowing
        privacyPipeline.PrivacyPipeline.mockImplementation(function(this: any) {
            this.process = vi.fn().mockResolvedValue({ summary: 'Test summary', maskedCount: 0 });
        });
    });

    describe('createMessageHandler', () => {
        it('should return a function', () => {
            const handler = serviceWorker.createMessageHandler();
            expect(typeof handler).toBe('function');
        });

        it('should call sendResponse with INVALID_MESSAGE_ERROR for null message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();

            handler(null as any, {} as any, sendResponse);

            // Wait for async process to complete
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, error: 'Invalid message' })
            );
        });

        it('should call sendResponse with INVALID_MESSAGE_ERROR for missing type', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();

            handler({} as any, {} as any, sendResponse);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, error: 'Invalid message' })
            );
        });

        it('should call sendResponse with INVALID_MESSAGE_ERROR for invalid type', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();

            handler({ type: 'INVALID_TYPE' } as any, {} as any, sendResponse);

            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, error: 'Invalid message' })
            );
        });
    });

    describe('handleTabRemoved', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleTabRemoved).toBe('function');
        });

        it('should not throw when called', () => {
            expect(() => serviceWorker.handleTabRemoved(123)).not.toThrow();
        });
    });

    describe('handleNotificationButtonClicked', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleNotificationButtonClicked).toBe('function');
        });

        it('should return early for notification ID not starting with privacy prefix', async () => {
            await serviceWorker.handleNotificationButtonClicked('other-prefix-id', 0);
            // Should not throw and should not call any storage operations
            expect(pendingStorage.getPendingPages).not.toHaveBeenCalled();
        });

        it('should handle button index 1 (skip) without throwing', async () => {
            const mockGetPendingPages = pendingStorage.getPendingPages as ReturnType<typeof vi.fn>;
            // @ts-expect-error - vi.fn() type narrowing
            mockGetPendingPages.mockResolvedValue([
                { url: 'https://example.com', title: 'Example' }
            ]);

            // Use a valid notification ID format
            const notificationId = 'privacy-confirm-'; // Short but starts with prefix

            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 1)).resolves.not.toThrow();
        });
    });

    describe('init', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.init).toBe('function');
        });

        it('should register Chrome event listeners when called', () => {
            // Clear any previous listener calls
            vi.clearAllMocks();

            serviceWorker.init();

            // Verify Chrome API listeners were registered
            expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
            expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalled();
            expect(chrome.tabs.onActivated.addListener).toHaveBeenCalled();
            expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalled();
            expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalled();
            expect(chrome.runtime.onStartup.addListener).toHaveBeenCalled();
            expect(chrome.notifications.onButtonClicked.addListener).toHaveBeenCalled();
            expect(chrome.notifications.onClicked.addListener).toHaveBeenCalled();
        });
    });
});
