import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notify } from '../notificationService.js';
import { logWarn } from '../../utils/logger/api.js';

vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({ logWarn: 'fn' }),
);

describe('notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { chrome?: unknown }).chrome = {
      notifications: {
        create: vi.fn(),
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test${path}`),
      },
    };
  });

  it('creates a basic notification with the given title and message', () => {
    expect(notify('Title', 'Message')).toBe(true);
    const create = (globalThis as unknown as { chrome: { notifications: { create: ReturnType<typeof vi.fn> } } }).chrome.notifications.create;
    expect(create).toHaveBeenCalledWith(
      {
        type: 'basic',
        iconUrl: 'chrome-extension://test/icons/icon48.png',
        title: 'Title',
        message: 'Message',
      },
      expect.any(Function),
    );
  });

  it('returns false and logs instead of throwing when chrome.notifications is unavailable', () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { getURL: vi.fn((path: string) => path) },
    };
    expect(notify('Title', 'Message')).toBe(false);
    expect(logWarn).toHaveBeenCalled();
  });

  it('routes chrome.runtime.lastError through the log seam', () => {
    (globalThis as { chrome?: unknown }).chrome = {
      notifications: {
        create: vi.fn((_options: unknown, callback: () => void) => callback()),
      },
      runtime: {
        getURL: vi.fn((path: string) => path),
        lastError: { message: 'denied' },
      },
    };
    expect(notify('Title', 'Message')).toBe(true);
    expect(logWarn).toHaveBeenCalledWith(
      'notify: notification was not shown',
      expect.objectContaining({ error: 'denied' }),
      expect.anything(),
      'notificationService',
    );
  });

  it('returns false and logs when create throws', () => {
    (globalThis as { chrome?: unknown }).chrome = {
      notifications: {
        create: vi.fn(() => {
          throw new Error('boom');
        }),
      },
      runtime: { getURL: vi.fn((path: string) => path) },
    };
    expect(notify('Title', 'Message')).toBe(false);
    expect(logWarn).toHaveBeenCalled();
  });
});
