/**
 * service-worker.test.ts
 * Unit tests for service-worker.ts handlers after refactoring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are set up before any module imports
const { mockAddListener, mockQuery, mockGet, mockCreate, mockRemove, mockClear,
        mockSetBadgeText, mockSetBadgeBackgroundColor, mockExecuteScript } = vi.hoisted(() => {
    return {
        mockAddListener: vi.fn(),
        mockQuery: vi.fn<Promise<chrome.tabs.Tab[]>, [chrome.tabs.QueryInfo]>(() => Promise.resolve([])),
        mockGet: vi.fn<Promise<chrome.tabs.Tab>, [number]>((tabId) => Promise.resolve({ id: tabId, url: 'https://example.com' } as chrome.tabs.Tab)),
        mockCreate: vi.fn<Promise<chrome.tabs.Tab>, [chrome.tabs.CreateProperties]>((options) =>
            Promise.resolve({ id: 1, url: options.url, active: false } as chrome.tabs.Tab)
        ),
        mockRemove: vi.fn<Promise<void>, [number]>(() => Promise.resolve()),
        mockClear: vi.fn<Promise<void>, [string]>(() => Promise.resolve()),
        mockSetBadgeText: vi.fn(),
        mockSetBadgeBackgroundColor: vi.fn(),
        mockExecuteScript: vi.fn<Promise<any[]>, [any]>(() => Promise.resolve([{ result: 'Test page content' }])),
    };
});

// Mock chrome module
vi.mock('chrome', () => ({
    tabs: {
        query: mockQuery,
        get: mockGet,
        create: mockCreate,
        remove: mockRemove,
        onRemoved: { addListener: mockAddListener },
        onActivated: { addListener: mockAddListener },
        onUpdated: { addListener: mockAddListener, removeListener: vi.fn() },
    },
    notifications: {
        onButtonClicked: { addListener: mockAddListener },
        onClicked: { addListener: mockAddListener },
        clear: mockClear,
    },
    runtime: {
        onInstalled: { addListener: mockAddListener },
        onStartup: { addListener: mockAddListener },
        lastError: null,
        onMessage: { addListener: mockAddListener },
    },
    action: {
        setBadgeText: mockSetBadgeText,
        setBadgeBackgroundColor: mockSetBadgeBackgroundColor,
    },
    scripting: {
        executeScript: mockExecuteScript,
    },
    storage: {
        local: { get: vi.fn(), set: vi.fn() },
        session: { get: vi.fn(), set: vi.fn() },
    },
    i18n: {
        getMessage: vi.fn(() => 'test message'),
    },
}));

// Mock dependencies
vi.mock('../../utils/storage.js');
vi.mock('../../utils/domainUtils.js');
vi.mock('../privacyPipeline.js');
vi.mock('../../utils/pendingStorage.js');

// Import the extracted functions from service-worker
import * as serviceWorker from '../service-worker.js';
import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as privacyPipeline from '../privacyPipeline.js';
import * as pendingStorage from '../../utils/pendingStorage.js';
import { RecordingLogic } from '../recordingLogic.js';

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
    });
});
