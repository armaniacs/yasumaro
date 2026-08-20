/**
 * messageHandler.ts
 * Extracted from service-worker.ts (PBI-05).
 * Creates the chrome.runtime.onMessage handler that validates messages
 * and dispatches to the registry.
 */

import { logWarn, logError, ErrorCode } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { createErrorResponse } from '../utils/errorClassification.js';
import {
    VALID_MESSAGE_TYPES,
    CONTENT_SCRIPT_ONLY_TYPES,
    NO_PAYLOAD_TYPES,
    CURRENT_PROTOCOL_VERSION,
} from './messageTypes.js';
import type { ExtensionMessage } from './messageTypes.js';
import type { MessageHandlerRegistry } from './handlers/MessageHandlerRegistry.js';
import type { MessageRouter } from './handlers/MessageRouter.js';
import type { TabCache } from './tabCache.js';

const INVALID_SENDER_ERROR = { success: false, error: 'Invalid sender' };
const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };

function isValidContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
    if (!sender.tab || !sender.tab.id || !sender.tab.url) return false;
    const senderUrl = sender.url;
    if (!senderUrl) return false;
    return senderUrl.startsWith('http://') || senderUrl.startsWith('https://');
}

export interface MessageHandlerDeps {
  registry: MessageHandlerRegistry;
  router?: MessageRouter;
  tabCache: TabCache;
  isCacheInitialized: { restore: () => Promise<void> };
  autoSavedBadgeTabs: { restore: () => Promise<void> };
  runDeferredStartupMigrations: () => Promise<void>;
}

export function createMessageHandler(deps: MessageHandlerDeps): (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
) => boolean {
    return (rawMessage: unknown, sender, sendResponse) => {
        const process = async () => {
            await Promise.all([deps.isCacheInitialized.restore(), deps.autoSavedBadgeTabs.restore()]);

            try {
                if (!rawMessage || typeof rawMessage !== 'object') {
                    sendResponse(INVALID_MESSAGE_ERROR);
                    return;
                }
                const msg = rawMessage as Record<string, unknown>;
                if (typeof msg.type !== 'string' || !VALID_MESSAGE_TYPES.includes(msg.type as typeof VALID_MESSAGE_TYPES[number])) {
                    sendResponse(INVALID_MESSAGE_ERROR);
                    return;
                }
                if (!NO_PAYLOAD_TYPES.includes(msg.type as typeof NO_PAYLOAD_TYPES[number])) {
                    if (msg.payload === undefined || typeof msg.payload !== 'object') {
                        sendResponse(INVALID_MESSAGE_ERROR);
                        return;
                    }
                }

                if (msg.protocolVersion !== undefined && msg.protocolVersion !== CURRENT_PROTOCOL_VERSION) {
                    logWarn(
                        'Protocol version mismatch - message rejected',
                        { expected: CURRENT_PROTOCOL_VERSION, actual: msg.protocolVersion, type: msg.type },
                        ErrorCode.INTERNAL_ERROR,
                        'service-worker'
                    );
                    sendResponse({ success: false, error: 'Protocol version mismatch' } as never);
                    return;
                }

                const message = rawMessage as ExtensionMessage;

                if (CONTENT_SCRIPT_ONLY_TYPES.includes(message.type as typeof CONTENT_SCRIPT_ONLY_TYPES[number])) {
                    if (!isValidContentScriptSender(sender)) {
                        sendResponse(INVALID_SENDER_ERROR);
                        return;
                    }
                }

                if (message.type !== 'TEST_CONNECTIONS' && message.type !== 'TEST_OBSIDIAN' && message.type !== 'TEST_AI' && message.type !== 'CHECK_DOMAIN') {
                    await deps.runDeferredStartupMigrations();
                    await deps.tabCache.initialize();
                }

                if (message.type === 'CONTENT_CLEANSING_EXECUTED' && !sender.tab?.id) {
                    sendResponse(null);
                    return;
                }

                // Deep module: prefer MessageRouter's single dispatch seam when available
                if (deps.router) {
                    return deps.router.dispatch(msg, sender, sendResponse);
                }
                return deps.registry.dispatch(msg.type as string, msg, sender, sendResponse);
            } catch (error) {
                logError(
                    'Service Worker Error',
                    { error: errorMessage(error) },
                    ErrorCode.INTERNAL_ERROR,
                    'service-worker'
                );
                sendResponse(createErrorResponse(error));
                return;
            }
        };

        process();
        return true;
    };
}
