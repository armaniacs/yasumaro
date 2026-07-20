import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { TabData } from '../tabCache.js';
import type { Settings } from '../../utils/storage.js';
import { isSecureUrl, sanitizeUrlForLogging } from '../../utils/urlUtils.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../../utils/fetch.js';
import { isDomainAllowed } from '../../utils/domainUtils.js';
import { BADGE_COLORS } from '../../constants/appConstants.js';
import { logDebug, logWarn, logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { createErrorResponse } from '../../utils/errorMessages.js';
import { StorageKeys } from '../../utils/storage.js';
import { setUrlCleansedReason } from '../../utils/storageUrls.js';
import { stripPiiFromMaskedItems } from '../../utils/piiStripper.js';
import { encodeUrlSafeBase64 } from './urlNotificationHandlers.js';
import { NotificationHelper } from '../notificationHelper.js';
import type { MessageSenderLike } from '../rateLimiter.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import { createRecordingPipeline } from '../pipeline/RecordingPipeline.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { AIService } from '../ai/AIService.js';
import type { SqliteClient } from '../sqliteClient.js';

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

// ============================================================================
// Deps interfaces
// ============================================================================

export interface ValidVisitHandlerDeps {
  isRecordingAllowed: () => Promise<boolean>;
  cacheTab: (tab: chrome.tabs.Tab) => void;
  updateCachedTab: (tabId: number, data: Partial<TabData>) => void;
  recordVisit: (data: RecordingData) => Promise<RecordingResult>;
  addBadgeTab: (tabId: number) => void;
  hasBadgeTab: (tabId: number) => boolean;
}

export interface FetchUrlHandlerDeps {
  getSettings: () => Promise<Settings>;
  buildAllowedUrls: (settings: Settings) => Set<string>;
}

export interface ManualRecordHandlerDeps {
  isRecordingAllowed: () => Promise<boolean>;
  checkRateLimit: (sender: MessageSenderLike | undefined, settings: Record<string, unknown>) => Promise<{ allowed: boolean; error?: string }>;
  fetchContent: (url: string) => Promise<string>;
  getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  obsidian: ObsidianClient;
  aiService: AIService | null;
  sqliteClient: SqliteClient | null;
  getSettings: () => Promise<Settings>;
  setUrlContent: (url: string, content: string) => Promise<void>;
}

export interface SaveRecordHandlerDeps {
  isRecordingAllowed: () => Promise<boolean>;
  getPrivacyInfoWithCache: (url: string) => Promise<PrivacyInfo | null>;
  obsidian: ObsidianClient;
  aiService: AIService | null;
  sqliteClient: SqliteClient | null;
  getSettings: () => Promise<Settings>;
  setUrlContent: (url: string, content: string) => Promise<void>;
}

export interface ContentCleansingExecutedHandlerDeps {
  hasBadgeTab: (tabId: number) => boolean;
}

export interface CheckDomainHandlerDeps {
  isDomainAllowed: (url: string) => Promise<boolean>;
}

export interface TestConnectionsHandlerDeps {
  testObsidian: () => Promise<{ success: boolean; message: string }>;
  testAi: () => Promise<{ success: boolean; message: string }>;
}

export interface TestObsidianHandlerDeps {
  testConnection: (override?: { apiKey?: string }) => Promise<unknown>;
}

export interface TestAiHandlerDeps {
  clearSettingsCache: () => void;
  testConnection: () => Promise<unknown>;
}

export interface GetPrivacyCacheHandlerDeps {
  getPrivacyCache: () => Map<string, PrivacyInfo> | null;
}

export interface ActivityUpdateHandlerDeps {
  updateActivity: () => Promise<void>;
}

export interface SessionLockRequestHandlerDeps {
  lockSession: () => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PingHandlerDeps {}

export interface RefreshLocalMarkdownSchedulerHandlerDeps {
  initExportScheduler: () => Promise<void>;
}

export interface ConsentStateChangedHandlerDeps {
  updateConsentBadge: () => Promise<void>;
}

// ============================================================================
// Factory functions
// ============================================================================

export function createValidVisitHandler(deps: ValidVisitHandlerDeps) {
  return async (
    message: ValidVisitMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    if (!sender.tab) {
      sendResponse({ success: false, error: 'Invalid sender' });
      return;
    }

    if (!(await deps.isRecordingAllowed())) {
      sendResponse({ success: false, reason: 'privacy_consent_required' });
      return;
    }

    deps.cacheTab(sender.tab);

    const result = await deps.recordVisit({
      title: sender.tab.title || '',
      url: sender.tab.url || '',
      content: message.payload?.content || '',
      skipDuplicateCheck: false,
      recordType: 'auto',
      pageBytes: message.payload?.pageBytes,
      candidateBytes: message.payload?.candidateBytes,
      originalBytes: message.payload?.originalBytes,
      cleansedBytes: message.payload?.cleansedBytes,
      aiSummaryOriginalBytes: message.payload?.aiSummaryOriginalBytes,
      aiSummaryCleansedBytes: message.payload?.aiSummaryCleansedBytes,
      aiSummaryCleansedElements: message.payload?.aiSummaryCleansedElements,
      aiSummaryCleansedReason: message.payload?.aiSummaryCleansedReason,
      aiSummaryCleansedReasons: message.payload?.aiSummaryCleansedReasons,
    });

    if (sender.tab.id) {
      deps.updateCachedTab(sender.tab.id, {
        title: sender.tab.title || '',
        url: sender.tab.url || '',
        content: message.payload?.content || '',
        isValidVisit: true,
      });
    }

    if (result.success && !result.skipped && sender.tab.id) {
      const savedTabId = sender.tab.id;
      deps.addBadgeTab(savedTabId);
      chrome.action.setBadgeText({ text: '\u25CE', tabId: savedTabId });
      chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.BLUE as string, tabId: savedTabId });
    }

    if (result.confirmationRequired) {
      const url = sender.tab.url || '';
      const title = sender.tab.title || url;
      const reason = result.reason || 'cache-control';
      const reasonKey = `privatePageReason_${reason.replace('-', '')}`;
      const reasonLabel = chrome.i18n.getMessage(reasonKey) || reason;
      try {
        const notificationId = await encodeUrlSafeBase64(url);
        NotificationHelper.notifyPrivacyConfirm(notificationId, title, reasonLabel);
      } catch (error) {
        await logWarn(
          'Failed to encode URL for notification',
          { error: errorMessage(error) },
          ErrorCode.CRYPTO_HMAC_FAILURE,
          'service-worker',
        );
      }
    }

    if (result.maskedItems && Array.isArray(result.maskedItems)) {
      result.maskedItems = stripPiiFromMaskedItems(result.maskedItems);
    }

    sendResponse(result);
  };
}

export function createFetchUrlHandler(deps: FetchUrlHandlerDeps) {
  return async (
    message: FetchUrlMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    try {
      validateUrlForFilterImport(message.payload.url);

      const settings = await deps.getSettings();
      const allowedUrls = deps.buildAllowedUrls(settings);

      const response = await fetchWithTimeout(message.payload.url, {
        method: 'GET',
        cache: 'no-cache',
        allowedUrls,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      const text = await response.text();

      sendResponse({ success: true, data: text, contentType });
    } catch (error) {
      await logError(
        'Fetch URL Error',
        { url: message.payload?.url, error: errorMessage(error) },
        ErrorCode.API_REQUEST_FAILURE,
        'service-worker',
      );
      sendResponse(createErrorResponse(error, { url: message.payload?.url }));
    }
  };
}

export function createManualRecordHandler(deps: ManualRecordHandlerDeps) {
  return async (
    message: ManualRecordMessage | PreviewRecordMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    if (!(await deps.isRecordingAllowed())) {
      sendResponse({ success: false, reason: 'privacy_consent_required' });
      return;
    }

    let content = message.payload.content;
    const skipAi = message.type === 'MANUAL_RECORD' ? message.payload.skipAi : false;
    const settings = await deps.getSettings();

    if (!isSecureUrl(message.payload.url)) {
      await logWarn(
        'Blocked MANUAL_RECORD with insecure URL',
        { url: message.payload.url, type: message.type },
        undefined,
        'service-worker',
      );
      sendResponse({ success: false, error: 'Insecure URL protocol not allowed' });
      return;
    }

    if (skipAi) {
      const rateLimitResult = await deps.checkRateLimit(sender, settings);
      if (!rateLimitResult.allowed) {
        sendResponse({ success: false, error: rateLimitResult.error });
        return;
      }
    }

    const autoContentFetchEnabled = settings[StorageKeys.AUTO_CONTENT_FETCH_ENABLED] as boolean;
    const sanitizedUrl = sanitizeUrlForLogging(message.payload.url);

    const isGoogleSites = message.payload.url.includes('sites.google.com');
    if (!content && !skipAi) {
      if (isGoogleSites && message.payload.force) {
        await logDebug('Google Sites detected with force flag, skipping content fetch', { url: sanitizedUrl }, 'service-worker');
      } else {
        if (!autoContentFetchEnabled && !message.payload.force) {
          await logDebug(
            'Content fetch disabled (AUTO_CONTENT_FETCH_ENABLED=false)',
            { url: sanitizedUrl },
            'service-worker',
          );
          sendResponse({
            success: true,
            warning: 'Content fetch is disabled. Enable it in settings or provide content directly.',
          });
          return;
        }

        content = await deps.fetchContent(message.payload.url);
      }
    }

    const pipeline = createRecordingPipeline({
      getPrivacyInfoWithCache: deps.getPrivacyInfoWithCache,
      obsidian: deps.obsidian,
      aiService: deps.aiService,
      sqliteClient: deps.sqliteClient,
    });

    const result = await pipeline.execute({
      title: message.payload.title,
      url: message.payload.url,
      content,
      force: message.payload.force,
      skipDuplicateCheck: true,
      previewOnly: message.type === 'PREVIEW_RECORD',
      recordType: 'manual',
      skipAi,
      pageBytes: message.payload.pageBytes,
      candidateBytes: message.payload.candidateBytes,
      originalBytes: message.payload.originalBytes,
      cleansedBytes: message.payload.cleansedBytes,
      aiSummaryOriginalBytes: message.payload.aiSummaryOriginalBytes,
      aiSummaryCleansedBytes: message.payload.aiSummaryCleansedBytes,
      aiSummaryCleansedElements: message.payload.aiSummaryCleansedElements,
      aiSummaryCleansedReason: message.payload.aiSummaryCleansedReason,
      aiSummaryCleansedReasons: message.payload.aiSummaryCleansedReasons,
    }, settings);

    if (result.success) {
      await deps.setUrlContent(message.payload.url, content);
    }

    if (result.maskedItems && Array.isArray(result.maskedItems)) {
      result.maskedItems = stripPiiFromMaskedItems(result.maskedItems);
    }

    sendResponse(result);
  };
}

export function createSaveRecordHandler(deps: SaveRecordHandlerDeps) {
  return async (
    message: SaveRecordMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    if (!(await deps.isRecordingAllowed())) {
      sendResponse({ success: false, reason: 'privacy_consent_required' });
      return;
    }

    const settings = await deps.getSettings();

    const pipeline = createRecordingPipeline({
      getPrivacyInfoWithCache: deps.getPrivacyInfoWithCache,
      obsidian: deps.obsidian,
      aiService: deps.aiService,
      sqliteClient: deps.sqliteClient,
    });

    const result = await pipeline.execute({
      title: message.payload.title,
      url: message.payload.url,
      content: message.payload.content,
      skipDuplicateCheck: true,
      alreadyProcessed: true,
      force: message.payload.force,
      recordType: 'manual',
      maskedCount: message.payload.maskedCount,
      pageBytes: message.payload.pageBytes,
      candidateBytes: message.payload.candidateBytes,
      originalBytes: message.payload.originalBytes,
      cleansedBytes: message.payload.cleansedBytes,
      aiSummaryOriginalBytes: message.payload.aiSummaryOriginalBytes,
      aiSummaryCleansedBytes: message.payload.aiSummaryCleansedBytes,
      aiSummaryCleansedElements: message.payload.aiSummaryCleansedElements,
      aiSummaryCleansedReason: message.payload.aiSummaryCleansedReason,
      aiSummaryCleansedReasons: message.payload.aiSummaryCleansedReasons,
    }, settings);

    if (result.success && message.payload.content) {
      await deps.setUrlContent(message.payload.url, message.payload.content);
    }

    if (result.maskedItems && Array.isArray(result.maskedItems)) {
      result.maskedItems = stripPiiFromMaskedItems(result.maskedItems);
    }

    sendResponse(result);
  };
}

export function createContentCleansingExecutedHandler(deps: ContentCleansingExecutedHandlerDeps) {
  return async (
    message: ContentCleansingExecutedMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    const { hardStripRemoved, keywordStripRemoved, totalRemoved } = message.payload || {};
    const tabId = sender.tab!.id!;

    chrome.action.setBadgeText({ text: `C${totalRemoved || 0}`, tabId });
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.GREEN as string, tabId });

    setTimeout(() => {
      if (!deps.hasBadgeTab(tabId)) {
        chrome.action.setBadgeText({ text: '', tabId });
      }
    }, 3000);

    if (sender.tab?.url && (totalRemoved ?? 0) > 0) {
      const hardEnabled = (hardStripRemoved ?? 0) > 0;
      const keywordEnabled = (keywordStripRemoved ?? 0) > 0;
      let cleansedReason: 'hard' | 'keyword' | 'both' = 'both';
      if (hardEnabled && !keywordEnabled) {
        cleansedReason = 'hard';
      } else if (!hardEnabled && keywordEnabled) {
        cleansedReason = 'keyword';
      }
      await setUrlCleansedReason(sender.tab.url, cleansedReason);
    }

    sendResponse({ success: true });
  };
}

export function createCheckDomainHandler(deps: CheckDomainHandlerDeps) {
  return async (
    _message: CheckDomainMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    const url = sender.tab?.url || '';
    const allowed = url ? await deps.isDomainAllowed(url) : false;
    sendResponse({ success: true, allowed });
  };
}

export function createTestConnectionsHandler(deps: TestConnectionsHandlerDeps) {
  return async (
    _message: TestConnectionsMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    const obsidianResult = await deps.testObsidian();
    const aiResult = await deps.testAi();
    sendResponse({ success: true, obsidian: obsidianResult, ai: aiResult });
  };
}

export function createTestObsidianHandler(deps: TestObsidianHandlerDeps) {
  return async (
    message: TestObsidianMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    const override = message.payload?.apiKey ? { apiKey: message.payload.apiKey } : undefined;
    const obsidianResult = await deps.testConnection(override);
    sendResponse({ success: true, obsidian: obsidianResult });
  };
}

export function createTestAiHandler(deps: TestAiHandlerDeps) {
  return async (
    _message: TestAiMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    deps.clearSettingsCache();
    const aiResult = await deps.testConnection();
    sendResponse({ success: true, ai: aiResult });
  };
}

export function createGetPrivacyCacheHandler(deps: GetPrivacyCacheHandlerDeps) {
  return async (
    _message: GetPrivacyCacheMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    const cache = deps.getPrivacyCache();
    await logDebug('GET_PRIVACY_CACHE requested', { cacheSize: cache?.size || 0 }, 'service-worker');
    if (cache) {
      const cacheArray = Array.from(cache.entries());
      await logDebug('Sending cache entries to popup', { count: cacheArray.length }, 'service-worker');
      sendResponse({ success: true, cache: cacheArray });
    } else {
      await logDebug('No cache available, sending empty array', undefined, 'service-worker');
      sendResponse({ success: true, cache: [] });
    }
  };
}

export function createActivityUpdateHandler(deps: ActivityUpdateHandlerDeps) {
  return async (
    _message: ActivityUpdateMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    await deps.updateActivity();
    sendResponse({ success: true });
  };
}

export function createSessionLockRequestHandler(deps: SessionLockRequestHandlerDeps) {
  return async (
    _message: SessionLockRequestMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    await deps.lockSession();
    sendResponse({ success: true });
  };
}

export function createPingHandler(_deps: PingHandlerDeps) {
  return async (
    _message: PingMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    sendResponse({ success: true });
  };
}

export function createRefreshLocalMarkdownSchedulerHandler(deps: RefreshLocalMarkdownSchedulerHandlerDeps) {
  return async (
    _message: Record<string, unknown>,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    await deps.initExportScheduler();
    sendResponse({ success: true });
  };
}

export function createConsentStateChangedHandler(deps: ConsentStateChangedHandlerDeps) {
  return async (
    _message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ success: false, error: 'CONSENT_STATE_CHANGED is not allowed from external extensions' });
      return;
    }
    await deps.updateConsentBadge();
    sendResponse({ success: true });
  };
}
