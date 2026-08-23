import { logDebug } from '../../utils/logger.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';

import type {
  GetPrivacyCacheMessage,
  ActivityUpdateMessage,
  SessionLockRequestMessage,
  PingMessage,
} from '../messageTypes.js';

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

export function createGetPrivacyCacheHandler(deps: GetPrivacyCacheHandlerDeps) {
  return async (
    _message: GetPrivacyCacheMessage,
    sender: chrome.runtime.MessageSender,
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
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
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
