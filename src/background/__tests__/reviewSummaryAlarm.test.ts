/**
 * reviewSummaryAlarm.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAll = vi.hoisted(() => vi.fn());
const mockSetAll = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      setAll: mockSetAll,
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = mockSetAll;
      getMany = vi.fn();
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
}));

import { addLog } from '../../utils/logger.js';
import type { ReviewSummaryGenerator } from '../reviewSummaryGenerator.js';

let alarmListener: ((alarm: { name: string }) => void) | undefined;

/** generatorはcomposition rootから注入される契約なので、fakeで差し替える */
function makeFakeGenerator(): ReviewSummaryGenerator {
  return {
    generateWeeklySummary: vi.fn().mockResolvedValue(true),
    generateMonthlySummary: vi.fn().mockResolvedValue(true),
  };
}

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
  vi.resetModules();
});

describe('initializeReviewSummaryAlarms', () => {
  it('creates weekly and monthly alarms when enabled', async () => {
    const generator = makeFakeGenerator();
    mockGetAll.mockResolvedValue({ review_summary_enabled: true } as any);
    const { initializeReviewSummaryAlarms } = await import('../reviewSummaryAlarm.js');

    await initializeReviewSummaryAlarms(generator);

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
    const generator = makeFakeGenerator();
    mockGetAll.mockResolvedValue({ review_summary_enabled: false } as any);
    const { initializeReviewSummaryAlarms } = await import('../reviewSummaryAlarm.js');

    await initializeReviewSummaryAlarms(generator);

    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-review-weekly');
    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-review-monthly');
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });
});

describe('setupReviewSummaryAlarmListener', () => {
  it('registers the alarm listener and guards against double registration', async () => {
    const generator = makeFakeGenerator();
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener(generator);
    setupReviewSummaryAlarmListener(generator);

    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    expect(alarmListener).toBeDefined();
  });

  it('does nothing for unknown alarm names', async () => {
    const generator = makeFakeGenerator();
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener(generator);
    alarmListener!({ name: 'some-other-alarm' });

    expect(generator.generateWeeklySummary).not.toHaveBeenCalled();
    expect(generator.generateMonthlySummary).not.toHaveBeenCalled();
  });

  it('calls generateWeeklySummary on weekly alarm', async () => {
    const generator = makeFakeGenerator();
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener(generator);
    alarmListener!({ name: 'yasumaro-review-weekly' });

    expect(generator.generateWeeklySummary).toHaveBeenCalledTimes(1);
    expect(generator.generateMonthlySummary).not.toHaveBeenCalled();
  });

  it('calls generateMonthlySummary on monthly alarm', async () => {
    const generator = makeFakeGenerator();
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener(generator);
    alarmListener!({ name: 'yasumaro-review-monthly' });

    expect(generator.generateMonthlySummary).toHaveBeenCalledTimes(1);
    expect(generator.generateWeeklySummary).not.toHaveBeenCalled();
  });

  it('logs error when weekly summary fails', async () => {
    const generator = makeFakeGenerator();
    (generator.generateWeeklySummary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener(generator);
    alarmListener!({ name: 'yasumaro-review-weekly' });

    await vi.waitFor(() => {
      expect(addLog).toHaveBeenCalledWith('ERROR', 'Weekly summary alarm failed', {
        error: expect.stringContaining('network error'),
      });
    });
  });

  it('logs error when monthly summary fails', async () => {
    const generator = makeFakeGenerator();
    (generator.generateMonthlySummary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
    const { setupReviewSummaryAlarmListener } = await import('../reviewSummaryAlarm.js');

    setupReviewSummaryAlarmListener(generator);
    alarmListener!({ name: 'yasumaro-review-monthly' });

    await vi.waitFor(() => {
      expect(addLog).toHaveBeenCalledWith('ERROR', 'Monthly summary alarm failed', {
        error: expect.stringContaining('timeout'),
      });
    });
  });
});
