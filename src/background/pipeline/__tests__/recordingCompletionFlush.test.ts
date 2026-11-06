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
  getPendingLogCount,
} from '../../../utils/logger/core.js';
import { InMemoryLogAdapter } from '../../../utils/logger/storageAdapter.js';
import type { LogFlushScheduler } from '../../../utils/logger/flushScheduler.js';
import { LogType } from '../../../utils/logger/types.js';
import type { LogEntry } from '../../../utils/logger/types.js';
import { waitForMock } from '../../../../testDir/waitPolicy.js';
import { RecordingOrchestrator } from '../RecordingOrchestrator.js';
import { defaultOutcomeAdapters } from '../recordingOutcome.js';
import type { PrivacyPipeline } from '../../privacyPipeline.js';
import type { PrivacyPipelineFactory } from '../steps/processPrivacyPipelineStep.js';

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

/**
 * Gated test adapter: the first append waits on an externally controlled
 * gate, so the test can hold one completion flush in flight while the
 * second recording finishes buffering and attempts its own completion
 * flush. The overlap is deterministic — no real-time waits.
 */
class GatedLogAdapter extends InMemoryLogAdapter {
  appendCalls = 0;
  readonly appendGate = Promise.withResolvers<void>();
  /** When true, the first (gated) append rejects instead of persisting. */
  failFirstAppend = false;

  override async append(entries: LogEntry[]): Promise<void> {
    this.appendCalls += 1;
    if (this.appendCalls === 1) {
      await this.appendGate.promise;
      if (this.failFirstAppend) {
        throw new Error('injected append failure');
      }
    }
    await super.append(entries);
  }
}

/**
 * Privacy-pipeline factory stub: every record succeeds without AI. The second
 * process() call waits on the given gate, so the gated recording stays inside
 * its privacy step — before emitting any log — until the test releases it.
 * This guarantees the gated record's entries are all buffered after the
 * first record's flush already drained.
 */
function makeSuccessPrivacyFactory(secondProcessGate: Promise<void>): PrivacyPipelineFactory {
  let processCalls = 0;
  const factory: PrivacyPipelineFactory = (_settings, _aiService) =>
    ({
      process: async () => {
        processCalls += 1;
        if (processCalls >= 2) {
          await secondProcessGate;
        }
        return { summary: 'stub summary for coalescing test', success: true };
      },
    }) as unknown as PrivacyPipeline;
  return factory;
}

/**
 * Orchestrator whose records run the full pipeline to success: the stubbed
 * privacy step, the real extract/format/save steps, and a completion flush.
 * The desktop notifier is stubbed (it needs chrome.*); the completion-flush
 * durability contract under test is unchanged.
 */
function makeCoalescingOrchestrator(secondProcessGate: Promise<void>): RecordingOrchestrator {
  return new RecordingOrchestrator({
    getPrivacyInfoWithCache: async () => null,
    getSettingsWithCache: async () => ({}) as never,
    obsidian: {
      appendToDailyNote: vi.fn(async () => undefined),
    } as never,
    aiService: null,
    sqliteClient: null,
    stepDelay: async () => undefined,
    privacyPipelineFactory: makeSuccessPrivacyFactory(secondProcessGate),
    outcomeAdapters: {
      ...defaultOutcomeAdapters,
      notifier: {
        notifyError: () => undefined,
        notifySaveSuccess: () => undefined,
      },
    },
  });
}

/** Save-phase marker entries for one recording (emitted past the save gate). */
function savedObsidianEntriesFor(entries: LogEntry[], url: string): LogEntry[] {
  return entries.filter(
    (entry) => entry.message === 'Saved to Obsidian' && entry.details?.url === url,
  );
}

/** Distinct string traceIds among one recording's persisted entries. */
function traceIdsFor(entries: LogEntry[], url: string): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.details?.url === url)
      .map((entry) => entry.traceId)
      .filter((id): id is string => typeof id === 'string'),
  );
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

    describe('concurrent completion flush coalescing', () => {
      const URL_A = 'https://example.com/coalesce-a';
      const URL_B = 'https://example.com/coalesce-b';

      let gatedStorage: GatedLogAdapter;

      beforeEach(() => {
        gatedStorage = new GatedLogAdapter();
        initLogger({ storage: gatedStorage, scheduler: makeNeverFlushScheduler() });
        clearPendingLogs();
      });

      afterEach(() => {
        resetLoggerWiring();
        clearPendingLogs();
      });

      it('persists both recording traceIds when two records complete concurrently', async () => {
        const secondProcessGate = Promise.withResolvers<void>();
        const pipeline = makeCoalescingOrchestrator(secondProcessGate.promise);
        const settingsOption = { settings: { PRIVACY_MODE: 'full_pipeline' } as never };
        const recordA = pipeline.record(
          { title: 'Coalesce A', url: URL_A, content: 'alpha. beta. gamma.' },
          settingsOption,
        );
        const recordB = pipeline.record(
          { title: 'Coalesce B', url: URL_B, content: 'one. two. three.' },
          settingsOption,
        );

        // Hold the first flush inside its (gated) append...
        await waitForMock(() => expect(gatedStorage.appendCalls).toBe(1));
        // ...then let the second recording run to completion, so its
        // completion flush arrives while the first is still in flight.
        secondProcessGate.resolve();
        // The gated record resolves first in every interleaving: the
        // other record is parked inside the gated append and cannot resolve
        // before the gate opens. (Without this rendezvous the gate could
        // open first and the test would prove nothing.)
        await Promise.race([recordA, recordB]);
        // Open the held flush and let both records settle.
        gatedStorage.appendGate.resolve();
        const [resultA, resultB] = await Promise.all([recordA, recordB]);
        expect(resultA.success).toBe(true);
        expect(resultB.success).toBe(true);
        // A coalesced re-run settles inside the in-flight flush after the
        // gate opens; wait for the buffer to drain (this times out while
        // the bug is present, because the never-flush scheduler never
        // fires on its own — that timeout IS the "alarm wait remains" pin).
        await waitForMock(() => expect(getPendingLogCount()).toBe(0));

        const persisted = await gatedStorage.load();
        // Each recording's save-phase marker reached the adapter through the
        // completion flush alone (the scheduler never fires by itself).
        expect(savedObsidianEntriesFor(persisted, URL_A).length).toBeGreaterThan(0);
        expect(savedObsidianEntriesFor(persisted, URL_B).length).toBeGreaterThan(0);
        // Both traceIds are present, single-valued per recording, and distinct.
        const traceIdsA = traceIdsFor(persisted, URL_A);
        const traceIdsB = traceIdsFor(persisted, URL_B);
        expect(traceIdsA.size).toBe(1);
        expect(traceIdsB.size).toBe(1);
        const [idA] = [...traceIdsA];
        const [idB] = [...traceIdsB];
        expect(idA).toBeDefined();
        expect(idB).toBeDefined();
        expect(idA).not.toBe(idB);
      });

      it('retains the surviving side when one concurrent flush fails to append', async () => {
        gatedStorage.failFirstAppend = true;
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const secondProcessGate = Promise.withResolvers<void>();
          const pipeline = makeCoalescingOrchestrator(secondProcessGate.promise);
          const settingsOption = { settings: { PRIVACY_MODE: 'full_pipeline' } as never };
          const recordA = pipeline.record(
            { title: 'Failover A', url: URL_A, content: 'alpha. beta. gamma.' },
            settingsOption,
          );
          const recordB = pipeline.record(
            { title: 'Failover B', url: URL_B, content: 'one. two. three.' },
            settingsOption,
          );

          await waitForMock(() => expect(gatedStorage.appendCalls).toBe(1));
          secondProcessGate.resolve();
          await Promise.race([recordA, recordB]);
          gatedStorage.appendGate.resolve();
          const [resultA, resultB] = await Promise.all([recordA, recordB]);
          expect(resultA.success).toBe(true);
          expect(resultB.success).toBe(true);
          await waitForMock(() => expect(getPendingLogCount()).toBe(0));

          const persisted = await gatedStorage.load();
          // The failed batch is reported...
          expect(errorSpy).toHaveBeenCalledWith('Logger: Failed to flush logs', expect.anything());
          // ...while the coalesced batch from the surviving recording persists.
          const savedMarkers = persisted.filter((entry) => entry.message === 'Saved to Obsidian');
          expect(savedMarkers.length).toBeGreaterThan(0);
        } finally {
          errorSpy.mockRestore();
        }
      });
    });
  });
});
