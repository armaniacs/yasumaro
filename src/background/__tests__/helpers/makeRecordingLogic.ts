/**
 * Test helpers for constructing a RecordingOrchestrator.
 *
 * Tests that exercise real pipeline steps build an equivalent orchestrator here
 * rather than stubbing it, so step behaviour stays under test.
 */
import { createRecordingOrchestrator, type RecordingOrchestrator, type RecordingOrchestratorDeps } from '../../pipeline/RecordingOrchestrator.js';
import { RecordingCache } from './recordingCache.js';

export function makeRecordingLogic(
  obsidian: unknown,
  aiService: unknown,
  sqliteClient?: unknown,
): RecordingOrchestrator {
  return createRecordingOrchestrator({
    getPrivacyInfoWithCache: (url: string) => RecordingCache.getPrivacyInfoWithCache(url),
    getSettingsWithCache: () => RecordingCache.getSettingsWithCache(),
    obsidian: obsidian as never,
    aiService: aiService as never,
    sqliteClient: (sqliteClient ?? null) as never,
  });
}

/**
 * Positional variant matching the old `new RecordingPipeline(...)` signature,
 * for the pipeline step tests that were written against it.
 */
export function makeOrchestrator(
  getPrivacyInfoWithCache: RecordingOrchestratorDeps['getPrivacyInfoWithCache'],
  obsidian: unknown,
  aiService: unknown = null,
  sqliteClient: unknown = null,
  offlineNetworkQueue: unknown = null,
  urlStore?: RecordingOrchestratorDeps['urlStore'],
  getSettingsWithCache: RecordingOrchestratorDeps['getSettingsWithCache'] = () => RecordingCache.getSettingsWithCache(),
): RecordingOrchestrator {
  return createRecordingOrchestrator({
    getPrivacyInfoWithCache,
    getSettingsWithCache,
    obsidian: obsidian as never,
    aiService: aiService as never,
    sqliteClient: sqliteClient as never,
    offlineNetworkQueue: offlineNetworkQueue as never,
    ...(urlStore ? { urlStore } : {}),
  });
}
