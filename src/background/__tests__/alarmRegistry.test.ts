/**
 * alarmRegistry.test.ts
 * Dispatch is driven through the interface with fake deps — no chrome stubs
 * per arm, no unawaited voids to mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { flushBufferedExportsMock, flushYesterdaysExportMock, addLogMock } = vi.hoisted(() => ({
  flushBufferedExportsMock: vi.fn(async () => {}),
  flushYesterdaysExportMock: vi.fn(async () => {}),
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
vi.mock('../../utils/logger.js', () => ({
  addLog: addLogMock,
  LogType: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG' },
}));

import { createAlarmRegistry, type AlarmHandlerDeps } from '../alarmRegistry.js';
import { handleDailyPurgeAlarm } from '../dailyPurgeHandler.js';
import { flushPendingRecords } from '../pendingSqliteQueue.js';

function makeDeps(overrides: Partial<AlarmHandlerDeps> = {}): AlarmHandlerDeps {
  return {
    sqliteClient: { maintain: vi.fn(async () => ({ success: true })) } as never,
    recordingPipeline: {} as never,
    getOfflineNetworkQueue: async () => ({}) as never,
    retryPendingChromeStorageWrite: vi.fn(async () => true),
    ...overrides,
  };
}

function alarm(name: string): chrome.alarms.Alarm {
  return { name } as chrome.alarms.Alarm;
}

/**
 * Let the void-fired handleAlarm settle. Dynamic-import hops need macrotask
 * turns, not just microtasks.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAlarmRegistry', () => {
  it('routes daily-purge to the purge handler', async () => {
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-daily-purge'));
    await settle();

    expect(handleDailyPurgeAlarm).toHaveBeenCalledTimes(1);
  });

  it('flush and immediate share one body', async () => {
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-local-md-flush'));
    await settle();
    registry.handleAlarm(alarm('yasumaro-local-md-immediate'));
    await settle();

    expect(flushBufferedExportsMock).toHaveBeenCalledTimes(2);
  });

  it('routes daily-flush to the idle flusher', async () => {
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('yasumaro-local-md-daily-flush'));
    await settle();

    expect(flushYesterdaysExportMock).toHaveBeenCalledTimes(1);
  });

  it('offline-retry fans out without one failure blocking the others', async () => {
    const deps = makeDeps();
    (deps.sqliteClient as { maintain: ReturnType<typeof vi.fn> }).maintain.mockRejectedValueOnce(
      new Error('sqlite down'),
    );
    const registry = createAlarmRegistry(deps);
    registry.handleAlarm(alarm('yasumaro-offline-network-retry'));
    await settle();

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
    await settle();

    expect(addLogMock).toHaveBeenCalledWith(
      'ERROR',
      expect.stringContaining('yasumaro-offline-network-retry'),
      expect.anything(),
    );
  });

  it('ignores unknown alarm names', async () => {
    const registry = createAlarmRegistry(makeDeps());
    registry.handleAlarm(alarm('someone-elses-alarm'));
    await settle();

    expect(handleDailyPurgeAlarm).not.toHaveBeenCalled();
    expect(addLogMock).not.toHaveBeenCalled();
  });

  it('installStaticAlarms creates the two unconditional alarms', () => {
    const globalRef = globalThis as unknown as { chrome?: unknown };
    const savedChrome = globalRef.chrome;
    const create = vi.fn();
    globalRef.chrome = { alarms: { create } };
    try {
      const registry = createAlarmRegistry(makeDeps());
      registry.installStaticAlarms();

      expect(create).toHaveBeenCalledWith('yasumaro-daily-purge', { periodInMinutes: 1440 });
      expect(create).toHaveBeenCalledWith('yasumaro-offline-network-retry', { periodInMinutes: 5 });
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      globalRef.chrome = savedChrome;
    }
  });
});
