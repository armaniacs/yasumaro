/**
 * messageHandler.ts
 * Extracted from service-worker.ts (PBI-05).
 * Creates the chrome.runtime.onMessage handler that validates messages
 * and dispatches to the registry.
 */

import { logWarn, logError, ErrorCode } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { createErrorResponse } from '../utils/errorClassification.js';
import { checkEnvelope } from './handlers/envelopePolicy.js';
import type { MessageRouter } from './handlers/MessageRouter.js';
import type { TabCache } from './tabCache.js';

export interface MessageHandlerDeps {
  router: MessageRouter;
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
                // Envelope policy (shape + version + migration-skip + sender
                // special-cases) lives in one ordered pipeline; trust +
                // handler lookup stay in the router dispatch seam.
                const outcome = await checkEnvelope(rawMessage, sender, {
                    runDeferredStartupMigrations: deps.runDeferredStartupMigrations,
                    initializeTabCache: () => deps.tabCache.initialize(),
                });
                if (!outcome.accepted) {
                    if (outcome.versionMismatch) {
                        logWarn(
                            'Protocol version mismatch - message rejected',
                            outcome.versionMismatch,
                            ErrorCode.INTERNAL_ERROR,
                            'service-worker'
                        );
                    }
                    sendResponse(outcome.response);
                    return;
                }

                // Graded migration window: a deprecated (N-1) version is still
                // dispatched, but the acceptance is warned and flagged so
                // callers can see the sender needs an update. The flag is
                // merged into object responses only — security validations
                // downstream run unchanged.
                let respond = sendResponse;
                if (outcome.deprecated) {
                    logWarn(
                        'Protocol version deprecated - message accepted with migration warning',
                        outcome.deprecated,
                        ErrorCode.INTERNAL_ERROR,
                        'service-worker'
                    );
                    const inner = sendResponse;
                    respond = (response?: unknown) => {
                        if (response && typeof response === 'object' && !Array.isArray(response)) {
                            inner({ ...(response as Record<string, unknown>), deprecated: true });
                        } else {
                            inner(response);
                        }
                    };
                }

                // Single dispatch seam: MessageRouter hides the 19 handler table,
                // trust levels, and validators behind one method.
                return deps.router.dispatch(outcome.message, sender, respond);
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
