import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

vi.mock('../../notificationHelper.js', () => ({
  NotificationHelper: {
    notifySuccess: vi.fn(),
  },
}));

vi.mock('../../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { saveToObsidianStep } from '../steps/saveToObsidianStep.js';
import { addLog, LogType } from '../../../utils/logger.js';
import type { RecordingContext } from '../types.js';
import { StorageKeys } from '../../../utils/storage.js';

function makeContext(overrides: Partial<RecordingContext['settings']> = {}): RecordingContext {
  return {
    data: {
      url: 'https://example.com',
      title: 'Example Page',
      content: '<p>Hello</p>',
      favIconUrl: '',
      engagement: { duration: 10, scrollDepth: 50 },
    },
    settings: {
      [StorageKeys.OBSIDIAN_API_KEY]: 'test-api-key-123456',
      [StorageKeys.OBSIDIAN_PROTOCOL]: 'https',
      [StorageKeys.OBSIDIAN_PORT]: '27124',
      [StorageKeys.OBSIDIAN_DAILY_PATH]: '092.Daily',
      [StorageKeys.OBSIDIAN_ENABLED]: true,
      ...overrides,
    } as RecordingContext['settings'],
    force: false,
    errors: [],
    markdown: '## Example Page\n\nTest content',
  };
}

function makeMockObsidian() {
  return {
    appendToDailyNote: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('saveToObsidianStep — obsidian_enabled flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips save when OBSIDIAN_ENABLED is false', async () => {
    const mockObsidian = makeMockObsidian();
    const context = makeContext({
      [StorageKeys.OBSIDIAN_ENABLED]: false,
    });

    const result = await saveToObsidianStep(context, mockObsidian);

    expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
    expect(result).toBe(context);
    expect(addLog).toHaveBeenCalledWith(
      LogType.INFO,
      'Obsidian disabled by user, skipping save',
      expect.objectContaining({ url: 'https://example.com' })
    );
  });

  it('proceeds with save when OBSIDIAN_ENABLED is true', async () => {
    const mockObsidian = makeMockObsidian();
    const context = makeContext({
      [StorageKeys.OBSIDIAN_ENABLED]: true,
    });

    const result = await saveToObsidianStep(context, mockObsidian);

    expect(mockObsidian.appendToDailyNote).toHaveBeenCalledWith('## Example Page\n\nTest content');
    expect(result.obsidianDuration).toBeGreaterThanOrEqual(0);
    expect(result).not.toBe(context);
  });

  it('skips save when no markdown is provided', async () => {
    const mockObsidian = makeMockObsidian();
    const context = makeContext({
      [StorageKeys.OBSIDIAN_ENABLED]: true,
    });
    context.markdown = undefined;

    const result = await saveToObsidianStep(context, mockObsidian);

    expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      LogType.WARN,
      'No markdown to save to Obsidian',
      expect.objectContaining({ url: 'https://example.com' })
    );
    expect(result).toBe(context);
  });

  it('skips save when obsidian client is not injected and API key is too short', async () => {
    const context = makeContext({
      [StorageKeys.OBSIDIAN_ENABLED]: true,
      [StorageKeys.OBSIDIAN_API_KEY]: 'short',
    });

    const result = await saveToObsidianStep(context);

    expect(addLog).toHaveBeenCalledWith(
      LogType.INFO,
      'Obsidian not configured, skipping save',
      expect.objectContaining({ url: 'https://example.com' })
    );
    expect(result).toBe(context);
  });

  it('throws on appendToDailyNote failure', async () => {
    const mockObsidian = makeMockObsidian();
    mockObsidian.appendToDailyNote.mockRejectedValueOnce(new Error('Connection refused'));

    const context = makeContext({
      [StorageKeys.OBSIDIAN_ENABLED]: true,
    });

    await expect(saveToObsidianStep(context, mockObsidian)).rejects.toThrow('Connection refused');
    expect(addLog).toHaveBeenCalledWith(
      LogType.ERROR,
      'Failed to save to Obsidian',
      expect.objectContaining({ error: 'Connection refused' })
    );
  });
});
