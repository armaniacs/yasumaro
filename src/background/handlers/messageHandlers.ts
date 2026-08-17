import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { TabData } from '../tabCache.js';
import type { Settings } from '../../utils/storage.js';
import { isSecureUrl, sanitizeUrlForLogging } from '../../utils/urlUtils.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../../utils/fetch.js';
import { BADGE_COLORS } from '../../constants/appConstants.js';
import { logDebug, logWarn, logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { createErrorResponse } from '../../utils/errorMessages.js';
import { StorageKeys } from '../../utils/storage.js';
import { updateSavedUrlEntry } from '../../utils/storage/savedUrlStore.js';
import { stripPiiFromMaskedItems } from '../../utils/piiStripper.js';
import { encodeUrlSafeBase64 } from './urlNotificationHandlers.js';
import { NotificationHelper } from '../notificationHelper.js';
import type { MessageSenderLike } from '../rateLimiter.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import type { RecordingPipeline } from '../pipeline/RecordingPipeline.js';
import type { AiTestProgress } from '../ai/AIService.js';

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
  GenerateReviewSummaryMessage,
  LogForwardMessage,
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

/**
 * Behaviour shared by the recording handlers (MANUAL_RECORD/PREVIEW_RECORD and
 * SAVE_RECORD). Kept to what the handlers actually invoke (deep-dig 子PBI 4):
 * adding a collaborator to one handler must not force it onto the other.
 */
export interface RecordingHandlerBaseDeps {
  isRecordingAllowed: () => Promise<boolean>;
  /**
   * Injected by the composition root. The handler never constructs a pipeline
   * itself; a missing pipeline is a wiring error, not a fallback path.
   */
  recordingPipeline: RecordingPipeline;
  getSettings: () => Promise<Settings>;
  setUrlContent: (url: string, content: string) => Promise<void>;
}

export interface ManualRecordHandlerDeps extends RecordingHandlerBaseDeps {
  checkRateLimit: (sender: MessageSenderLike | undefined, settings: Record<string, unknown>) => Promise<{ allowed: boolean; error?: string }>;
  fetchContent: (url: string) => Promise<string>;
}

export interface SaveRecordHandlerDeps extends RecordingHandlerBaseDeps {}

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
  testConnection: (onProgress?: (progress: AiTestProgress) => void, runId?: string) => Promise<unknown>;
  notifyProgress?: (progress: AiTestProgress) => void;
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

export interface GenerateReviewSummaryHandlerDeps {
  generateWeeklySummary: () => Promise<boolean>;
  generateMonthlySummary: () => Promise<boolean>;
}

// ============================================================================
// Factory functions
// ============================================================================

// ----------------------------------------------------------------------------
// VALID_VISIT per-URL rate limiting
//
// In-memory, module-level so entries survive across handler invocations within
// a single Service Worker lifetime. Prevents a hostile page from flooding
// VALID_VISIT messages to drive up AI processing costs.
// ----------------------------------------------------------------------------
const visitRateLimiter = new Map<string, number>();
const VISIT_RATE_LIMIT_MS = 5000;
const VISIT_RATE_LIMIT_MAX_ENTRIES = 1000;

/**
 * VULN-002: derive the rate-limit key from the URL's origin so a hostile page
 * cannot bypass the throttle by rotating the path/fragment/query (pushState
 * only changes same-origin path/fragment). Different registrable hosts still
 * get distinct keys.
 */
function getRateLimitKey(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    // Invalid URL: fall back to the raw string so it is still throttled.
    return url;
  }
}

function isRateLimitedVisit(url: string): boolean {
    const now = Date.now();
    const key = getRateLimitKey(url);
    const last = visitRateLimiter.get(key);
    if (last !== undefined && now - last < VISIT_RATE_LIMIT_MS) return true;
    visitRateLimiter.set(key, now);
    // Guard against unbounded growth: evict the oldest tracked URL when the
    // cap is exceeded (Map preserves insertion order).
    if (visitRateLimiter.size > VISIT_RATE_LIMIT_MAX_ENTRIES) {
        const oldestKey = visitRateLimiter.keys().next().value as string | undefined;
        if (oldestKey !== undefined) visitRateLimiter.delete(oldestKey);
    }
    return false;
}

/** Clear all tracked rate-limit entries (used by tests). */
export function resetVisitRateLimiter(): void {
    visitRateLimiter.clear();
}

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

    if (sender.tab.url && isRateLimitedVisit(sender.tab.url)) {
      sendResponse({ success: false, reason: 'rate_limited' });
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
  // VULN-012 fix: limit response size to prevent memory exhaustion
  const MAX_FILTER_LIST_SIZE = 10 * 1024 * 1024; // 10MB

  return async (
    message: FetchUrlMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-004: FETCH_URL is an extension-page operation, not a content-script
    // one. Enforced by the registry's 'extension-only' trust level.
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

      // VULN-012 fix: check Content-Length header first
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_FILTER_LIST_SIZE) {
        throw new Error(`Filter list too large: ${Math.round(parseInt(contentLength, 10) / 1024 / 1024)}MB exceeds ${MAX_FILTER_LIST_SIZE / 1024 / 1024}MB limit`);
      }

      const contentType = response.headers.get('content-type');
      const text = await response.text();

      // VULN-012 fix: also check actual text size after reading
      if (text.length > MAX_FILTER_LIST_SIZE) {
        throw new Error(`Filter list too large: ${Math.round(text.length / 1024 / 1024)}MB exceeds ${MAX_FILTER_LIST_SIZE / 1024 / 1024}MB limit`);
      }

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
    // VULN-004: MANUAL_RECORD/PREVIEW_RECORD are extension-page operations.
    // Enforced by the registry's 'extension-only' trust level.
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

    const pipeline = deps.recordingPipeline;

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
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-004: SAVE_RECORD is an extension-page operation.
    // Enforced by the registry's 'extension-only' trust level.
    if (!(await deps.isRecordingAllowed())) {
      sendResponse({ success: false, reason: 'privacy_consent_required' });
      return;
    }

    // VULN-004 fix: validate URL scheme before processing (same as MANUAL_RECORD)
    if (!isSecureUrl(message.payload.url)) {
      await logWarn(
        'Blocked SAVE_RECORD with insecure URL',
        { url: message.payload.url },
        undefined,
        'service-worker',
      );
      sendResponse({ success: false, error: 'Insecure URL protocol not allowed' });
      return;
    }

    const settings = await deps.getSettings();

    const pipeline = deps.recordingPipeline;

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
      await updateSavedUrlEntry(sender.tab.url, (entry) => ({ ...entry, cleansedReason }));
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
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-009: TEST_* are extension-page operations.
    // Enforced by the registry's 'extension-only' trust level.
    const obsidianResult = await deps.testObsidian();
    const aiResult = await deps.testAi();
    sendResponse({ success: true, obsidian: obsidianResult, ai: aiResult });
  };
}

export function createTestObsidianHandler(deps: TestObsidianHandlerDeps) {
  return async (
    message: TestObsidianMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-009: content-script senders must not reach the apiKey override.
    // Enforced by the registry's 'extension-only' trust level.
    const override = message.payload?.apiKey ? { apiKey: message.payload.apiKey } : undefined;
    const obsidianResult = await deps.testConnection(override);
    sendResponse({ success: true, obsidian: obsidianResult });
  };
}

export function createTestAiHandler(deps: TestAiHandlerDeps) {
  return async (
    message: TestAiMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-009: this handler clears the settings cache, so content-script
    // senders must not reach it. Enforced by the registry's 'extension-only'
    // trust level.
    deps.clearSettingsCache();
    const aiResult = await deps.testConnection(deps.notifyProgress, message.runId);
    sendResponse({ success: true, ai: aiResult });
  };
}

export function createGetPrivacyCacheHandler(deps: GetPrivacyCacheHandlerDeps) {
  return async (
    _message: GetPrivacyCacheMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-018: privacy-cache disclosure must be extension-page only.
    // Enforced by the registry's 'extension-only' trust level.
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
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-019: activity refresh (auto-lock suppression) must be extension-page
    // only. Enforced by the registry's 'extension-only' trust level.
    await deps.updateActivity();
    sendResponse({ success: true });
  };
}

export function createSessionLockRequestHandler(deps: SessionLockRequestHandlerDeps) {
  return async (
    _message: SessionLockRequestMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // VULN-020: forced session lock (local DoS) must be extension-page only.
    // Enforced by the registry's 'extension-only' trust level.
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
    // Sender authorization is enforced by the registry ('extension-only').
    await deps.updateConsentBadge();
    sendResponse({ success: true });
  };
}

export function createLogForwardHandler() {
  return async (
    message: LogForwardMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // Sender authorization is enforced by the registry ('extension-only'); the
    // offscreen document is the expected caller.
    const { level, message: logMessage, details, source } = message.payload;
    if (level === 'error') {
      await logError(logMessage, details ?? {}, ErrorCode.INTERNAL_ERROR, source);
    } else if (level === 'warn') {
      await logWarn(logMessage, details ?? {}, undefined, source);
    } else {
      await logDebug(logMessage, details ?? {}, source);
    }
    sendResponse({ success: true });
  };
}

export function createGenerateReviewSummaryHandler(deps: GenerateReviewSummaryHandlerDeps) {
  return async (
    message: GenerateReviewSummaryMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // Sender authorization is enforced by the registry ('extension-only').
    try {
      const periodType = message.payload?.periodType;
      const generated = periodType === 'monthly'
        ? await deps.generateMonthlySummary()
        : await deps.generateWeeklySummary();
      sendResponse({ success: true, generated });
    } catch (error) {
      sendResponse(createErrorResponse(error));
    }
  };
}
