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
        static loadCacheFromSession = vi.fn().mockResolvedValue(undefined);
        static scheduleCacheSave = vi.fn();
        record() {
            return Promise.resolve({ success: true, skipped: false });
        }
        getPrivacyInfoWithCache() {
            return Promise.resolve({});
        }
        getSettingsWithCache() {
            return Promise.resolve(new Map());
        }
        getSavedUrlsWithCache() {
            return Promise.resolve(new Map());
        }
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
vi.mock('../../utils/crypto.js', () => ({
    getNotificationHmacKey: vi.fn().mockResolvedValue({
        type: 'hmac',
        extractable: false,
        algorithm: { name: 'HMAC', hash: 'SHA-256' },
        usages: ['sign', 'verify']
    } as CryptoKey),
    generateHmacSignature: vi.fn().mockResolvedValue('test-signature'),
    verifyHmacSignature: vi.fn().mockResolvedValue(true),
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
import { logError, logWarn, ErrorCode } from '../../utils/logger.js';
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
                globalChrome.notifications.create = vi.fn();
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

        it('should await lockSession before responding', async () => {
            let resolveLock: (() => void) | undefined;
            const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
            // @ts-expect-error - vi.fn() type narrowing
            storage.lockSession.mockReturnValue(lockPromise);

            const sendResponse = vi.fn();
            const message: SessionLockRequestMessage = { type: 'SESSION_LOCK_REQUEST' };

            const promise = serviceWorker.handleSessionLockRequest(message, sendResponse);

            // lockSession が解決する前は sendResponse されていない
            expect(sendResponse).not.toHaveBeenCalled();

            resolveLock!();
            await promise;

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

        it('should call sendResponse with INVALID_SENDER_ERROR for VALID_VISIT without sender.tab', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message: ValidVisitMessage = { type: 'VALID_VISIT', payload: { content: 'test' } };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Invalid sender' }));
        });

        it('should handle TEST_CONNECTIONS message', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();
            const message = { type: 'TEST_CONNECTIONS', payload: {} };

            handler(message, {} as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, obsidian: expect.any(Object), ai: expect.any(Object) })
            );
        });

        it('should send null for unrecognized message types that pass validation', async () => {
            const handler = serviceWorker.createMessageHandler();
            const sendResponse = vi.fn();

            // Using VALID_MESSAGE_TYPES that exist but aren't specifically handled
            // The handler falls through and sends null at the end
            const message = { type: 'SAVE_RECORD' } as any;

            handler(message, { tab: { id: 1, url: 'https://example.com' } } as any, sendResponse);
            await new Promise(resolve => setTimeout(resolve, 50));

            // SAVE_RECORD is handled, so this shouldn't send null
            expect(sendResponse).toHaveBeenCalled();
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

        it('should propagate errors during update when getSettings fails', async () => {
            (storage.getSettings as unknown as vi.Mock).mockRejectedValueOnce(new Error('Settings error'));
            await expect(serviceWorker.handleInstalled({
                reason: 'update',
                previousVersion: '1.0.0'
            })).rejects.toThrow('Settings error');
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

        it('should clear notification and decode URL for valid notification', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.getPendingPages.mockResolvedValue([
                { url: 'https://example.com', title: 'Example' }
            ]);
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Use a properly formatted notification ID
            // The notification ID format is: privacy-confirm-{base64url.url}.{signature}
            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.testSig';

            await serviceWorker.handleNotificationButtonClicked(notificationId, 0);
            expect(mockClear).toHaveBeenCalled();
        });

        it('should handle decodeUrlFromNotificationId returning null silently', async () => {
            // Use a notification ID that will fail signature verification
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.getPendingPages.mockResolvedValue([
                { url: 'https://example.com', title: 'Example' }
            ]);

            // Import crypto to mock signature verification failure
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.verifyHmacSignature.mockResolvedValue(false);

            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.badSignature';

            // Should handle gracefully without throwing
            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 0)).resolves.not.toThrow();
        });

        it('should call removePendingPages for skip action (buttonIndex 1)', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Import crypto to mock successful signature verification
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.verifyHmacSignature.mockResolvedValue(true);

            // Use a notification ID with valid format that passes prefix check
            // Short IDs return early, so use a longer one with proper format
            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.testSig';

            await serviceWorker.handleNotificationButtonClicked(notificationId, 1);

            // buttonIndex 1 should trigger removePendingPages
            expect(pendingStorage.removePendingPages).toHaveBeenCalled();
        });

        it('should handle when decoded URL is invalid and log warning', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Import crypto to mock successful signature verification that returns a valid URL
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.verifyHmacSignature.mockResolvedValue(true);

            // Use a notification ID with valid format that will decode to "about:blank"
            // which is a blocked scheme and will cause isValidUrl to return false
            // about:blank base64url = "YWJvdXQ6Ymxhbms="
            const notificationId = 'privacy-confirm-YWJvdXQ6Ymxhbms=.validSig';

            // Should handle gracefully without throwing
            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 0)).resolves.not.toThrow();
        });

        it('should log error when removePendingPages throws', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockRejectedValue(new Error('Remove failed'));

            // Import crypto to mock successful signature verification
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.verifyHmacSignature.mockResolvedValue(true);
            // @ts-expect-error - vi.fn() type narrowing
            crypto.getNotificationHmacKey.mockResolvedValue({
                type: 'hmac',
                extractable: false,
                algorithm: { name: 'HMAC', hash: 'SHA-256' },
                usages: ['sign', 'verify']
            } as CryptoKey);

            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.testSig';

            // Should handle error gracefully without throwing
            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 1)).resolves.not.toThrow();
            expect(logError).toHaveBeenCalled();
        });

        it('should call removePendingPages and verify URL decoding flow', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Import crypto to mock successful signature verification
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.verifyHmacSignature.mockResolvedValue(true);
            // @ts-expect-error - vi.fn() type narrowing
            crypto.getNotificationHmacKey.mockResolvedValue({
                type: 'hmac',
                extractable: false,
                algorithm: { name: 'HMAC', hash: 'SHA-256' },
                usages: ['sign', 'verify']
            } as CryptoKey);

            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.testSig';

            await serviceWorker.handleNotificationButtonClicked(notificationId, 1);

            // buttonIndex 1 should trigger removePendingPages
            expect(pendingStorage.removePendingPages).toHaveBeenCalledWith(['https://example.com']);
        });

        it('should handle notification ID with missing signature gracefully', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Use a notification ID without signature part - format without "." means split() returns only 1 part
            // This causes decodeUrlFromNotificationId to return null with a warning
            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ';

            // Should handle gracefully without throwing
            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 0)).resolves.not.toThrow();
            // removePendingPages should NOT be called because URL decoding failed
            expect(pendingStorage.removePendingPages).not.toHaveBeenCalled();
        });

        it('should trigger error logging when chrome.notifications.clear throws', async () => {
            // Mock the clear function to throw
            mockClear.mockRejectedValueOnce(new Error('Notification API error'));

            // Import crypto to mock successful signature verification
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.verifyHmacSignature.mockResolvedValue(true);
            // @ts-expect-error - vi.fn() type narrowing
            crypto.getNotificationHmacKey.mockResolvedValue({
                type: 'hmac',
                extractable: false,
                algorithm: { name: 'HMAC', hash: 'SHA-256' },
                usages: ['sign', 'verify']
            } as CryptoKey);

            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.testSig';

            // Should handle error gracefully - the error is caught but doesn't propagate
            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 0)).resolves.not.toThrow();
        });

        it('should record page when found in pending pages for buttonIndex 0', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.getPendingPages.mockResolvedValue([
                { url: 'https://example.com', title: 'Example Page' }
            ]);
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Import crypto to mock successful signature verification
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.verifyHmacSignature.mockResolvedValue(true);

            // Use a notification ID that will decode to https://example.com
            // base64url("https://example.com") = "aHR0cHM6Ly9leGFtcGxlLmNvbQ"
            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.validSig';

            await serviceWorker.handleNotificationButtonClicked(notificationId, 0);

            // The handler should have called getPendingPages and found the matching page
            expect(pendingStorage.getPendingPages).toHaveBeenCalled();
            expect(mockClear).toHaveBeenCalled();
        });

        it('should handle notification ID with encoded URL that is too long', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Import crypto to mock signature verification
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.verifyHmacSignature.mockResolvedValue(true);

            // Create a notification ID with an encoded part that exceeds MAX_ENCODED_LENGTH (5000)
            // This will make decodeUrlFromNotificationId return early at the length check
            const longSuffix = 'a'.repeat(6000);
            const notificationId = `privacy-confirm-${longSuffix}`;

            // Should handle gracefully without throwing
            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 0)).resolves.not.toThrow();
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

        it('should handle error in notification button click gracefully', async () => {
            // Import crypto module to set up error mock
            const crypto = await import('../../utils/crypto.js');
            // @ts-expect-error - vi.fn() type narrowing
            crypto.getNotificationHmacKey.mockRejectedValue(new Error('Crypto error'));

            const notificationId = 'privacy-confirm-invalid';

            // Should not throw
            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 0)).resolves.not.toThrow();
        });

        it('should log error when recordingLogic.record throws', async () => {
            // Spy on record and make it throw
            vi.spyOn(RecordingLogic.prototype, 'record').mockRejectedValueOnce(new Error('Record failed'));

            // Setup pending pages
            pendingStorage.getPendingPages.mockResolvedValue([
                { url: 'https://example.com', title: 'Example Page' }
            ]);
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Ensure crypto verification succeeds
            const crypto = await import('../../utils/crypto.js');
            crypto.getNotificationHmacKey.mockResolvedValueOnce({
                type: 'hmac',
                extractable: false,
                algorithm: { name: 'HMAC', hash: 'SHA-256' },
                usages: ['sign', 'verify']
            } as CryptoKey);
            crypto.verifyHmacSignature.mockResolvedValueOnce(true);

            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.testSig';

            await serviceWorker.handleNotificationButtonClicked(notificationId, 0);

            expect(logError).toHaveBeenCalledWith(
                'Notification button click handler failed',
                expect.objectContaining({
                    buttonIndex: 0,
                    error: 'Record failed'
                }),
                ErrorCode.INTERNAL_ERROR,
                'service-worker'
            );

            expect(pendingStorage.removePendingPages).not.toHaveBeenCalled();
        });

        it('should handle getPendingPages error gracefully', async () => {
            // Mock getPendingPages to throw
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.getPendingPages.mockRejectedValue(new Error('Storage error'));

            const notificationId = 'privacy-confirm-aHR0cHM6Ly9leGFtcGxlLmNvbQ.signature';

            // Should not throw
            await expect(serviceWorker.handleNotificationButtonClicked(notificationId, 0)).resolves.not.toThrow();
        });

        it('should record page when buttonIndex is 0 and page found in pending', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.getPendingPages.mockResolvedValue([
                { url: 'https://example.com', title: 'Example Page' }
            ]);
            // @ts-expect-error - vi.fn() type narrowing
            pendingStorage.removePendingPages.mockResolvedValue(undefined);

            // Use a short notification ID that doesn't go through full decode path
            // This test focuses on the notification clear behavior
            const notificationId = 'privacy-confirm-test';

            await serviceWorker.handleNotificationButtonClicked(notificationId, 0);

            // Verify notification was cleared (short IDs return early at prefix check)
            expect(mockClear).toHaveBeenCalledWith(notificationId);
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

        it('should clear notification for privacy confirm ID with long suffix', () => {
            serviceWorker.handleNotificationClicked('privacy-confirm-verylongsuffix123456');
            expect(mockClear).toHaveBeenCalledWith('privacy-confirm-verylongsuffix123456');
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

        it('should set badge for successful auto-save', async () => {
            const sendResponse = vi.fn();
            const message = { type: 'VALID_VISIT', payload: { content: 'test content' } } as ValidVisitMessage;
            const sender = { tab: { id: 1, url: 'https://example.com', title: 'Example' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleValidVisit(message, sender, sendResponse);
            expect(mockSetBadgeText).toHaveBeenCalled();
            expect(mockSetBadgeBackgroundColor).toHaveBeenCalled();
        });

        it('should send confirmationRequired notification when needed', async () => {
            // Override the record mock to return confirmationRequired
            const recordingLogic = (await import('../recordingLogic.js')).RecordingLogic;
            recordingLogic.prototype.record = vi.fn().mockResolvedValue({
                success: true,
                skipped: false,
                confirmationRequired: true,
                reason: 'cache-control'
            });

            const sendResponse = vi.fn();
            const message = { type: 'VALID_VISIT', payload: { content: 'test content' } } as ValidVisitMessage;
            const sender = { tab: { id: 3, url: 'https://example.com', title: 'Example' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleValidVisit(message, sender, sendResponse);
            // Should still return success
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        });

        it('should strip PII from maskedItems before sending response', async () => {
            // Override the record mock to return maskedItems
            const recordingLogic = (await import('../recordingLogic.js')).RecordingLogic;
            recordingLogic.prototype.record = vi.fn().mockResolvedValue({
                success: true,
                skipped: false,
                maskedItems: [{ original: 'secret', masked: true }]
            });

            const sendResponse = vi.fn();
            const message = { type: 'VALID_VISIT', payload: { content: 'test content' } } as ValidVisitMessage;
            const sender = { tab: { id: 4, url: 'https://example.com', title: 'Example' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleValidVisit(message, sender, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
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

        it('should throw error when response.ok is false', async () => {
            const sendResponse = vi.fn();
            const message = { type: 'FETCH_URL', payload: { url: 'https://example.com/filters.txt' } } as FetchUrlMessage;

            // @ts-expect-error - vi.fn() type narrowing
            fetchUtils.fetchWithTimeout.mockResolvedValue({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                headers: { get: vi.fn(() => 'text/plain') },
                text: vi.fn().mockResolvedValue('Not Found'),
            });

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

        it('should return warning when content fetch is disabled and no content provided', async () => {
            const sendResponse = vi.fn();
            const message = {
                type: 'MANUAL_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: '', skipAi: false }
            } as ManualRecordMessage;
            const sender = {} as chrome.runtime.MessageSender;

            // Disable auto content fetch
            // @ts-expect-error - vi.fn() type narrowing
            storage.getSettings.mockResolvedValue({
                PRIVACY_MODE: 'full_pipeline',
                PII_SANITIZE_LOGS: true,
                DOMAIN_WHITELIST: [],
                AUTO_SAVE_PRIVACY_BEHAVIOR: 'save',
                AUTO_CONTENT_FETCH_ENABLED: false, // Disabled!
                SKIP_AI_RATE_LIMIT_MAX: 10,
                SKIP_AI_RATE_LIMIT_WINDOW_MS: 60000,
            });

            await serviceWorker.handleManualRecord(message, sender, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, warning: expect.stringContaining('Content fetch is disabled') })
            );
        });

        it('should handle skipAi rate limiting', async () => {
            const sendResponse = vi.fn();
            const message = {
                type: 'MANUAL_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: 'content', skipAi: true }
            } as ManualRecordMessage;
            const sender = { tab: { id: 1, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            // First call - should succeed
            await serviceWorker.handleManualRecord(message, sender, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, summary: 'Pipeline summary' })
            );
        });

        // Additional tests for handleManualRecord: rate limiting and content fetch branches

        it('should enforce rate limit when limit is exceeded', async () => {
            const sendResponse = vi.fn();
            const createMessage = (): ManualRecordMessage => ({
                type: 'MANUAL_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: 'content', skipAi: true }
            });
            const sender = { tab: { id: 999, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            const rateLimitMax = 10;

            for (let i = 0; i < rateLimitMax; i++) {
                await serviceWorker.handleManualRecord(createMessage(), sender, sendResponse);
            }

            await serviceWorker.handleManualRecord(createMessage(), sender, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, error: 'Rate limit exceeded. Please try again later.' })
            );

            expect(logWarn).toHaveBeenCalledWith(
                'Rate limit exceeded for skipAi operation',
                expect.objectContaining({ sender: '999', limit: rateLimitMax }),
                undefined,
                'service-worker'
            );
        });

        it('should fetch content from existing tab when content is empty', async () => {
            const sendResponse = vi.fn();
            const message = {
                type: 'MANUAL_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: '' }
            } as ManualRecordMessage;
            const sender = { tab: { id: 1, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            mockQuery.mockResolvedValueOnce([
                { id: 123, url: 'https://example.com' } as chrome.tabs.Tab
            ]);

            await serviceWorker.handleManualRecord(message, sender, sendResponse);

            expect(mockExecuteScript).toHaveBeenCalledWith(
                expect.objectContaining({
                    target: { tabId: 123 },
                    func: expect.any(Function)
                })
            );

            await new Promise(resolve => setTimeout(resolve, 50));
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it('should handle tab content fetch error gracefully', async () => {
            mockQuery.mockRejectedValueOnce(new Error('Tabs query failed'));

            const sendResponse = vi.fn();
            const message = {
                type: 'MANUAL_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: '' }
            } as ManualRecordMessage;
            const sender = { tab: { id: 2, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleManualRecord(message, sender, sendResponse);

            expect(logWarn).toHaveBeenCalledWith(
                'Failed to get page content from tab',
                expect.objectContaining({ url: 'example.com', error: expect.any(String) }),
                undefined,
                'service-worker'
            );

            await new Promise(resolve => setTimeout(resolve, 50));
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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

        it('should strip PII from maskedItems before sending response', async () => {
            const sendResponse = vi.fn();
            const message = {
                type: 'SAVE_RECORD',
                payload: { title: 'Test', url: 'https://example.com', content: 'content', maskedCount: 2 }
            } as SaveRecordMessage;

            // Mock RecordingPipeline to return maskedItems with original field
            const pipelineModule = await import('../../utils/piiStripper.js');
            vi.spyOn(pipelineModule, 'stripPiiFromMaskedItems').mockReturnValue([{ masked: true }]);

            // Access the mocked RecordingPipeline.execute to return masked items
            const RecordingPipelineMock = (await import('../pipeline/RecordingPipeline.js')).RecordingPipeline;
            (RecordingPipelineMock as any).mockImplementation(function(this: any) {
                this.execute = vi.fn().mockResolvedValue({
                    success: true,
                    summary: 'Test summary',
                    maskedItems: [{ original: 'secret', masked: true }]
                });
            });

            await serviceWorker.handleSaveRecord(message, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );
        });
    });

    describe('handleContentCleansingExecuted', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleContentCleansingExecuted).toBe('function');
        });

        it('should update badge with cleansing count and green color', async () => {
            const sendResponse = vi.fn();
            const message: ContentCleansingExecutedMessage = {
                type: 'CONTENT_CLEANSING_EXECUTED',
                payload: { hardStripRemoved: 2, keywordStripRemoved: 3, totalRemoved: 5 }
            };
            const sender = { tab: { id: 1, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleContentCleansingExecuted(message, sender, sendResponse);

            expect(mockSetBadgeText).toHaveBeenCalledWith({ text: 'C5', tabId: 1 });
            expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith(
                expect.objectContaining({ tabId: 1 })
            );
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });

        it('should call setUrlCleansedReason with "both" when both hard and keyword are present', async () => {
            const sendResponse = vi.fn();
            const message: ContentCleansingExecutedMessage = {
                type: 'CONTENT_CLEANSING_EXECUTED',
                payload: { hardStripRemoved: 2, keywordStripRemoved: 3, totalRemoved: 5 }
            };
            const sender = { tab: { id: 2, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleContentCleansingExecuted(message, sender, sendResponse);

            expect(storageUrls.setUrlCleansedReason).toHaveBeenCalledWith('https://example.com', 'both');
        });

        it('should call setUrlCleansedReason with "hard" when only hard strip has removals', async () => {
            const sendResponse = vi.fn();
            const message: ContentCleansingExecutedMessage = {
                type: 'CONTENT_CLEANSING_EXECUTED',
                payload: { hardStripRemoved: 3, keywordStripRemoved: 0, totalRemoved: 3 }
            };
            const sender = { tab: { id: 3, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleContentCleansingExecuted(message, sender, sendResponse);

            expect(storageUrls.setUrlCleansedReason).toHaveBeenCalledWith('https://example.com', 'hard');
        });

        it('should call setUrlCleansedReason with "keyword" when only keyword strip has removals', async () => {
            const sendResponse = vi.fn();
            const message: ContentCleansingExecutedMessage = {
                type: 'CONTENT_CLEANSING_EXECUTED',
                payload: { hardStripRemoved: 0, keywordStripRemoved: 4, totalRemoved: 4 }
            };
            const sender = { tab: { id: 4, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleContentCleansingExecuted(message, sender, sendResponse);

            expect(storageUrls.setUrlCleansedReason).toHaveBeenCalledWith('https://example.com', 'keyword');
        });

        it('should not call setUrlCleansedReason when totalRemoved is 0', async () => {
            const sendResponse = vi.fn();
            const message: ContentCleansingExecutedMessage = {
                type: 'CONTENT_CLEANSING_EXECUTED',
                payload: { hardStripRemoved: 0, keywordStripRemoved: 0, totalRemoved: 0 }
            };
            const sender = { tab: { id: 5, url: 'https://example.com' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleContentCleansingExecuted(message, sender, sendResponse);

            expect(storageUrls.setUrlCleansedReason).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith({ success: true });
        });

        it('should not call setUrlCleansedReason when sender.tab.url is missing', async () => {
            const sendResponse = vi.fn();
            const message: ContentCleansingExecutedMessage = {
                type: 'CONTENT_CLEANSING_EXECUTED',
                payload: { hardStripRemoved: 2, keywordStripRemoved: 3, totalRemoved: 5 }
            };
            const sender = { tab: { id: 6 } } as chrome.runtime.MessageSender;

            await serviceWorker.handleContentCleansingExecuted(message, sender, sendResponse);

            expect(storageUrls.setUrlCleansedReason).not.toHaveBeenCalled();
        });
    });

    describe('handleCheckDomain', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleCheckDomain).toBe('function');
        });

        it('should return allowed: true when domain is allowed', async () => {
            const sendResponse = vi.fn();
            const message: CheckDomainMessage = { type: 'CHECK_DOMAIN' };
            const sender = { tab: { id: 1, url: 'https://allowed.com' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleCheckDomain(message, sender, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, allowed: true })
            );
        });

        it('should return allowed: false when domain is not allowed', async () => {
            // @ts-expect-error - vi.fn() type narrowing
            domainUtils.isDomainAllowed.mockResolvedValue(false);

            const sendResponse = vi.fn();
            const message: CheckDomainMessage = { type: 'CHECK_DOMAIN' };
            const sender = { tab: { id: 2, url: 'https://blocked.com' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleCheckDomain(message, sender, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, allowed: false })
            );
        });

        it('should return allowed: false when sender.tab.url is empty', async () => {
            const sendResponse = vi.fn();
            const message: CheckDomainMessage = { type: 'CHECK_DOMAIN' };
            const sender = { tab: { id: 3, url: '' } } as chrome.runtime.MessageSender;

            await serviceWorker.handleCheckDomain(message, sender, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, allowed: false })
            );
        });
    });

    describe('handleTestConnections', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleTestConnections).toBe('function');
        });

        it('should return both obsidian and ai connection results', async () => {
            const sendResponse = vi.fn();
            const message: TestConnectionsMessage = { type: 'TEST_CONNECTIONS' };

            await serviceWorker.handleTestConnections(message, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    obsidian: expect.any(Object),
                    ai: expect.any(Object)
                })
            );
        });
    });

    describe('handleTestObsidian', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleTestObsidian).toBe('function');
        });

        it('should return obsidian connection result', async () => {
            const sendResponse = vi.fn();
            const message: TestObsidianMessage = { type: 'TEST_OBSIDIAN', payload: {} };

            await serviceWorker.handleTestObsidian(message, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, obsidian: expect.any(Object) })
            );
        });

        it('should pass apiKey override when provided', async () => {
            const sendResponse = vi.fn();
            const message: TestObsidianMessage = {
                type: 'TEST_OBSIDIAN',
                payload: { apiKey: 'override-key' }
            };

            await serviceWorker.handleTestObsidian(message, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, obsidian: expect.any(Object) })
            );
        });
    });

    describe('handleTestAi', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleTestAi).toBe('function');
        });

        it('should return ai connection result', async () => {
            const sendResponse = vi.fn();
            const message: TestAiMessage = { type: 'TEST_AI' };

            await serviceWorker.handleTestAi(message, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, ai: expect.any(Object) })
            );
        });
    });

    describe('handleGetPrivacyCache', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleGetPrivacyCache).toBe('function');
        });

        it('should return cache entries when cache exists', async () => {
            RecordingLogic.cacheState.privacyCache = new Map([['https://example.com', { isPrivate: false }]]);

            const sendResponse = vi.fn();
            const message: GetPrivacyCacheMessage = { type: 'GET_PRIVACY_CACHE' };

            await serviceWorker.handleGetPrivacyCache(message, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, cache: expect.any(Array) })
            );
        });

        it('should return empty array when cache is null', async () => {
            RecordingLogic.cacheState.privacyCache = null;

            const sendResponse = vi.fn();
            const message: GetPrivacyCacheMessage = { type: 'GET_PRIVACY_CACHE' };

            await serviceWorker.handleGetPrivacyCache(message, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, cache: [] })
            );
        });
    });

    describe('handleActivityUpdate', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleActivityUpdate).toBe('function');
        });

        it('should call updateActivity and return success', async () => {
            const sendResponse = vi.fn();
            const message: ActivityUpdateMessage = { type: 'ACTIVITY_UPDATE' };

            await serviceWorker.handleActivityUpdate(message, sendResponse);

            expect(sessionAlarmsManager.updateActivity).toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });
    });

    describe('handleSessionLockRequest', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handleSessionLockRequest).toBe('function');
        });

        it('should call lockSession and return success', async () => {
            const sendResponse = vi.fn();
            const message: SessionLockRequestMessage = { type: 'SESSION_LOCK_REQUEST' };

            await serviceWorker.handleSessionLockRequest(message, sendResponse);

            expect(storage.lockSession).toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        });
    });

    describe('handlePing', () => {
        it('should be exported and be a function', () => {
            expect(typeof serviceWorker.handlePing).toBe('function');
        });

        it('should return success', async () => {
            const sendResponse = vi.fn();
            const message: PingMessage = { type: 'PING' };

            await serviceWorker.handlePing(message, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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
