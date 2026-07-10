/**
 * localMarkdownIdleFlusher.test.ts
 * initExportScheduler wires the alarm/listener combination matching the
 * user's chosen LOCAL_MARKDOWN_EXPORT_TIMING.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockFlushBufferedExports = vi.hoisted(() => vi.fn());
const mockOnStateChangedAddListener = vi.hoisted(() => vi.fn());
const mockIdle = vi.hoisted(() => ({ onStateChanged: { addListener: mockOnStateChangedAddListener } }));
const mockAlarmsCreate = vi.hoisted(() => vi.fn());
const mockAlarmsClear = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
  },
  getSettings: mockGetSettings,
}));

vi.mock('../localMarkdownExportCore.js', () => ({
  flushBufferedExports: mockFlushBufferedExports,
}));

vi.stubGlobal('chrome', {
  idle: mockIdle,
  alarms: { create: mockAlarmsCreate, clear: mockAlarmsClear },
});

import { initExportScheduler, IDLE_FALLBACK_ALARM, DAILY_FLUSH_ALARM } from '../localMarkdownIdleFlusher.js';

describe('initExportScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('registers no alarms or listeners for timing="immediate"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'immediate' });

    await initExportScheduler();

    expect(mockAlarmsCreate).not.toHaveBeenCalled();
    expect(mockOnStateChangedAddListener).not.toHaveBeenCalled();
  });

  it('always clears both alarms before registering new ones (mode switch safety)', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'manual' });

    await initExportScheduler();

    expect(mockAlarmsClear).toHaveBeenCalledWith(IDLE_FALLBACK_ALARM);
    expect(mockAlarmsClear).toHaveBeenCalledWith(DAILY_FLUSH_ALARM);
  });
});
