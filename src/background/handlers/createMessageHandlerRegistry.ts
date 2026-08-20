import { MessageHandlerRegistry, type MessageHandler } from './MessageHandlerRegistry.js';
import {
  createValidVisitHandler,
  createManualRecordHandler,
  createSaveRecordHandler,
} from './recordingHandlers.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from './recordingHandlers.js';
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
import type { RecordingPipeline } from '../pipeline/RecordingPipeline.js';
import type { TabCache } from '../tabCache.js';
import type { AIService, AiTestProgress } from '../ai/AIService.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { Settings } from '../../utils/storage/types.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import {
  validVisitValidator,
  dashboardSqliteValidator,
  fetchUrlValidator,
  manualRecordValidator,
  checkDomainValidator,
  contentCleansingExecutedValidator,
} from '../../messaging/validators.js';

export interface CommonHandlerDeps {
  runtimeId?: string;
  dashboardSqliteHandler: MessageHandler;
}

export interface RecordingHandlerDeps {
  recordingPipeline: Pick<RecordingPipeline, 'record'>;
  tabCache: Pick<TabCache, 'add' | 'update'>;
  hasPrivacyConsent: () => Promise<boolean>;
  autoSavedBadgeTabs: {
    add(tabId: number): void;
    has(tabId: number): boolean;
  };
  manualRecordDeps: ManualRecordHandlerDeps;
  saveRecordDeps: SaveRecordHandlerDeps;
}

export interface TestingHandlerDeps {
  obsidian: Pick<ObsidianClient, 'testConnection'>;
  aiService: Pick<AIService, 'testConnection'>;
  clearSettingsCache: () => void;
  notifyAiTestProgress: (progress: AiTestProgress) => void;
}

export interface SystemHandlerDeps {
  buildAllowedUrls: (settings: Settings) => Set<string>;
  getSettings: () => Promise<Settings>;
  isDomainAllowed: (url: string) => Promise<boolean>;
  getPrivacyCache: () => Map<string, PrivacyInfo> | null;
  autoSavedBadgeTabs: {
    add(tabId: number): void;
    has(tabId: number): boolean;
  };
}

export interface LifecycleHandlerDeps {
  updateActivity: () => Promise<void>;
  lockSession: () => Promise<void>;
  initExportScheduler: () => Promise<void>;
  updateConsentBadge: () => Promise<void>;
  generateWeeklySummary: () => Promise<boolean>;
  generateMonthlySummary: () => Promise<boolean>;
}

export type MessageHandlerRegistryDeps =
  CommonHandlerDeps &
  RecordingHandlerDeps &
  TestingHandlerDeps &
  SystemHandlerDeps &
  LifecycleHandlerDeps;

export interface MessageHandlerRegistryComposition {
  registry: MessageHandlerRegistry;
  handlers: Record<string, MessageHandler>;
  trustLevels: Record<string, 'extension-only' | 'content-script-allowed'>;
}

export function createMessageHandlerRegistry(deps: MessageHandlerRegistryDeps): MessageHandlerRegistryComposition {
  const registry = new MessageHandlerRegistry(deps.runtimeId);
  // PBI#04: Each factory receives a Pick<>-narrowed slice — the registry deps
  // object is destructured into minimal views before forwarding.
  const validVisitPick: Pick<MessageHandlerRegistryDeps, 'hasPrivacyConsent' | 'tabCache' | 'recordingPipeline' | 'autoSavedBadgeTabs'> = {
    hasPrivacyConsent: deps.hasPrivacyConsent,
    tabCache: deps.tabCache,
    recordingPipeline: deps.recordingPipeline,
    autoSavedBadgeTabs: deps.autoSavedBadgeTabs,
  };
  const fetchUrlPick: Pick<MessageHandlerRegistryDeps, 'getSettings' | 'buildAllowedUrls'> = {
    getSettings: deps.getSettings,
    buildAllowedUrls: deps.buildAllowedUrls,
  };
  const checkDomainPick: Pick<MessageHandlerRegistryDeps, 'isDomainAllowed'> = {
    isDomainAllowed: deps.isDomainAllowed,
  };
  const handlers = {
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
  } satisfies Record<string, MessageHandler>;

  const contentScriptAllowed = new Set(['VALID_VISIT', 'CONTENT_CLEANSING_EXECUTED', 'CHECK_DOMAIN', 'PING']);
  const trustLevels = Object.fromEntries(
    Object.keys(handlers).map((type) => [type, contentScriptAllowed.has(type) ? 'content-script-allowed' : 'extension-only']),
  ) as MessageHandlerRegistryComposition['trustLevels'];
  const validators: Record<string, import('../../messaging/validators.js').MessageValidator<unknown>> = {
    VALID_VISIT: validVisitValidator as unknown as import('../../messaging/validators.js').MessageValidator<unknown>,
    DASHBOARD_SQLITE: dashboardSqliteValidator as unknown as import('../../messaging/validators.js').MessageValidator<unknown>,
    FETCH_URL: fetchUrlValidator as unknown as import('../../messaging/validators.js').MessageValidator<unknown>,
    MANUAL_RECORD: manualRecordValidator as unknown as import('../../messaging/validators.js').MessageValidator<unknown>,
    PREVIEW_RECORD: manualRecordValidator as unknown as import('../../messaging/validators.js').MessageValidator<unknown>,
    SAVE_RECORD: manualRecordValidator as unknown as import('../../messaging/validators.js').MessageValidator<unknown>,
    CHECK_DOMAIN: checkDomainValidator as unknown as import('../../messaging/validators.js').MessageValidator<unknown>,
    CONTENT_CLEANSING_EXECUTED: contentCleansingExecutedValidator as unknown as import('../../messaging/validators.js').MessageValidator<unknown>,
  };
  for (const [type, handler] of Object.entries(handlers)) {
    registry.register(type, handler, trustLevels[type]!, validators[type]);
  }
  return { registry, handlers, trustLevels };
}
