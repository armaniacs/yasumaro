/**
 * alarmRegistry.test.ts
 * Dispatch is driven through the interface with fake deps — no chrome stubs
 * per arm, no unawaited voids to mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drainMacrotask, waitForMock } from '../../../testDir/waitPolicy.js';

const { flushBufferedExportsMock, flushYesterdaysExportMock, addLogMock } = vi.hoisted(() => ({
  flushBufferedExportsMock: vi.fn(async (..._args: unknown[]) => {}),
  flushYesterdaysExportMock: vi.fn(async (..._args: unknown[]) => {}),
  addLogMock: vi.fn(),
}));

vi.mock('../localMarkdownExportCore.js', () => ({
  flushBufferedExports: (...args: unknown[]) => flushBufferedExportsMock(...args),
}));
vi.mock('../localMarkdownIdleFlusher.js', () => ({
  flushYesterdaysExport: (...args: unknown[]) => flushYesterdaysExportMock(...args),
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
import { setSessionTimeoutRefs } from '../alarmRegistryRefs.js';
import { handleDailyPurgeAlarm } from '../dailyPurgeHandler.js';
import { flushPendingRecords } from '../pendingSqliteQueue.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';

function makeDeps(overrides: Partial<AlarmHandlerDeps> = {}): AlarmHandlerDeps {
  return {
    sqliteClient: { maintain: vi.fn(async () => ({ success: true })) } as never,
    recordingPipeline: {} as never,
    getOfflineNetworkQueue: async () => ({}) as never,
    retryPendingChromeStorageWrite: vi.fn(async () => true),
    settingsReader: makeReader(false),
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
  restore: () => void;
} {
  const globalRef = globalThis as unknown as { chrome?: unknown };
  const savedChrome = globalRef.chrome;
  const create = vi.fn();
  const clear = vi.fn();
  globalRef.chrome = { alarms: { create, clear } };
  return { create, clear, restore: () => { globalRef.chrome = savedChrome; } };
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
      getOfflineNetworkQueue: async () => {
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

  it('installAll creates the two unconditional alarms and runs install hooks', async () => {
    const globalRef = globalThis as unknown as { chrome?: unknown };
    const savedChrome = globalRef.chrome;
    const create = vi.fn();
    const clear = vi.fn();
    globalRef.chrome = { alarms: { create, clear } };
    try {
      const registry = createAlarmRegistry(makeDeps());
      await registry.installAll();

      expect(create).toHaveBeenCalledWith('yasumaro-daily-purge', { periodInMinutes: 1440 });
      expect(create).toHaveBeenCalledWith('yasumaro-offline-network-retry', { periodInMinutes: 5 });
    } finally {
      globalRef.chrome = savedChrome;
    }
  });

  describe('check_session_timeout (the only session-timeout dispatch path)', () => {
    it('runs checkTimeout exactly once per firing', async () => {
      const install = vi.fn(async () => {});
      const run = vi.fn(async () => {});
      setSessionTimeoutRefs(install, run);

      const registry = createAlarmRegistry(makeDeps());
      registry.handleAlarm(alarm('check_session_timeout'));
      await waitForMock(() => expect(run).toHaveBeenCalledTimes(1));

      expect(run).toHaveBeenCalledTimes(1);
    });

    it('does not run checkTimeout for other jobs', async () => {
      const install = vi.fn(async () => {});
      const run = vi.fn(async () => {});
      setSessionTimeoutRefs(install, run);

      const registry = createAlarmRegistry(makeDeps());
      // Anchor: the routed job's handler landing proves the dispatch (and any
      // dynamic-import hop) completed for this alarm; the drain then gives a
      // macrotask boundary for the negative.
      registry.handleAlarm(alarm('yasumaro-daily-purge'));
      await waitForMock(() => expect(handleDailyPurgeAlarm).toHaveBeenCalledTimes(1));
      await drainMacrotask();

      expect(run).not.toHaveBeenCalled();
    });

    it('installs the session alarm once per installAll', async () => {
      const globalRef = globalThis as unknown as { chrome?: unknown };
      const savedChrome = globalRef.chrome;
      globalRef.chrome = { alarms: { create: vi.fn(), clear: vi.fn() } };
      const install = vi.fn(async () => {});
      const run = vi.fn(async () => {});
      setSessionTimeoutRefs(install, run);
      try {
        const registry = createAlarmRegistry(makeDeps());
        await registry.installAll();

        expect(install).toHaveBeenCalledTimes(1);
        expect(run).not.toHaveBeenCalled();
      } finally {
        globalRef.chrome = savedChrome;
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
