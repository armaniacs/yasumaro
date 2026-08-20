// @layer 2 — Deep module hiding 19 handler registrations + trust/validator tables
/**
 * MessageRouter — deep module hiding the 19 handler shallow registry
 *
 * createMessageHandlerRegistry exposes register(type, handler, trust, validator) with
 * 19 types × trust × validator combinations. Callers must know which trust level
 * each type needs and which validator to attach. The true bug surface is policy
 * leakage (e.g., VALID_VISIT is content-script-allowed but DASHBOARD_SQLITE is
 * extension-only) — a new handler added without trust is a vulnerability.
 *
 * MessageRouter collapses this behind one seam: dispatch(msg, sender) → Response.
 * trust and validator tables are internal, derived from a single source of truth.
 * Callers learn one method; adding a handler is one place, not 19.
 *
 * Deletion test: deleting MessageRouter forces 19 register() calls to reappear
 * across callers. Deleting the shallow registry (a Map put) only moves one line.
 */

import { checkSenderTrust } from './senderTrust.js';
import {
  createValidVisitHandler,
  createManualRecordHandler,
  createSaveRecordHandler,
} from './recordingHandlers.js';
import {
  createTestConnectionsHandler,
  createTestObsidianHandler,
  createTestAiHandler,
} from './testingHandlers.js';
import {
  createFetchUrlHandler,
  createContentCleansingExecutedHandler,
  createCheckDomainHandler,
  createGetPrivacyCacheHandler,
  createActivityUpdateHandler,
  createSessionLockRequestHandler,
  createPingHandler,
  createRefreshLocalMarkdownSchedulerHandler,
  createConsentStateChangedHandler,
  createGenerateReviewSummaryHandler,
  createLogForwardHandler,
} from './systemHandlers.js';
import {
  validVisitValidator,
  dashboardSqliteValidator,
  fetchUrlValidator,
  manualRecordValidator,
  checkDomainValidator,
  contentCleansingExecutedValidator,
} from '../../messaging/validators.js';
import type { MessageHandlerRegistryDeps } from './createMessageHandlerRegistry.js';
import type { MessageHandler } from './MessageHandlerRegistry.js';
import type { MessageValidator } from '../../messaging/validators.js';

export class MessageRouter {
  private handlers = new Map<string, MessageHandler>();
  private trustLevels = new Map<string, 'extension-only' | 'content-script-allowed'>();
  private validators = new Map<string, MessageValidator<unknown>>();
  private runtimeId: string | undefined;

  constructor(deps: MessageHandlerRegistryDeps) {
    this.runtimeId = deps.runtimeId ?? (typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined);

    // — Deep implementation: 19 handlers + trust table + 8 validators are all hidden behind the seam —
    const validVisitPick = {
      hasPrivacyConsent: deps.hasPrivacyConsent,
      tabCache: deps.tabCache,
      recordingPipeline: deps.recordingPipeline,
      autoSavedBadgeTabs: deps.autoSavedBadgeTabs,
    };
    const fetchUrlPick = {
      getSettings: deps.getSettings,
      buildAllowedUrls: deps.buildAllowedUrls,
    };
    const checkDomainPick = {
      isDomainAllowed: deps.isDomainAllowed,
    };

    const handlers: Record<string, MessageHandler> = {
      VALID_VISIT: createValidVisitHandler({
        isRecordingAllowed: validVisitPick.hasPrivacyConsent,
        cacheTab: validVisitPick.tabCache.add.bind(validVisitPick.tabCache),
        updateCachedTab: validVisitPick.tabCache.update.bind(validVisitPick.tabCache),
        recordVisit: (data) => validVisitPick.recordingPipeline.record(data),
        addBadgeTab: (tabId) => validVisitPick.autoSavedBadgeTabs.add(tabId),
        hasBadgeTab: (tabId) => validVisitPick.autoSavedBadgeTabs.has(tabId),
      }),
      FETCH_URL: createFetchUrlHandler({ getSettings: fetchUrlPick.getSettings, buildAllowedUrls: fetchUrlPick.buildAllowedUrls }),
      MANUAL_RECORD: createManualRecordHandler(deps.manualRecordDeps),
      PREVIEW_RECORD: createManualRecordHandler(deps.manualRecordDeps),
      SAVE_RECORD: createSaveRecordHandler(deps.saveRecordDeps),
      CONTENT_CLEANSING_EXECUTED: createContentCleansingExecutedHandler({ hasBadgeTab: (tabId) => deps.autoSavedBadgeTabs.has(tabId) }),
      CHECK_DOMAIN: createCheckDomainHandler({ isDomainAllowed: checkDomainPick.isDomainAllowed }),
      TEST_CONNECTIONS: createTestConnectionsHandler({
        testObsidian: () => deps.obsidian.testConnection(),
        testAi: () => deps.aiService.testConnection(),
      }),
      TEST_OBSIDIAN: createTestObsidianHandler({ testConnection: (override) => deps.obsidian.testConnection(override) }),
      TEST_AI: createTestAiHandler({
        clearSettingsCache: deps.clearSettingsCache,
        testConnection: (onProgress, runId) => deps.aiService.testConnection(onProgress, runId),
        notifyProgress: deps.notifyAiTestProgress,
      }),
      GET_PRIVACY_CACHE: createGetPrivacyCacheHandler({ getPrivacyCache: deps.getPrivacyCache }),
      ACTIVITY_UPDATE: createActivityUpdateHandler({ updateActivity: deps.updateActivity }),
      SESSION_LOCK_REQUEST: createSessionLockRequestHandler({ lockSession: deps.lockSession }),
      PING: createPingHandler({}),
      REFRESH_LOCAL_MARKDOWN_SCHEDULER: createRefreshLocalMarkdownSchedulerHandler({ initExportScheduler: deps.initExportScheduler }),
      CONSENT_STATE_CHANGED: createConsentStateChangedHandler({ updateConsentBadge: deps.updateConsentBadge }),
      GENERATE_REVIEW_SUMMARY: createGenerateReviewSummaryHandler({
        generateWeeklySummary: deps.generateWeeklySummary,
        generateMonthlySummary: deps.generateMonthlySummary,
      }),
      LOG_FORWARD: createLogForwardHandler(),
      DASHBOARD_SQLITE: deps.dashboardSqliteHandler,
    };

    const contentScriptAllowed = new Set(['VALID_VISIT', 'CONTENT_CLEANSING_EXECUTED', 'CHECK_DOMAIN', 'PING']);
    for (const [type, handler] of Object.entries(handlers)) {
      this.handlers.set(type, handler);
      this.trustLevels.set(type, contentScriptAllowed.has(type) ? 'content-script-allowed' : 'extension-only');
    }

    this.validators.set('VALID_VISIT', validVisitValidator as unknown as MessageValidator<unknown>);
    this.validators.set('DASHBOARD_SQLITE', dashboardSqliteValidator as unknown as MessageValidator<unknown>);
    this.validators.set('FETCH_URL', fetchUrlValidator as unknown as MessageValidator<unknown>);
    this.validators.set('MANUAL_RECORD', manualRecordValidator as unknown as MessageValidator<unknown>);
    this.validators.set('PREVIEW_RECORD', manualRecordValidator as unknown as MessageValidator<unknown>);
    this.validators.set('SAVE_RECORD', manualRecordValidator as unknown as MessageValidator<unknown>);
    this.validators.set('CHECK_DOMAIN', checkDomainValidator as unknown as MessageValidator<unknown>);
    this.validators.set('CONTENT_CLEANSING_EXECUTED', contentCleansingExecutedValidator as unknown as MessageValidator<unknown>);
  }

  /**
   * Deep seam: one method hides 19 handlers + trust table + 8 validators
   * Returns true if the message was handled (async response), false otherwise.
   */
  dispatch(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean {
    const type = (message as { type?: string })?.type;
    if (typeof type !== 'string') {
      sendResponse({ success: false, error: 'Missing message type' });
      return false;
    }
    const handler = this.handlers.get(type);
    if (!handler) {
      return false;
    }
    const trust = this.trustLevels.get(type)!;
    const decision = checkSenderTrust(sender, trust, type, this.runtimeId);
    if (!decision.allowed) {
      sendResponse({ success: false, error: decision.error });
      return false;
    }
    const validator = this.validators.get(type);
    if (validator) {
      try {
        validator.validate(message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ success: false, error: msg });
        return false;
      }
    }
    Promise.resolve(handler(message, sender, sendResponse)).catch((err) => {
      sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }

  /** For tests: expose handler count via the seam */
  getHandlerCount(): number {
    return this.handlers.size;
  }
}

/**
 * Factory for the deep module — hides the 19 handler wiring.
 * Two adapters justify the seam: prod deps vs InMemory test deps.
 */
export function createMessageRouter(deps: MessageHandlerRegistryDeps): MessageRouter {
  return new MessageRouter(deps);
}
