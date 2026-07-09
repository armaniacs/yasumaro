/**
 * reviewSummaryAlarm.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/storage.js', () => ({
  getSettings: vi.fn(),
  StorageKeys: { REVIEW_SUMMARY_ENABLED: 'review_summary_enabled' },
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

vi.mock('../reviewSummaryGenerator.js', () => ({
  generateWeeklySummary: vi.fn().mockResolvedValue(true),
  generateMonthlySummary: vi.fn().mockResolvedValue(true),
}));

import { getSettings } from '../../utils/storage.js';
import { addLog } from '../../utils/logger.js';
import { generateWeeklySummary, generateMonthlySummary } from '../reviewSummaryGenerator.js';

let alarmListener: ((alarm: { name: string }) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  alarmListener = undefined;
  vi.stubGlobal('chrome', {
    ...(globalThis as any).chrome,
    alarms: {
      create: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(true),
      onAlarm: {
        addListener: vi.fn((cb: (alarm: { name: string }) => void) => {
          alarmListener = cb;
        }),
      },
    },
  });
  vi.mocked(generateWeeklySummary).mockReset().mockResolvedValue(true);
  vi.mocked(generateMonthlySummary).mockReset().mockResolvedValue(true);
  vi.resetModules();
});

describe('initializeReviewSummaryAlarms', () => {
  it('creates weekly and monthly alarms when enabled', async () => {
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: true } as any);
    const { initializeReviewSummaryAlarms } = await import('../reviewSummaryAlarm.js');

    await initializeReviewSummaryAlarms();

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'yasumaro-review-weekly',
      expect.objectContaining({ periodInMinutes: 7 * 24 * 60 }),
    );
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'yasumaro-review-monthly',
      expect.objectContaining({ periodInMinutes: 31 * 24 * 60 }),
    );
    expect(chrome.alarms.clear).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith('INFO', 'Review summary alarms initialized');
  });

  it('clears alarms when disabled', async () => {
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: false } as any);
    const { initializeReviewSummaryAlarms } = await import('../reviewSummaryAlarm.js');

    await initializeReviewSummaryAlarms();

    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-review-weekly');
    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-review-monthly');
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
});

describe('setupReviewSummaryAlarmListener', () => {
  it('registers the alarm listener and guards against double registration', async () => {
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener();
    setupReviewSummaryAlarmListener();

    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    expect(alarmListener).toBeDefined();
  });

  it('does nothing for unknown alarm names', async () => {
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener();
    alarmListener!({ name: 'some-other-alarm' });

    expect(generateWeeklySummary).not.toHaveBeenCalled();
    expect(generateMonthlySummary).not.toHaveBeenCalled();
  });

  it('calls generateWeeklySummary on weekly alarm', async () => {
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener();
    alarmListener!({ name: 'yasumaro-review-weekly' });

    expect(generateWeeklySummary).toHaveBeenCalledTimes(1);
    expect(generateMonthlySummary).not.toHaveBeenCalled();
  });

  it('calls generateMonthlySummary on monthly alarm', async () => {
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener();
    alarmListener!({ name: 'yasumaro-review-monthly' });

    expect(generateMonthlySummary).toHaveBeenCalledTimes(1);
    expect(generateWeeklySummary).not.toHaveBeenCalled();
  });

  it('logs error when weekly summary fails', async () => {
    vi.mocked(generateWeeklySummary).mockRejectedValue(new Error('network error'));
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener();
    alarmListener!({ name: 'yasumaro-review-weekly' });

    await vi.waitFor(() => {
      expect(addLog).toHaveBeenCalledWith('ERROR', 'Weekly summary alarm failed', {
        error: expect.stringContaining('network error'),
      });
    });
  });

  it('logs error when monthly summary fails', async () => {
    vi.mocked(generateMonthlySummary).mockRejectedValue(new Error('timeout'));
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener();
    alarmListener!({ name: 'yasumaro-review-monthly' });

    await vi.waitFor(() => {
      expect(addLog).toHaveBeenCalledWith('ERROR', 'Monthly summary alarm failed', {
        error: expect.stringContaining('timeout'),
      });
    });
  });
});
