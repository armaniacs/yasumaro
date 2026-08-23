import type { Settings } from '../../utils/storage/types.js';
import { validateUrlForFilterImport, fetchWithTimeout } from '../../utils/fetch.js';
import { BADGE_COLORS } from '../../constants/appConstants.js';
import { logError, ErrorCode } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { createErrorResponse } from '../../utils/errorClassification.js';
import { updateSavedUrlEntry } from '../../utils/storage/savedUrlRepository.js';

import type {
  FetchUrlMessage,
  ContentCleansingExecutedMessage,
  CheckDomainMessage,
} from '../messageTypes.js';

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

export function createFetchUrlHandler(deps: FetchUrlHandlerDeps) {
  const MAX_FILTER_LIST_SIZE = 10 * 1024 * 1024;

  return async (
    message: FetchUrlMessage,
    sender: chrome.runtime.MessageSender,
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

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_FILTER_LIST_SIZE) {
        throw new Error(`Filter list too large: ${Math.round(parseInt(contentLength, 10) / 1024 / 1024)}MB exceeds ${MAX_FILTER_LIST_SIZE / 1024 / 1024}MB limit`);
      }

      const contentType = response.headers.get('content-type');
      const text = await response.text();

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
