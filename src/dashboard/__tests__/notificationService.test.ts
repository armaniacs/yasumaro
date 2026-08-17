import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notify } from '../notificationService.js';

describe('notify', () => {
  beforeEach(() => {
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
    notify('Title', 'Message');
    const create = (globalThis as unknown as { chrome: { notifications: { create: ReturnType<typeof vi.fn> } } }).chrome.notifications.create;
    expect(create).toHaveBeenCalledWith({
      type: 'basic',
      iconUrl: 'chrome-extension://test/icons/icon48.png',
      title: 'Title',
      message: 'Message',
    });
  });

  it('does not throw when chrome.notifications is unavailable', () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { getURL: vi.fn((path: string) => path) },
    };
    expect(() => notify('Title', 'Message')).not.toThrow();
  });
});
