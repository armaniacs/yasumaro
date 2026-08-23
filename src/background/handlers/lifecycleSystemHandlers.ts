import { logDebug, logWarn, logError, ErrorCode } from '../../utils/logger.js';
import { createErrorResponse } from '../../utils/errorClassification.js';

import type {
  GenerateReviewSummaryMessage,
  LogForwardMessage,
} from '../messageTypes.js';

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
