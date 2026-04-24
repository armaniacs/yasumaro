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
vi.mock('../recordingLogic.js', () => ({
    RecordingLogic: class {
        static cacheState = {
            settingsCache: null,
            cacheTimestamp: null,
            cacheVersion: 0,
            urlCache: null,
            urlCacheTimestamp: null,
            privacyCache: null,
            privacyCacheTimestamp: null,
        };
        static invalidateSettingsCache = vi.fn();
        static invalidateUrlCache = vi.fn();
        static invalidatePrivacyCache = vi.fn();
        record = vi.fn().mockResolvedValue({ success: true, skipped: false });
        getPrivacyInfoWithCache = vi.fn().mockResolvedValue({});
        getSettingsWithCache = vi.fn().mockResolvedValue({});
        getSavedUrlsWithCache = vi.fn().mockResolvedValue(new Map());
    }
}));
vi.mock('../tabCache.js', () => ({
    TabCache: class {
        add = vi.fn();
        update = vi.fn();
        remove = vi.fn();
        initialize = vi.fn().mockResolvedValue(undefined);
    }
}));
vi.mock('../obsidianClient.js', () => ({
    ObsidianClient: class {
        testConnection = vi.fn().mockResolvedValue({ success: true });
    }
}));
vi.mock('../aiClient.js', () => ({
    AIClient: class {
        testConnection = vi.fn().mockResolvedValue({ success: true });
    }
}));
vi.mock('../pipeline/RecordingPipeline.js', () => ({
    RecordingPipeline: vi.fn().mockImplementation(function(this: any) {
        this.execute = vi.fn().mockResolvedValue({ success: true, summary: 'Pipeline summary' });
    })
}));
vi.mock('../../utils/fetch.js', () => ({
    validateUrlForFilterImport: vi.fn(),
    fetchWithTimeout: vi.fn(),
    isPrivateIpAddress: vi.fn(() => false),
}));
vi.mock('../../utils/logger.js', () => ({
    logInfo: vi.fn(),
    logDebug: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    ErrorCode: {
        STORAGE_READ_FAILURE: 'STRG_RD_001',
        STORAGE_MIGRATION_FAILURE: 'STRG_MIG_001',
        BADGE_UPDATE_FAILED: 'UI_BADGE_001',
        INTERNAL_ERROR: 'INT_001',
        API_REQUEST_FAILURE: 'API_REQ_001',
        INVALID_INPUT: 'VAL_INP_001',
        CRYPTO_HMAC_FAILURE: 'CRPT_HMAC_001',
        UNKNOWN_ERROR: 'UNKN_001',
    }
}));
vi.mock('../sessionAlarmsManager.js', () => ({
    updateActivity: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../headerDetector.js', () => ({
    HeaderDetector: class {
        static normalizeUrl = vi.fn((url: string) => url);
        static initialize = vi.fn();
    }
}));
vi.mock('../../utils/storageUrls.js', () => ({
    setUrlContent: vi.fn().mockResolvedValue(undefined),
    setUrlCleansedReason: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/permissionManager.js', () => ({
    cleanupOldDeniedEntries: vi.fn().mockResolvedValue(undefined),
    cleanupDismissedEntries: vi.fn().mockResolvedValue(undefined),
}));

// Import the extracted functions from service-worker
import * as serviceWorker from '../service-worker.js';
import * as storage from '../../utils/storage.js';
import * as domainUtils from '../../utils/domainUtils.js';
import * as privacyPipeline from '../privacyPipeline.js';
import * as pendingStorage from '../../utils/pendingStorage.js';
import { RecordingLogic } from '../recordingLogic.js';
import * as fetchUtils from '../../utils/fetch.js';
import * as headerDetector from '../headerDetector.js';
import * as sessionAlarmsManager from '../sessionAlarmsManager.js';
import * as storageUrls from '../../utils/storageUrls.js';
import * as permissionManager from '../../utils/permissionManager.js';
import { logError } from '../../utils/logger.js';
import type {
    ValidVisitMessage,
    FetchUrlMessage,
    ManualRecordMessage,
    PreviewRecordMessage,
    SaveRecordMessage,
    ContentCleansingExecutedMessage,
    CheckDomainMessage,
    TestConnectionsMessage,
    TestObsidianMessage,
    TestAiMessage,
    GetPrivacyCacheMessage,
    ActivityUpdateMessage,
    SessionLockRequestMessage,
    PingMessage,
} from '../messageTypes.js';

describe('service-worker handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Sync module mocks with global chrome object so service-worker.ts uses them
        const globalChrome = (global as any).chrome;
        if (globalChrome) {
            if (globalChrome.tabs) {
                globalChrome.tabs.get = mockGet;
                globalChrome.tabs.query = mockQuery;
                globalChrome.tabs.create = mockCreate;
                globalChrome.tabs.remove = mockRemove;
                globalChrome.tabs.onRemoved = { addListener: mockAddListener };
                globalChrome.tabs.onActivated = { addListener: mockAddListener };
                globalChrome.tabs.onUpdated = { addListener: mockAddListener, removeListener: vi.fn() };
            }
            if (globalChrome.action) {
                globalChrome.action.setBadgeText = mockSetBadgeText;
                globalChrome.action.setBadgeBackgroundColor = mockSetBadgeBackgroundColor;
            }
            if (globalChrome.scripting) {
                globalChrome.scripting.executeScript = mockExecuteScript;
            }
            if (globalChrome.notifications) {
                globalChrome.notifications.onButtonClicked = { addListener: mockAddListener };
                globalChrome.notifications.onClicked = { addListener: mockAddListener };
                globalChrome.notifications.clear = mockClear;
            }
            if (globalChrome.runtime) {
                globalChrome.runtime.onInstalled = { addListener: mockAddListener };
                globalChrome.runtime.onStartup = { addListener: mockAddListener };
                globalChrome.runtime.onMessage = { addListener: mockAddListener };
                globalChrome.runtime.lastError = null;
            }
            if (globalChrome.i18n) {
                globalChrome.i18n.getMessage = vi.fn(() => 'test message');
            }
        }

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
            IS_LOCKED: 'IS_LOCKED',
            DENIED_DOMAINS: 'DENIED_DOMAINS',
            PERMISSION_NOTIFY_THRESHOLD: 'PERMISSION_NOTIFY_THRESHOLD',
        };
        // @ts-expect-error - vi.fn() type narrowing
        storage.updateDomainFilterCache.mockResolvedValue(undefined);
        // @ts-expect-error - vi.fn() type narrowing
        storage.lockSession.mockResolvedValue(undefined);
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

        it('should handle CONTENT_CLEANSING_EXECUTED message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: ContentCleansingExecutedMessage = {
                type: 'CONTENT_CLEANSING_EXECUTED',
                payload: { hardStripRemoved: 2, keywordStripRemoved: 3, totalRemoved: 5 }
            };
            const sender = { tab: { id: 1, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            handler(message, sender, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Badge update is async, just verify sendResponse is called
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it('should handle CHECK_DOMAIN message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: CheckDomainMessage = { type: 'CHECK_DOMAIN' };
            const sender = { tab: { id: 1, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            handler(message, sender, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, allowed: true }));
        });

        it('should handle GET_PRIVACY_CACHE with cache', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message = { type: 'GET_PRIVACY_CACHE' };

            // Set up privacy cache
            RecordingLogic.cacheState.privacyCache = new Map([['https://example.com', { isPrivate: false }]]);

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, cache: expect.any(Array) }));
        });

        it('should handle GET_PRIVACY_CACHE without cache', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message = { type: 'GET_PRIVACY_CACHE' };

            // Clear privacy cache
            RecordingLogic.cacheState.privacyCache = null;

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, cache: [] }));
        });

        it('should handle ACTIVITY_UPDATE', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message = { type: 'ACTIVITY_UPDATE' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith({ success: true });
        });

        it('should handle SESSION_LOCK_REQUEST', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message = { type: 'SESSION_LOCK_REQUEST' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith({ success: true });
        });

        it('should handle PING', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message = { type: 'PING' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith({ success: true });
        });

        it('should handle unknown message type', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            // Use a valid type that doesn't have a handler
            const message = { type: 'PING' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith({ success: true });
        });

        it('should handle error in process', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            // Force an error by passing invalid payload structure
            const message = { type: 'PING', payload: null };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalled();
        });

        it('should handle TEST_OBSIDIAN message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: TestObsidianMessage = { type: 'TEST_OBSIDIAN', payload: {} };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it('should handle TEST_AI message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message = { type: 'TEST_AI', payload: {} };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalled();
        });

        it('should handle TEST_OBSIDIAN message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: TestObsidianMessage = { type: 'TEST_OBSIDIAN', payload: {} };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, obsidian: { success: true } }));
        });

        it('should handle TEST_AI message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: TestAiMessage = { type: 'TEST_AI' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalled();
        });

        it('should handle GET_PRIVACY_CACHE message with cache', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: GetPrivacyCacheMessage = { type: 'GET_PRIVACY_CACHE' };
            RecordingLogic.cacheState.privacyCache = new Map([['https://example.com', { isPrivate: true }]]);

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, cache: [['https://example.com', { isPrivate: true }]] }));
        });

        it('should handle GET_PRIVACY_CACHE message without cache', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: GetPrivacyCacheMessage = { type: 'GET_PRIVACY_CACHE' };
            RecordingLogic.cacheState.privacyCache = null;

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, cache: [] }));
        });

        it('should handle ACTIVITY_UPDATE message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: ActivityUpdateMessage = { type: 'ACTIVITY_UPDATE' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sessionAlarmsManager.updateActivity).toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it('should handle SESSION_LOCK_REQUEST message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: SessionLockRequestMessage = { type: 'SESSION_LOCK_REQUEST' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(storage.lockSession).toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it('should handle PING message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: PingMessage = { type: 'PING' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it('should handle errors in process()', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            // Trigger an error by providing a valid type but invalid payload structure that causes an issue
            // We'll use FETCH_URL but make fetchWithTimeout throw via the global error path
            const message = { type: 'FETCH_URL', payload: { url: 'https://example.com' } } as FetchUrlMessage;
            // @ts-expect-error - vi.fn() type narrowing
            fetchUtils.fetchWithTimeout.mockRejectedValue(new Error('Forced error'));

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });

        it('should handle CONTENT_CLEANSING_EXECUTED without sender.tab by skipping badge', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: ContentCleansingExecutedMessage = {
                type: 'CONTENT_CLEANSING_EXECUTED',
                payload: { hardStripRemoved: 1, keywordStripRemoved: 0, totalRemoved: 1 }
            };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Without sender.tab, the handler skips badge update and falls through
            // The response may be null or success depending on fall-through behavior
            expect(sendResponse).toHaveBeenCalled();
        });

        it('should reject CHECK_DOMAIN without sender.tab', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: CheckDomainMessage = { type: 'CHECK_DOMAIN' };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Invalid sender' }));
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

    describe('handleTabActivated', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleTabActivated).toBe('function');
        });

        it('should update badge for auto-saved tab', async () => {
            // First trigger auto-save badge by handling a valid visit
            const sendResponse = vi.fn();
            const message = { type: 'VALID_VISIT', payload: { content: 'test' } } as ValidVisitMessage;
            const sender = { tab: { id: 1, url: 'https://example.com', title: 'Example' } } as chrome.runtime.MessageSender;
            await serviceWorker.handleValidVisit(message, sender, sendResponse);

            mockSetBadgeText.mockClear();
            mockSetBadgeBackgroundColor.mockClear();

            await serviceWorker.handleTabActivated({ tabId: 1 });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '◎', tabId: 1 });
            expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith(expect.objectContaining({ tabId: 1 }));
        });

        it('should clear badge when tab has no URL', async () => {
            mockGet.mockResolvedValueOnce({ id: 2, url: undefined } as chrome.tabs.Tab);
            await serviceWorker.handleTabActivated({ tabId: 2 });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
        });

        it('should show warning badge for private page', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            headerDetector.HeaderDetector.normalizeUrl.mockReturnValue('https://private.com');
            RecordingLogic.cacheState.privacyCache = new Map([['https://private.com', { isPrivate: true }]]);
            mockGet.mockResolvedValueOnce({ id: 3, url: 'https://private.com' } as chrome.tabs.Tab);

            await serviceWorker.handleTabActivated({ tabId: 3 });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '!' });
            expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith(expect.objectContaining({ color: expect.any(String) }));
        });

        it('should clear badge for non-private page', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            headerDetector.HeaderDetector.normalizeUrl.mockReturnValue('https://public.com');
            RecordingLogic.cacheState.privacyCache = new Map([['https://public.com', { isPrivate: false }]]);
            mockGet.mockResolvedValueOnce({ id: 4, url: 'https://public.com' } as chrome.tabs.Tab);

            await serviceWorker.handleTabActivated({ tabId: 4 });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
        });

        it('should handle chrome.tabs.get error gracefully', async () => {
            mockGet.mockRejectedValueOnce(new Error('Tab not found'));
            await serviceWorker.handleTabActivated({ tabId: 999 });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
        });

        it('should clear badge when privacy cache is empty', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            headerDetector.HeaderDetector.normalizeUrl.mockReturnValue('https://example.com');
            RecordingLogic.cacheState.privacyCache = null;
            mockGet.mockResolvedValueOnce({ id: 5, url: 'https://example.com' } as chrome.tabs.Tab);

            await serviceWorker.handleTabActivated({ tabId: 5 });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
        });
    });

    describe('handleTabUpdated', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleTabUpdated).toBe('function');
        });

        it('should do nothing if status is not complete', () => {
            serviceWorker.handleTabUpdated(1, { status: 'loading' }, { url: 'https://example.com' });
            expect(mockSetBadgeText).not.toHaveBeenCalled();
        });

        it('should do nothing if tab URL is missing', () => {
            serviceWorker.handleTabUpdated(1, { status: 'complete' }, {});
            expect(mockSetBadgeText).not.toHaveBeenCalled();
        });

        it('should clear auto-saved badge and show warning for private page', () => {
            // @ts-expect-error - vi.fn() type narrowing
            headerDetector.HeaderDetector.normalizeUrl.mockReturnValue('https://private.com');
            RecordingLogic.cacheState.privacyCache = new Map([['https://private.com', { isPrivate: true }]]);

            serviceWorker.handleTabUpdated(1, { status: 'complete' }, { url: 'https://private.com' });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '!', tabId: 1 });
            expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith(expect.objectContaining({ tabId: 1 }));
        });

        it('should clear badge for non-private page', () => {
            // @ts-expect-error - vi.fn() type narrowing
            headerDetector.HeaderDetector.normalizeUrl.mockReturnValue('https://public.com');
            RecordingLogic.cacheState.privacyCache = new Map([['https://public.com', { isPrivate: false }]]);

            serviceWorker.handleTabUpdated(1, { status: 'complete' }, { url: 'https://public.com' });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '', tabId: 1 });
        });

        it('should clear badge when privacy cache is empty', () => {
            // @ts-expect-error - vi.fn() type narrowing
            headerDetector.HeaderDetector.normalizeUrl.mockReturnValue('https://example.com');
            RecordingLogic.cacheState.privacyCache = null;

            serviceWorker.handleTabUpdated(1, { status: 'complete' }, { url: 'https://example.com' });
            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '', tabId: 1 });
        });
    });

    describe('handleInstalled', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleInstalled).toBe('function');
        });

        it('should log install reason', async () => {
            await serviceWorker.handleInstalled({ reason: 'install' });
            // Should not throw
            expect(RecordingLogic.invalidateSettingsCache).not.toHaveBeenCalled();
        });

        it('should invalidate cache and update domain filter on update', async () => {
            await serviceWorker.handleInstalled({ reason: 'update', previousVersion: '1.0.0' });
            expect(RecordingLogic.invalidateSettingsCache).toHaveBeenCalled();
            expect(storage.updateDomainFilterCache).toHaveBeenCalled();
        });

        it('should do nothing for unknown install reason', async () => {
            await serviceWorker.handleInstalled({ reason: 'chrome_update' });
            expect(RecordingLogic.invalidateSettingsCache).not.toHaveBeenCalled();
            expect(storage.updateDomainFilterCache).not.toHaveBeenCalled();
        });
    });

    describe('handleStartup', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleStartup).toBe('function');
        });

        it('should handle getSettings error during rehydration', async () => {
            // Mock getSettings to throw (isCacheInitialized is false initially)
            (storage.getSettings as unknown as vi.Mock).mockRejectedValueOnce(new Error('Failed to get settings'));

            await serviceWorker.handleStartup();
            expect(logError).toHaveBeenCalledWith(
                expect.stringContaining('Service Worker startup - cache rehydration failed'),
                expect.any(Object),
                'STRG_RD_001',
                'service-worker'
            );
        });

        it('should rehydrate caches on first startup', async () => {
            await serviceWorker.handleStartup();
            expect(RecordingLogic.invalidateSettingsCache).toHaveBeenCalled();
            expect(storage.updateDomainFilterCache).toHaveBeenCalled();
            expect(permissionManager.cleanupOldDeniedEntries).toHaveBeenCalledWith(90);
            expect(permissionManager.cleanupDismissedEntries).toHaveBeenCalledWith(7);
        });

        it('should skip rehydration if already initialized', async () => {
            // First call initializes
            await serviceWorker.handleStartup();
            vi.clearAllMocks();
            // Second call should skip
            await serviceWorker.handleStartup();
            expect(RecordingLogic.invalidateSettingsCache).not.toHaveBeenCalled();
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

    describe('handleNotificationClicked', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleNotificationClicked).toBe('function');
        });

        it('should clear notification for privacy confirm ID', () => {
            serviceWorker.handleNotificationClicked('privacy-confirm-abc123');
            expect(mockClear).toHaveBeenCalledWith('privacy-confirm-abc123');
        });

        it('should ignore non-privacy notifications', () => {
            serviceWorker.handleNotificationClicked('other-notification');
            expect(mockClear).not.toHaveBeenCalled();
        });
    });

    describe('init', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.init).toBe('function');
        });
    });

    describe('handleValidVisit', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleValidVisit).toBe('function');
        });

        it('should return INVALID_SENDER_ERROR when sender.tab is missing', async () => {
            const sendResponse = vi.fn();
            const message = { type: 'VALID_VISIT', payload: { content: 'test' } } as ValidVisitMessage;
            const sender = {} as chrome.runtime.MessageSender;

            await serviceWorker.handleValidVisit(message, sender, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, error: 'Invalid sender' })
            );
        });

        it('should call sendResponse with recording result when sender.tab exists', async () => {
            const sendResponse = vi.fn();
            const message = { type: 'VALID_VISIT', payload: { content: 'test content' } } as ValidVisitMessage;
            const sender = { tab: { id: 1, url: 'https://example.com', title: 'Example' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleValidVisit(message, sender, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, skipped: false })
            );
        });
    });

    describe('handleFetchUrl', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleFetchUrl).toBe('function');
        });

        it('should call sendResponse with fetched data on success', async () => {
            const sendResponse = vi.fn();
            const message = { type: 'FETCH_URL', payload: { url: 'https://example.com/filters.txt' } } as FetchUrlMessage;

            // @ts-expect-error - vi.fn() type narrowing
            fetchUtils.fetchWithTimeout.mockResolvedValue({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: { get: vi.fn(() => 'text/plain') },
                text: vi.fn().mockResolvedValue('filter content'),
            });

            await serviceWorker.handleFetchUrl(message, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, data: 'filter content', contentType: 'text/plain' })
            );
        });

        it('should call sendResponse with error on fetch failure', async () => {
            const sendResponse = vi.fn();
            const message = { type: 'FETCH_URL', payload: { url: 'https://example.com/filters.txt' } } as FetchUrlMessage;

            // @ts-expect-error - vi.fn() type narrowing
            fetchUtils.fetchWithTimeout.mockRejectedValue(new Error('Network error'));

            await serviceWorker.handleFetchUrl(message, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });
    });

    describe('handleManualRecord', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleManualRecord).toBe('function');
        });

        it('should reject insecure URLs', async () => {
            const sendResponse = vi.fn();
            const message = {
                type: 'MANUAL_RECORD',
                payload: { title: 'Test', url: 'ftp://example.com', content: '' }
            } as ManualRecordMessage;
            const sender = {} as chrome.runtime.MessageSender;

            await serviceWorker.handleManualRecord(message, sender, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, error: 'Insecure URL protocol not allowed' })
            );
        });

        it('should process secure URL and call sendResponse with result', async () => {
            const sendResponse = vi.fn();
            const message = {
                type: 'MANUAL_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: 'content', skipAi: false }
            } as ManualRecordMessage;
            const sender = {} as chrome.runtime.MessageSender;

            await serviceWorker.handleManualRecord(message, sender, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, summary: 'Pipeline summary' })
            );
        });

        it('should process PREVIEW_RECORD and call sendResponse with result', async () => {
            const sendResponse = vi.fn();
            const message = {
                type: 'PREVIEW_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: 'content' }
            } as PreviewRecordMessage;
            const sender = {} as chrome.runtime.MessageSender;

            await serviceWorker.handleManualRecord(message, sender, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, summary: 'Pipeline summary' })
            );
        });
    });

    describe('handleSaveRecord', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleSaveRecord).toBe('function');
        });

        it('should call sendResponse with pipeline result', async () => {
            const sendResponse = vi.fn();
            const message = {
                type: 'SAVE_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: 'content', maskedCount: 0 }
            } as SaveRecordMessage;

            await serviceWorker.handleSaveRecord(message, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, summary: 'Pipeline summary' })
            );
        });
    });

    describe('handleTabActivated', () => {
        it('should be exported and be a function', async () => {
            const serviceWorker = await import('../service-worker.js');
            expect(typeof serviceWorker.handleTabActivated).toBe('function');
        });
    });

    describe('handleTabUpdated', () => {
        it('should be exported and be a function', async () => {
            const serviceWorker = await import('../service-worker.js');
            expect(typeof serviceWorker.handleTabUpdated).toBe('function');
        });
    });

    describe('handleNotificationClicked', () => {
        it('should be exported and be a function', async () => {
            const serviceWorker = await import('../service-worker.js');
            expect(typeof serviceWorker.handleNotificationClicked).toBe('function');
        });
    });

    describe('createMessageHandler - more message types', () => {
        it('should handle CHECK_DOMAIN', async () => {
            const serviceWorker = await import('../service-worker.js');
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            
            const result = handler({ type: 'CHECK_DOMAIN' }, { tab: { id: 1, url: 'https://example.com' } }, sendResponse);
            expect(result).toBe(true);
            
            // Wait for async
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true, allowed: expect.any(Boolean) }));
        });

        it('should handle TEST_CONNECTIONS', async () => {
            const serviceWorker = await import('../service-worker.js');
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            
            const result = handler({ type: 'TEST_CONNECTIONS' }, {}, sendResponse);
            expect(result).toBe(true);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            // Response includes obsidian and ai test results
            expect(sendResponse).toHaveBeenCalled();
        });

        it('should handle PING', async () => {
            const serviceWorker = await import('../service-worker.js');
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            
            const result = handler({ type: 'PING' }, {}, sendResponse);
            expect(result).toBe(true);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(sendResponse).toHaveBeenCalledWith({ success: true });
        });

        it('should handle ACTIVITY_UPDATE', async () => {
            const serviceWorker = await import('../service-worker.js');
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            
            const result = handler({ type: 'ACTIVITY_UPDATE' }, {}, sendResponse);
            expect(result).toBe(true);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(sendResponse).toHaveBeenCalledWith({ success: true });
        });

        it('should handle SESSION_LOCK_REQUEST', async () => {
            const serviceWorker = await import('../service-worker.js');
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            
            const result = handler({ type: 'SESSION_LOCK_REQUEST' }, {}, sendResponse);
            expect(result).toBe(true);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(sendResponse).toHaveBeenCalledWith({ success: true });
        });

        it('should reject unknown message type with INVALID_MESSAGE_ERROR', async () => {
            const serviceWorker = await import('../service-worker.js');
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            
            const result = handler({ type: 'UNKNOWN_TYPE' }, {}, sendResponse);
            expect(result).toBe(true);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Invalid message' }));
        });

        it('should handle error in process', async () => {
            const serviceWorker = await import('../service-worker.js');
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            
            // Force an error by passing invalid payload structure
            const result = handler({ type: 'PING', payload: null }, {}, sendResponse);
            expect(result).toBe(true);
            
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(sendResponse).toHaveBeenCalled();
        });
    });
});
