import { MessageHandlerRegistry, type MessageHandler } from './MessageHandlerRegistry.js';
import { MessageRouter } from './MessageRouter.js';
import type { RecordingPipeline } from '../pipeline/RecordingPipeline.js';
import type { TabCache } from '../tabCache.js';
import type { AIService, AiTestProgress } from '../ai/AIService.js';
import type { ObsidianClient } from '../obsidianClient.js';
import type { Settings } from '../../utils/storage/types.js';
import type { PrivacyInfo } from '../../utils/privacyChecker.js';
import type { ManualRecordHandlerDeps, SaveRecordHandlerDeps } from './recordingHandlers.js';

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

/**
 * @deprecated — use createMessageRouter instead. This function now delegates to MessageRouter's deep seam to keep the 19 handler table in one place.
 */
export function createMessageHandlerRegistry(deps: MessageHandlerRegistryDeps): MessageHandlerRegistryComposition {
  // Single source of truth: MessageRouter's deep implementation hides the 19 handler table.
  // This wrapper exists only for backward compat with existing tests that mock createMessageHandlerRegistry.
  const router = new MessageRouter(deps);
  const handlers = Object.fromEntries((router as unknown as { handlers: Map<string, MessageHandler> }).handlers.entries()) as Record<string, MessageHandler>;
  const trustLevels = Object.fromEntries(
    Array.from((router as unknown as { trustLevels: Map<string, string> }).trustLevels.entries())
  ) as MessageHandlerRegistryComposition['trustLevels'];
  const validators = (router as unknown as { validators: Map<string, import('../../messaging/validators.js').MessageValidator<unknown>> }).validators;
  const registry = new MessageHandlerRegistry(deps.runtimeId);
  for (const [type, handler] of Object.entries(handlers)) {
    registry.register(type, handler, trustLevels[type]!, validators.get(type));
  }
  return { registry, handlers, trustLevels };
}
