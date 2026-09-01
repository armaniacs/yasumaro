import type { RecordingData, RecordingResult } from '../../messaging/types.js';
import type { TabData } from '../tabCache.js';
import type { Settings } from '../../utils/storage/types.js';
import { isSecureUrl, sanitizeUrlForLogging } from '../../utils/urlUtils.js';
import { BADGE_COLORS } from '../../constants/appConstants.js';
import { logDebug, logWarn, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { encodeUrlSafeBase64 } from './urlNotificationHandlers.js';
import { NotificationHelper } from '../notificationHelper.js';
import type { MessageSenderLike } from '../rateLimiter.js';
import type { RecordOptions } from '../pipeline/RecordingOrchestrator.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { visitRateLimiter } from '../visitRateLimiter.js';

import type {
  ValidVisitMessage,
  ManualRecordMessage,
  PreviewRecordMessage,
  SaveRecordMessage,
} from '../messageTypes.js';

/** The recording surface the handlers need: one method, explicit settings. */
export interface RecordingRunner {
  record(data: RecordingData, opts?: RecordOptions): Promise<RecordingResult>;
}

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

/**
 * Behaviour shared by the recording handlers (MANUAL_RECORD/PREVIEW_RECORD and
 * SAVE_RECORD). Kept to what the handlers actually invoke (deep-dig 子PBI 4):
 * adding a collaborator to one handler must not force it onto the other.
 */
export interface RecordingHandlerBaseDeps {
  isRecordingAllowed: () => Promise<boolean>;
  /**
   * Injected by the composition root. The handler never constructs the
   * orchestrator itself; a missing runner is a wiring error, not a fallback.
   */
  recordingPipeline: RecordingRunner;
  getSettings: () => Promise<Settings>;
  setUrlContent: (url: string, content: string) => Promise<void>;
}

export interface ManualRecordHandlerDeps extends RecordingHandlerBaseDeps {
  checkRateLimit: (sender: MessageSenderLike | undefined, settings: Record<string, unknown>) => Promise<{ allowed: boolean; error?: string }>;
  fetchContent: (url: string) => Promise<string>;
}

export interface SaveRecordHandlerDeps extends RecordingHandlerBaseDeps {}

// ============================================================================
// Factory functions
// ============================================================================

// ----------------------------------------------------------------------------
// VALID_VISIT per-URL rate limiting
//
// Delegates to the VisitRateLimiter instance (see ../visitRateLimiter.ts).
// The instance keeps the flood guard injectable and testable in isolation
// instead of a raw module-level Map here.
// ----------------------------------------------------------------------------

/** Exported for unit tests; used internally by the VALID_VISIT handler. */
export function isRateLimitedVisit(url: string): boolean {
    return visitRateLimiter.isRateLimited(url);
}

/** Clear all tracked rate-limit entries (used by tests). */
export function resetVisitRateLimiter(): void {
    visitRateLimiter.reset();
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
      ...pickDefined({
        pageBytes: message.payload?.pageBytes,
        candidateBytes: message.payload?.candidateBytes,
        originalBytes: message.payload?.originalBytes,
        cleansedBytes: message.payload?.cleansedBytes,
        aiSummaryOriginalBytes: message.payload?.aiSummaryOriginalBytes,
        aiSummaryCleansedBytes: message.payload?.aiSummaryCleansedBytes,
        aiSummaryCleansedElements: message.payload?.aiSummaryCleansedElements,
        aiSummaryCleansedReason: message.payload?.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: message.payload?.aiSummaryCleansedReasons,
      }),
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
      chrome.action.setBadgeText({ text: '◎', tabId: savedTabId });
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

    sendResponse(result);
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

    const senderLike: MessageSenderLike = {
      ...pickDefined({
        url: sender.url,
        tab: sender.tab ? pickDefined({ id: sender.tab.id }) : undefined,
      }),
    };
    const rateLimitResult = await deps.checkRateLimit(senderLike, settings);
    if (!rateLimitResult.allowed) {
      sendResponse({ success: false, error: rateLimitResult.error });
      return;
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

    const result = await pipeline.record({
      title: message.payload.title,
      url: message.payload.url,
      content,
      skipDuplicateCheck: true,
      previewOnly: message.type === 'PREVIEW_RECORD',
      recordType: 'manual',
      ...pickDefined({
        skipAi,
        force: message.payload.force,
        pageBytes: message.payload.pageBytes,
        candidateBytes: message.payload.candidateBytes,
        originalBytes: message.payload.originalBytes,
        cleansedBytes: message.payload.cleansedBytes,
        aiSummaryOriginalBytes: message.payload.aiSummaryOriginalBytes,
        aiSummaryCleansedBytes: message.payload.aiSummaryCleansedBytes,
        aiSummaryCleansedElements: message.payload.aiSummaryCleansedElements,
        aiSummaryCleansedReason: message.payload.aiSummaryCleansedReason,
        aiSummaryCleansedReasons: message.payload.aiSummaryCleansedReasons,
      }),
    }, { settings });

    if (result.success) {
      await deps.setUrlContent(message.payload.url, content);
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

    const result = await pipeline.record({
      title: message.payload.title,
      url: message.payload.url,
      content: message.payload.content,
      skipDuplicateCheck: true,
      alreadyProcessed: true,
      recordType: 'manual',
      ...pickDefined({
        force: message.payload.force,
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
      }),
    }, { settings });

    if (result.success && message.payload.content) {
      await deps.setUrlContent(message.payload.url, message.payload.content);
    }

    sendResponse(result);
  };
}
