/**
 * Test helper for constructing a RecordingPipeline.
 *
 * Tests that exercise real pipeline steps build an equivalent pipeline here
 * rather than stubbing it, so step behaviour stays under test.
 */
import { createRecordingPipeline, type RecordingPipeline } from '../../pipeline/RecordingPipeline.js';
import { RecordingCache } from './recordingCache.js';

export function makeRecordingLogic(
  obsidian: unknown,
  aiService: unknown,
  sqliteClient?: unknown,
): RecordingPipeline {
  return createRecordingPipeline({
    getPrivacyInfoWithCache: (url: string) => RecordingCache.getPrivacyInfoWithCache(url),
    getSettingsWithCache: () => RecordingCache.getSettingsWithCache(),
    obsidian: obsidian as never,
    aiService: aiService as never,
    sqliteClient: (sqliteClient ?? null) as never,
  });
}
