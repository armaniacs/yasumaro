/**
 * alarmRegistry.test.ts
 * Dispatch is driven through the interface with fake deps — no chrome stubs
 * per arm, no unawaited voids to mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drainMacrotask, waitForMock } from '../../../testDir/waitPolicy.js';

const { flushBufferedExportsMock, flushYesterdaysExportMock, addLogMock, initExportSchedulerMock } = vi.hoisted(() => ({
  flushBufferedExportsMock: vi.fn(async (..._args: unknown[]) => {}),
  flushYesterdaysExportMock: vi.fn(async (..._args: unknown[]) => {}),
  addLogMock: vi.fn(),
  initExportSchedulerMock: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock('../localMarkdownExportCore.js', () => ({
  flushBufferedExports: (...args: unknown[]) => flushBufferedExportsMock(...args),
}));
vi.mock('../localMarkdownIdleFlusher.js', () => ({
  flushYesterdaysExport: (...args: unknown[]) => flushYesterdaysExportMock(...args),
  initExportScheduler: (...args: unknown[]) => initExportSchedulerMock(...args),
}));
vi.mock('../dailyPurgeHandler.js', () => ({
  handleDailyPurgeAlarm: vi.fn(async () => {}),
}));
vi.mock('../pendingSqliteQueue.js', () => ({
  flushPendingRecords: vi.fn(async () => {}),
}));
vi.mock('../pendingChromeStorageQueue.js', () => ({
  flushPendingWrites: vi.fn(async () => {}),
}));
vi.mock('../offlineQueueProcessor.js', () => ({
  createOfflineQueueProcessor: () => vi.fn(async () => {}),
}));
vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: addLogMock,
    LogType: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: addLogMock,
    LogType: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    addLog: addLogMock,
    LogType: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG' },
  }),
);

import { createAlarmRegistry, type AlarmHandlerDeps } from '../alarmRegistry.js';
import { handleDailyPurgeAlarm } from '../dailyPurgeHandler.js';
import { flushPendingRecords } from '../pendingSqliteQueue.js';
import type { ReviewSummaryGenerator } from '../reviewSummaryGenerator.js';
import type { SessionAlarmService } from '../SessionAlarmService.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';

function makeReviewGenerator(): ReviewSummaryGenerator {
  return {
    generateWeeklySummary: vi.fn(async () => false),
    generateMonthlySummary: vi.fn(async () => false),
  } as unknown as ReviewSummaryGenerator;
}

function makeSessionAlarmService(): SessionAlarmService {
  return {
    startTimeoutChecker: vi.fn(async () => {}),
    checkTimeout: vi.fn(async () => {}),
  } as unknown as SessionAlarmService;
}

function makeDeps(overrides: Partial<AlarmHandlerDeps> = {}): AlarmHandlerDeps {
  return {
    sqliteClient: { maintain: vi.fn(async () => ({ success: true })) } as never,
    recordingPipeline: {} as never,
    getOfflineNetworkQueue: () => ({}) as never,
    // PBI 2026-10-19-10: alarm-driven replays re-read consent at execution time.
    isConsentGranted: async () => true,
    retryPendingChromeStorageWrite: vi.fn(async () => true),
    reviewSummaryGenerator: makeReviewGenerator(),
    sessionAlarmService: makeSessionAlarmService(),
    settingsReader: makeReader(false),
    // PBI 2026-10-22-03: the digest batch's shared-marker write seam.
    settingsWriter: { set: vi.fn(async () => {}) },
    ...overrides,
  };
}

function makeReader(enabled: boolean): SettingsReader {
  const settings = { [StorageKeys.REVIEW_SUMMARY_ENABLED]: enabled } as never;
  return {
    getAll: vi.fn(async () => settings),
    getMany: vi.fn(async () => settings),
  } as unknown as SettingsReader;
}

function alarm(name: string): chrome.alarms.Alarm {
  return { name } as chrome.alarms.Alarm;
}

function stubChromeAlarms(): {
  create: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  restore: () => void;
} {
  const globalRef = globalThis as unknown as { chrome?: unknown };
  const savedChrome = globalRef.chrome;
  const create = vi.fn();
  const clear = vi.fn();
  // PBI 2026-10-18-02: the daily purge installs through a get-then-create
  // guard, so every installAll stub needs alarms.get. Default (undefined
  // return) reads as "not registered": the guard then creates the alarm.
  const get = vi.fn();
  globalRef.chrome = { alarms: { create, clear, get } };
  return { create, clear, get, restore: () => { globalRef.chrome = savedChrome; } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAlarmRegistry', () => {
  it('routes daily-purge to the purge handler', async () => {
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-daily-purge'));
    // Condition-based: resolves as soon as the routed handler lands, through
    // any number of dynamic-import hops — no fixed macrotask-turn budget.
    await waitForMock(() => expect(handleDailyPurgeAlarm).toHaveBeenCalledTimes(1));
  });

  it('flush and immediate share one body', async () => {
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-local-md-flush'));
    await waitForMock(() => expect(flushBufferedExportsMock).toHaveBeenCalledTimes(1));
    registry.handleAlarm(alarm('yasumaro-local-md-immediate'));
    await waitForMock(() => expect(flushBufferedExportsMock).toHaveBeenCalledTimes(2));

    expect(flushBufferedExportsMock).toHaveBeenCalledTimes(2);
  });

  it('routes daily-flush to the idle flusher', async () => {
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-local-md-daily-flush'));
    await waitForMock(() => expect(flushYesterdaysExportMock).toHaveBeenCalledTimes(1));
  });

  it('offline-retry fans out without one failure blocking the others', async () => {
    const deps = makeDeps();
    (deps.sqliteClient as unknown as { maintain: ReturnType<typeof vi.fn> }).maintain.mockRejectedValueOnce(
      new Error('sqlite down'),
    );
    const registry = createAlarmRegistry(deps);
    registry.handleAlarm(alarm('yasumaro-offline-network-retry'));
    await waitForMock(() => expect(flushPendingRecords).toHaveBeenCalledTimes(1));

    // allSettled: the pending flushes still ran despite the maintain failure.
    expect(flushPendingRecords).toHaveBeenCalledTimes(1);
  });

  it('logs job failure uniformly instead of void-firing', async () => {
    const failing = makeDeps({
      getOfflineNetworkQueue: () => {
        throw new Error('queue gone');
      },
    });
    const failingRegistry = createAlarmRegistry(failing);
    failingRegistry.handleAlarm(alarm('yasumaro-offline-network-retry'));
    await waitForMock(() =>
      expect(addLogMock).toHaveBeenCalledWith(
        'ERROR',
        expect.stringContaining('yasumaro-offline-network-retry'),
        expect.anything(),
      ),
    );
  });

  it('ignores unknown alarm names', async () => {
    const registry = createAlarmRegistry(makeDeps());
    // Positive anchor first: routing a known alarm proves the dispatch
    // machinery (dynamic-import hops included) resolves. The unknown-name
    // path schedules no timer of its own, so one macrotask boundary is the
    // sanctioned negative shape (waitPolicy: drainMacrotask is for negatives).
    registry.handleAlarm(alarm('yasumaro-daily-purge'));
    await waitForMock(() => expect(handleDailyPurgeAlarm).toHaveBeenCalledTimes(1));

    registry.handleAlarm(alarm('someone-elses-alarm'));
    await drainMacrotask();

    expect(handleDailyPurgeAlarm).toHaveBeenCalledTimes(1);
    expect(addLogMock).not.toHaveBeenCalled();
  });

  it('installAll arms the daily purge when missing, keeps offline-retry unconditional, and runs install hooks', async () => {
    // Updated by PBI 2026-10-18-02: this test used to pin the unconditional
    // re-create of the daily purge on every installAll. The purge now
    // installs through the get-then-create guard, so the unregistered case
    // (fresh install) is pinned here and the registered case below.
    const { create, get, restore } = stubChromeAlarms();
    try {
      const registry = createAlarmRegistry(makeDeps());
      await registry.installAll();

      // Unregistered: the guard consults chrome.alarms.get and creates the
      // standing 24h alarm exactly once.
      expect(get).toHaveBeenCalledWith('yasumaro-daily-purge');
      expect(create).toHaveBeenCalledWith('yasumaro-daily-purge', { periodInMinutes: 1440 });
      // The offline-retry row keeps its unconditional re-create (unchanged).
      expect(create).toHaveBeenCalledWith('yasumaro-offline-network-retry', { periodInMinutes: 5 });
    } finally {
      restore();
    }
  });

  describe('daily-purge get-then-create guard (PBI 2026-10-18-02)', () => {
    it('keeps an already-registered daily purge so its scheduledTime survives restarts', async () => {
      const { create, get, restore } = stubChromeAlarms();
      try {
        // Already armed: chrome.alarms.get finds the standing purge alarm, so
        // the guard leaves it untouched (Chrome would otherwise cancel and
        // replace the same-name alarm, resetting the 24h countdown).
        get.mockImplementation(async (name: string) => {
          if (name !== 'yasumaro-daily-purge') return undefined;
          return { name, scheduledTime: Date.now() + 86_400_000 };
        });
        const registry = createAlarmRegistry(makeDeps());
        await registry.installAll();

        expect(get).toHaveBeenCalledWith('yasumaro-daily-purge');
        expect(create).not.toHaveBeenCalledWith('yasumaro-daily-purge', expect.anything());
        // Scenario 1: the offline-retry row still installs exactly as before.
        expect(create).toHaveBeenCalledWith('yasumaro-offline-network-retry', { periodInMinutes: 5 });
      } finally {
        restore();
      }
    });

    it('survives repeated installAll runs (SW restarts) with one create, and re-arms a lost alarm', async () => {
      const { create, get, restore } = stubChromeAlarms();
      try {
        // Stateful fake: once created, the alarm is visible to
        // chrome.alarms.get, as it would be across real SW restarts.
        const armed = new Set<string>();
        get.mockImplementation(async (name: string) => {
          if (!armed.has(name)) return undefined;
          return { name } as chrome.alarms.Alarm;
        });
        create.mockImplementation((name: string) => {
          armed.add(name);
        });

        const registry = createAlarmRegistry(makeDeps());
        // Repeated alarm wake-ups of the same worker generation.
        await registry.installAll();
        await registry.installAll();
        await registry.installAll();

        const dailyPurgeCreates = create.mock.calls.filter((call) => call[0] === 'yasumaro-daily-purge');
        expect(dailyPurgeCreates).toHaveLength(1);
        // The offline-retry row keeps its unconditional re-create every time.
        const retryCreates = create.mock.calls.filter((call) => call[0] === 'yasumaro-offline-network-retry');
        expect(retryCreates).toHaveLength(3);

        // Scenario 3: an alarm lost to a profile move re-arms on the next start.
        armed.delete('yasumaro-daily-purge');
        await registry.installAll();
        expect(create.mock.calls.filter((call) => call[0] === 'yasumaro-daily-purge')).toHaveLength(2);
      } finally {
        restore();
      }
    });

    it('records the failure when the guard cannot read alarms and keeps installing the rest', async () => {
      const { create, get, restore } = stubChromeAlarms();
      try {
        get.mockRejectedValue(new Error('alarms unavailable'));
        const registry = createAlarmRegistry(makeDeps());
        await registry.installAll();

        // Not silently treated as success: the failure lands in the job's own
        // try/catch log under its name...
        expect(addLogMock).toHaveBeenCalledWith(
          'ERROR',
          expect.stringContaining('yasumaro-daily-purge'),
          expect.anything(),
        );
        expect(create).not.toHaveBeenCalledWith('yasumaro-daily-purge', expect.anything());
        // ...and the remaining jobs still install (uniform failure policy).
        expect(create).toHaveBeenCalledWith('yasumaro-offline-network-retry', { periodInMinutes: 5 });
        expect(initExportSchedulerMock).toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    // The behavior change is limited to the daily purge: the remaining
    // staticSchedule rows keep their unconditional re-create until their
    // re-arm semantics are decided (PBI scope guard).
    it.each([
      { name: 'yasumaro-offline-network-retry', spec: { periodInMinutes: 5 } },
    ])('$name keeps its unconditional re-create even when already registered', async ({ name, spec }) => {
      const { create, get, restore } = stubChromeAlarms();
      try {
        // Every name reports a registered alarm: the offline-retry row has no
        // guard, so it still re-creates exactly as before the PBI.
        get.mockImplementation(async (queried: string) => {
          return { name: queried, scheduledTime: Date.now() };
        });
        const registry = createAlarmRegistry(makeDeps());
        await registry.installAll();

        expect(create).toHaveBeenCalledWith(name, spec);
      } finally {
        restore();
      }
    });
  });

  describe('check_session_timeout (the only session-timeout dispatch path)', () => {
    it('runs checkTimeout exactly once per firing', async () => {
      const service = makeSessionAlarmService();
      const registry = createAlarmRegistry(makeDeps({ sessionAlarmService: service }));
      registry.handleAlarm(alarm('check_session_timeout'));
      await waitForMock(() => expect(service.checkTimeout).toHaveBeenCalledTimes(1));

      expect(service.checkTimeout).toHaveBeenCalledTimes(1);
    });

    it('does not run checkTimeout for other jobs', async () => {
      const service = makeSessionAlarmService();
      const registry = createAlarmRegistry(makeDeps({ sessionAlarmService: service }));
      // Anchor: the routed job's handler landing proves the dispatch (and any
      // dynamic-import hop) completed for this alarm; the drain then gives a
      // macrotask boundary for the negative.
      registry.handleAlarm(alarm('yasumaro-daily-purge'));
      await waitForMock(() => expect(handleDailyPurgeAlarm).toHaveBeenCalledTimes(1));
      await drainMacrotask();

      expect(service.checkTimeout).not.toHaveBeenCalled();
    });

    it('installs the session alarm once per installAll', async () => {
      const globalRef = globalThis as unknown as { chrome?: unknown };
      const savedChrome = globalRef.chrome;
      globalRef.chrome = { alarms: { create: vi.fn(), clear: vi.fn(), get: vi.fn() } };
      const service = makeSessionAlarmService();
      try {
        const registry = createAlarmRegistry(makeDeps({ sessionAlarmService: service }));
        await registry.installAll();

        expect(service.startTimeoutChecker).toHaveBeenCalledTimes(1);
        expect(service.checkTimeout).not.toHaveBeenCalled();
      } finally {
        globalRef.chrome = savedChrome;
      }
    });
  });

  it('routes the recording-resume alarm to clearPause', async () => {
    const clearSpy = vi.fn(async () => undefined);
    vi.doMock('../recordingPause.js', () => ({
      clearPause: clearSpy,
      PAUSE_ALARM_NAME: 'yasumaro-recording-resume',
    }));
    const { createAlarmRegistry } = await import('../alarmRegistry.js');
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-recording-resume'));
    await vi.waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
  });

  it('routes the pause-tick alarm to the pause module refresh', async () => {
    const refreshSpy = vi.fn(async () => undefined);
    vi.doMock('../recordingPause.js', () => ({
      refreshPauseTick: refreshSpy,
    }));
    const { createAlarmRegistry } = await import('../alarmRegistry.js');
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-recording-pause-tick'));
    await waitForMock(() => expect(refreshSpy).toHaveBeenCalledTimes(1));
  });

  it('logs pause-tick refresh failure uniformly instead of void-firing', async () => {
    vi.doMock('../recordingPause.js', () => ({
      refreshPauseTick: vi.fn(async () => {
        throw new Error('tick gone');
      }),
    }));
    const { createAlarmRegistry } = await import('../alarmRegistry.js');
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-recording-pause-tick'));
    await waitForMock(() =>
      expect(addLogMock).toHaveBeenCalledWith(
        'ERROR',
        expect.stringContaining('yasumaro-recording-pause-tick'),
        expect.anything(),
      ),
    );
  });

  describe('review-summary run (pinned: deps-driven)', () => {
    it('routes weekly firing to deps.reviewSummaryGenerator.generateWeeklySummary', async () => {
      const generator = makeReviewGenerator();
      const registry = createAlarmRegistry(makeDeps({ reviewSummaryGenerator: generator }));
      registry.handleAlarm(alarm('yasumaro-review-weekly'));
      await waitForMock(() => expect(generator.generateWeeklySummary).toHaveBeenCalledTimes(1));

      expect(generator.generateMonthlySummary).not.toHaveBeenCalled();
    });

    it('routes monthly firing to deps.reviewSummaryGenerator.generateMonthlySummary', async () => {
      const generator = makeReviewGenerator();
      const registry = createAlarmRegistry(makeDeps({ reviewSummaryGenerator: generator }));
      registry.handleAlarm(alarm('yasumaro-review-monthly'));
      await waitForMock(() => expect(generator.generateMonthlySummary).toHaveBeenCalledTimes(1));

      expect(generator.generateWeeklySummary).not.toHaveBeenCalled();
    });
  });

  describe('local-md install (ownership: initExportScheduler + one-shot no-op)', () => {
    it('routes installAll through initExportScheduler for the standing local-md alarms', async () => {
      const { create, restore } = stubChromeAlarms();
      try {
        const registry = createAlarmRegistry(makeDeps());
        await registry.installAll();

        // flush + daily rows share the scheduler install (idempotent).
        expect(initExportSchedulerMock).toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it('creates no standing immediate alarm at install time (per-recording one-shot)', async () => {
      const { create, restore } = stubChromeAlarms();
      try {
        const registry = createAlarmRegistry(makeDeps());
        await registry.installAll();

        expect(create).not.toHaveBeenCalledWith('yasumaro-local-md-immediate', expect.anything());
      } finally {
        restore();
      }
    });
  });

  describe('review-summary install (pinned: reader-driven)', () => {
    it('creates both review alarms when the setting is enabled', async () => {
      const { create, restore } = stubChromeAlarms();
      try {
        const registry = createAlarmRegistry(makeDeps({ settingsReader: makeReader(true) }));
        await registry.installAll();

        expect(create).toHaveBeenCalledWith('yasumaro-review-weekly', {
          when: expect.any(Number),
          periodInMinutes: 7 * 24 * 60,
        });
        expect(create).toHaveBeenCalledWith('yasumaro-review-monthly', {
          when: expect.any(Number),
          periodInMinutes: 31 * 24 * 60,
        });
      } finally {
        restore();
      }
    });

    it('clears both review alarms without creating when the setting is disabled', async () => {
      const { create, clear, restore } = stubChromeAlarms();
      try {
        const registry = createAlarmRegistry(makeDeps({ settingsReader: makeReader(false) }));
        await registry.installAll();

        expect(clear).toHaveBeenCalledWith('yasumaro-review-weekly');
        expect(clear).toHaveBeenCalledWith('yasumaro-review-monthly');
        expect(create).not.toHaveBeenCalledWith('yasumaro-review-weekly', expect.anything());
        expect(create).not.toHaveBeenCalledWith('yasumaro-review-monthly', expect.anything());
      } finally {
        restore();
      }
    });

    it('skips review alarm creation and records the failure when reading settings fails', async () => {
      const { create, restore } = stubChromeAlarms();
      try {
        const failingReader = {
          getAll: vi.fn(async () => { throw new Error('storage down'); }),
          getMany: vi.fn(async () => { throw new Error('storage down'); }),
        } as unknown as SettingsReader;
        const registry = createAlarmRegistry(makeDeps({ settingsReader: failingReader }));
        await registry.installAll();

        expect(create).not.toHaveBeenCalledWith('yasumaro-review-weekly', expect.anything());
        expect(create).not.toHaveBeenCalledWith('yasumaro-review-monthly', expect.anything());
        expect(addLogMock).toHaveBeenCalledWith(
          'ERROR',
          expect.stringContaining('yasumaro-review-weekly'),
          expect.anything(),
        );
      } finally {
        restore();
      }
    });
  });
});
