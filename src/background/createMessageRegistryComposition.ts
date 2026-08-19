/**
 * createMessageRegistryComposition
 * Protocol-side composition root for message handler registration.
 *
 * service-worker.ts previously inlined 18 dependencies (10 module-function
 * imports plus 8 fields off BackgroundServicesComposition) directly into a
 * createMessageHandlerRegistry() call. That call site is the only thing this
 * module replaces: it imports the module-function dependencies itself and
 * reduces the service-worker.ts call site to passing `services` plus the two
 * values service-worker.ts alone constructs (dashboardSqliteHandler,
 * autoSavedBadgeTabs). createMessageHandlerRegistry itself is untouched so its
 * existing unit tests keep injecting every dependency directly.
 */

import { createMessageHandlerRegistry, type MessageHandlerRegistryComposition } from './handlers/createMessageHandlerRegistry.js';
import type { MessageHandler } from './handlers/MessageHandlerRegistry.js';
import type { BackgroundServicesComposition } from './createBackgroundServices.js';
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { buildAllowedUrls, getSettings, clearSettingsCache, lockSession } from '../utils/storage.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { notifyAiTestProgress } from './aiTestProgressNotifier.js';
import { updateActivity } from './sessionAlarmsManager.js';

export interface MessageRegistryCompositionDeps {
  services: BackgroundServicesComposition;
  dashboardSqliteHandler: MessageHandler;
  autoSavedBadgeTabs: {
    add(tabId: number): void;
    has(tabId: number): boolean;
  };
}

export function createMessageRegistryComposition(
  deps: MessageRegistryCompositionDeps,
): MessageHandlerRegistryComposition {
  const { services, dashboardSqliteHandler, autoSavedBadgeTabs } = deps;

  return createMessageHandlerRegistry({
    recordingPipeline: services.recordingPipeline,
    tabCache: services.tabCache,
    obsidian: services.obsidian,
    aiService: services.aiService,
    manualRecordDeps: services.manualRecordDeps,
    saveRecordDeps: services.saveRecordDeps,
    hasPrivacyConsent: () => hasPrivacyConsent(),
    buildAllowedUrls: (settings) => buildAllowedUrls(settings),
    getSettings: () => getSettings(),
    isDomainAllowed: (url) => isDomainAllowed(url),
    clearSettingsCache: () => clearSettingsCache(),
    notifyAiTestProgress,
    getPrivacyCache: () => services.recordingCache.getPrivacyCache(),
    updateActivity: () => updateActivity(),
    lockSession: () => lockSession(),
    autoSavedBadgeTabs,
    initExportScheduler: async () => {
      const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
      await initExportScheduler();
    },
    updateConsentBadge: async () => {
      const { updateConsentBadge } = await import('./consentBadge.js');
      await updateConsentBadge();
    },
    generateWeeklySummary: () => services.reviewSummaryGenerator.generateWeeklySummary(),
    generateMonthlySummary: () => services.reviewSummaryGenerator.generateMonthlySummary(),
    dashboardSqliteHandler,
  });
}
