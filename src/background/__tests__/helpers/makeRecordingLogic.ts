/**
 * Test helper for constructing RecordingLogic.
 *
 * RecordingLogic takes its RecordingPipeline by injection so that production has
 * exactly one pipeline instance (see backgroundComposition.test.ts). Tests that
 * exercise real pipeline steps build an equivalent pipeline here rather than
 * stubbing it, so step behaviour stays under test.
 */
import { createRecordingPipeline, buildRecordingPipelineDeps } from '../../pipeline/RecordingPipeline.js';
import { RecordingCache } from '../../recordingCache.js';
import { RecordingLogic } from '../../recordingLogic.js';

export function makeRecordingLogic(
  obsidian: unknown,
  aiService: unknown,
  sqliteClient?: unknown,
): RecordingLogic {
  const pipeline = createRecordingPipeline(buildRecordingPipelineDeps({
    getPrivacyInfoWithCache: (url: string) => RecordingCache.getPrivacyInfoWithCache(url),
    obsidian: obsidian as never,
    aiService: aiService as never,
    sqliteClient: (sqliteClient ?? null) as never,
  }));
  return new RecordingLogic(
    obsidian as never,
    aiService as never,
    pipeline,
    (sqliteClient ?? null) as never,
  );
}
