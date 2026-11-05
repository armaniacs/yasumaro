/**
 * recordingCompletionFlush.test.ts
 *
 * Durability pin: a recording's traceId logs must be queryable right after
 * it completes — not only once the buffer hits BATCH_FLUSH_SIZE or the
 * 1-minute alarm fires (logCritical precedent: flush so entries are not lost
 * on SW termination). The E2E predicate reads chrome.storage.local directly
 * (the buffer is invisible to it), so a success path emitting fewer than 10
 * logs would otherwise never satisfy the correlation check.
 *
 * The scheduler here never auto-flushes (schedule/clear are no-ops): anything
 * reaching the adapter got there through the completion flush alone. A lone
 * addLog control proves the wiring truly never flushes by itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addLog,
  initLogger,
  resetLoggerWiring,
  clearPendingLogs,
} from '../../../utils/logger/core.js';
import { InMemoryLogAdapter } from '../../../utils/logger/storageAdapter.js';
import type { LogFlushScheduler } from '../../../utils/logger/flushScheduler.js';
import { LogType } from '../../../utils/logger/types.js';
import { RecordingOrchestrator } from '../RecordingOrchestrator.js';

function makeNeverFlushScheduler(): LogFlushScheduler {
  let handler: (() => Promise<void>) | null = null;
  return {
    onFlushRequested(h: () => Promise<void>) {
      handler = h;
    },
    schedule() {},
    clear() {},
    async flushNow() {
      if (handler) await handler();
    },
  };
}

const TEST_URL = 'https://example.com/traced-page';

function makeOrchestrator(): RecordingOrchestrator {
  return new RecordingOrchestrator({
    getPrivacyInfoWithCache: async () => null,
    getSettingsWithCache: async () => ({}) as never,
    obsidian: {
      appendToDailyNote: vi.fn(async () => undefined),
    } as never,
    aiService: null,
    sqliteClient: null,
    // Immediate backoff: retry timing is a separate seam (stepExecutor's
    // StepDelayFn contract); this pin is about the completion flush.
    stepDelay: async () => undefined,
  });
}

describe('RecordingOrchestrator', () => {
  describe('completion flush', () => {
    let storage: InMemoryLogAdapter;

    beforeEach(() => {
      storage = new InMemoryLogAdapter();
      initLogger({ storage, scheduler: makeNeverFlushScheduler() });
      clearPendingLogs();
    });

    afterEach(() => {
      resetLoggerWiring();
      clearPendingLogs();
    });

    it('persists the recording traceId logs without a manual flush', async () => {
      const pipeline = makeOrchestrator();
      await pipeline.record(
        { title: 'Traced page', url: TEST_URL, content: 'one. two. three.' },
        { settings: { PRIVACY_MODE: 'full_pipeline' } as never },
      );

      const persisted = await storage.load();
      expect(persisted.length).toBeGreaterThan(0);
      const withUrl = persisted.filter(
        (entry) => (entry.details as Record<string, unknown> | undefined)?.url === TEST_URL,
      );
      expect(withUrl.length).toBeGreaterThan(0);
      const traceIds = new Set(
        withUrl.map((entry) => entry.traceId).filter((id): id is string => typeof id === 'string'),
      );
      expect(traceIds.size).toBe(1);
    });

    it('never auto-flushes without completion (lone addLog stays buffered)', async () => {
      await addLog(LogType.INFO, 'lone entry', { url: TEST_URL });
      expect(await storage.load()).toEqual([]);
    });
  });
});
