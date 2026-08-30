import type { Settings } from '../../utils/storage/types.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../../utils/fetch.js';
import { BADGE_COLORS } from '../../constants/appConstants.js';
import { logDebug, logWarn, logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { createErrorResponse } from '../../utils/errorClassification.js';
import { updateSavedUrlEntry } from '../../utils/storage/savedUrlRepository.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';

import type {
  FetchUrlMessage,
  ContentCleansingExecutedMessage,
  CheckDomainMessage,
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

export interface FetchUrlHandlerDeps {
  getSettings: () => Promise<Settings>;
  buildAllowedUrls: (settings: Settings) => Set<string>;
}

export interface ContentCleansingExecutedHandlerDeps {
  hasBadgeTab: (tabId: number) => boolean;
}

export interface CheckDomainHandlerDeps {
  isDomainAllowed: (url: string) => Promise<boolean>;
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

      // VULN-016 (CWE-918): validateUrlForFilterImport only checks the initial
      // URL. With the browser default `redirect: 'follow'`, an allow-listed URL
      // could 30x-redirect to a private address (e.g. http://127.0.0.1:9222)
      // and the SW would fetch + return the internal response. We use
      // `redirect: 'error'` here so any redirect aborts the request.
      //
      // Decision: `redirect: 'error'` (not `manual` + per-hop re-validation).
      // All known filter-list sources are fixed HTTPS hosts and none rely on
      // http->https or mirror redirects, so the stricter policy costs nothing.
      // See dev-docs/ADR/2026-08-29-fetch-redirect-policy.md. If a future source
      // needs redirects, switch to fetchWithRedirectGuard() from utils/fetch.ts.
      const response = await fetchWithTimeout(message.payload.url, {
        method: 'GET',
        cache: 'no-cache',
        redirect: 'error',
        allowedUrls,
      });

      // Defense in depth: `redirect: 'error'` should already have rejected, but
      // never hand back a body whose response was redirected.
      if (response.redirected) {
        throw new Error('Redirected responses are not allowed for filter list imports');
      }

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
