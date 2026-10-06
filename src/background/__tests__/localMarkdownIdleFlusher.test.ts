/**
 * localMarkdownIdleFlusher.test.ts
 * initExportScheduler wires the alarm/listener combination matching the
 * user's chosen LOCAL_MARKDOWN_EXPORT_TIMING.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drainMacrotask } from '../../../testDir/waitPolicy.js';

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockFlushBufferedExports = vi.hoisted(() => vi.fn());
const mockOnStateChangedAddListener = vi.hoisted(() => vi.fn());
const mockOnStateChangedRemoveListener = vi.hoisted(() => vi.fn());
const mockIdle = vi.hoisted(() => ({ onStateChanged: { addListener: mockOnStateChangedAddListener, removeListener: mockOnStateChangedRemoveListener } }));
const mockAlarmsCreate = vi.hoisted(() => vi.fn());
const mockAlarmsClear = vi.hoisted(() => vi.fn());
const mockAlarmsGet = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    },
    getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    },
    getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    },
    getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    },
    getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    },
    getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    },
    getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetSettings,
      get: mockGetSettings,
      getMany: mockGetSettings,
      set: vi.fn(),
      setAll: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as Record<string, unknown>,
    SettingsRepository: class {
      getAll = mockGetSettings;
      get = mockGetSettings;
      getMany = mockGetSettings;
      set = vi.fn();
      setAll = vi.fn();
      clearCache = vi.fn();
    },
  };
});

vi.mock('../localMarkdownExportCore.js', () => ({
  flushBufferedExports: mockFlushBufferedExports,
}));

vi.stubGlobal('chrome', {
  idle: mockIdle,
  alarms: { create: mockAlarmsCreate, clear: mockAlarmsClear, get: mockAlarmsGet },
});

import {
  initExportScheduler,
  scheduleImmediateFlush,
  ensureDailyFlushArmed,
  IDLE_FALLBACK_ALARM,
  DAILY_FLUSH_ALARM,
  IMMEDIATE_FLUSH_ALARM,
} from '../localMarkdownIdleFlusher.js';

describe('initExportScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so the pending-clear stand-in below
    // would otherwise leak into every later test.
    mockAlarmsClear.mockReset();
  });

  it('registers idle listener and 30-min fallback alarm for timing="idle"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'idle' });

    await initExportScheduler();

    expect(mockAlarmsClear).toHaveBeenCalledWith(IDLE_FALLBACK_ALARM);
    expect(mockAlarmsClear).toHaveBeenCalledWith(DAILY_FLUSH_ALARM);
    expect(mockAlarmsCreate).toHaveBeenCalledWith(IDLE_FALLBACK_ALARM, { periodInMinutes: 30 });
    expect(mockOnStateChangedAddListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it('registers only the daily alarm for timing="daily"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'daily' });

    await initExportScheduler();

    expect(mockAlarmsCreate).toHaveBeenCalledWith(
      DAILY_FLUSH_ALARM,
      expect.objectContaining({ periodInMinutes: 1440 })
    );
    expect(mockAlarmsCreate).not.toHaveBeenCalledWith(IDLE_FALLBACK_ALARM, expect.anything());
    expect(mockOnStateChangedAddListener).not.toHaveBeenCalled();
  });

  it('registers no alarms or listeners for timing="manual"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'manual' });

    await initExportScheduler();

    expect(mockAlarmsCreate).not.toHaveBeenCalled();
    expect(mockOnStateChangedAddListener).not.toHaveBeenCalled();
  });

  it('registers no standing alarm or listener for timing="immediate"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'immediate' });

    await initExportScheduler();

    expect(mockAlarmsCreate).not.toHaveBeenCalled();
    expect(mockOnStateChangedAddListener).not.toHaveBeenCalled();
  });

  it('leaves an armed immediate one-shot in place so a settings save cannot drop the buffered export', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'immediate' });
    scheduleImmediateFlush();
    expect(mockAlarmsCreate).toHaveBeenCalledWith(
      IMMEDIATE_FLUSH_ALARM,
      expect.objectContaining({ when: expect.any(Number) })
    );
    mockAlarmsCreate.mockClear();

    await initExportScheduler();

    // scheduleImmediateFlush owns the one-shot; a re-init that cleared it would
    // hold the buffered entries back until the next recording.
    expect(mockAlarmsClear).not.toHaveBeenCalledWith(IMMEDIATE_FLUSH_ALARM);
    expect(mockAlarmsCreate).not.toHaveBeenCalled();
  });

  it('keeps a stale immediate one-shot when switching to daily (harmless overwrite)', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'immediate' });
    scheduleImmediateFlush();
    expect(mockAlarmsCreate).toHaveBeenCalledWith(IMMEDIATE_FLUSH_ALARM, expect.any(Object));
    mockAlarmsCreate.mockClear();

    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'daily' });
    await initExportScheduler();

    // The old one-shot may still fire once after the switch. Accepted: the
    // flush rewrites the same daily file with conflictAction: 'overwrite'.
    expect(mockAlarmsClear.mock.calls.map(([name]) => name)).toEqual([
      IDLE_FALLBACK_ALARM,
      DAILY_FLUSH_ALARM,
    ]);
    expect(mockAlarmsCreate).toHaveBeenCalledTimes(1);
    expect(mockAlarmsCreate).toHaveBeenCalledWith(
      DAILY_FLUSH_ALARM,
      expect.objectContaining({ periodInMinutes: 1440 })
    );
  });

  it('awaits the standing-alarm clears before creating the new alarm', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'daily' });
    const clearedNames: string[] = [];
    let releaseClears = (): void => {};
    const pendingClears = new Promise<void>((resolve) => {
      releaseClears = resolve;
    });
    mockAlarmsClear.mockImplementation((name: string) => {
      clearedNames.push(name);
      return pendingClears;
    });

    const init = initExportScheduler();
    // A macrotask turn lets the scheduler run through every already-resolved
    // await; it must still be parked on the pending clear.
    await drainMacrotask();
    expect(clearedNames).toEqual([IDLE_FALLBACK_ALARM]);
    expect(mockAlarmsCreate).not.toHaveBeenCalled();

    releaseClears();
    await init;

    expect(clearedNames).toEqual([IDLE_FALLBACK_ALARM, DAILY_FLUSH_ALARM]);
    expect(mockAlarmsCreate).toHaveBeenCalledWith(
      DAILY_FLUSH_ALARM,
      expect.objectContaining({ periodInMinutes: 1440 })
    );
  });

  it('clears only the standing alarms on a mode switch, with no listener left behind', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'manual' });

    await initExportScheduler();

    expect(mockAlarmsClear.mock.calls.map(([name]) => name)).toEqual([
      IDLE_FALLBACK_ALARM,
      DAILY_FLUSH_ALARM,
    ]);
    expect(mockAlarmsCreate).not.toHaveBeenCalled();
    expect(mockOnStateChangedAddListener).not.toHaveBeenCalled();
  });

  it('never accumulates idle listeners across repeated init calls', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'idle' });

    await initExportScheduler();
    await initExportScheduler();
    await initExportScheduler();

    // Same named handler every time, always removed before it is re-added
    // (the first init removes a stale handler from a previous SW generation,
    // which is a no-op): the net registration count stays 1 no matter how
    // often settings saves or connection tests re-run the scheduler.
    expect(mockOnStateChangedAddListener).toHaveBeenCalledTimes(3);
    expect(mockOnStateChangedRemoveListener).toHaveBeenCalledTimes(3);
    const registered = mockOnStateChangedAddListener.mock.calls.map(([fn]) => fn);
    expect(registered[0]).toBe(registered[1]);
    expect(registered[1]).toBe(registered[2]);
    expect(mockOnStateChangedRemoveListener.mock.calls[2]?.[0]).toBe(registered[2]);
  });

  it('removes a stale idle listener when the mode switches away from idle', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'idle' });
    await initExportScheduler();
    expect(mockOnStateChangedAddListener).toHaveBeenCalledTimes(1);

    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'daily' });
    await initExportScheduler();

    expect(mockOnStateChangedRemoveListener).toHaveBeenCalledTimes(2);
    expect(mockOnStateChangedRemoveListener.mock.calls[1]?.[0]).toBe(
      mockOnStateChangedAddListener.mock.calls[0]?.[0]
    );
    expect(mockOnStateChangedAddListener).toHaveBeenCalledTimes(1);
  });
});

describe('ensureDailyFlushArmed (recording-side arm-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAlarmsClear.mockReset();
    mockAlarmsGet.mockReset();
    mockAlarmsGet.mockResolvedValue(undefined);
  });

  it('arms the daily alarm with a midnight when when unarmed', async () => {
    mockAlarmsGet.mockResolvedValue(undefined);

    await ensureDailyFlushArmed();

    expect(mockAlarmsGet).toHaveBeenCalledWith(DAILY_FLUSH_ALARM);
    expect(mockAlarmsCreate).toHaveBeenCalledTimes(1);
    expect(mockAlarmsCreate).toHaveBeenCalledWith(
      DAILY_FLUSH_ALARM,
      expect.objectContaining({ when: expect.any(Number), periodInMinutes: 1440 })
    );
  });

  it('leaves an armed daily alarm untouched so the midnight when survives recordings', async () => {
    mockAlarmsGet.mockResolvedValue({ name: DAILY_FLUSH_ALARM } as chrome.alarms.Alarm);

    await ensureDailyFlushArmed();

    expect(mockAlarmsCreate).not.toHaveBeenCalled();
  });
});
