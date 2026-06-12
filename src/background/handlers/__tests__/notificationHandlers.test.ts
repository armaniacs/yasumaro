import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidNotificationUrl, createNotificationHandlers } from '../notificationHandlers.js';

vi.mock('../urlNotificationHandlers.js', () => ({
  decodeUrlFromNotificationId: vi.fn(async (id: string) => {
    // テスト用: プレフィックス以降を URL として返す
    return 'https://example.com/page';
  }),
}));

vi.mock('../../../utils/pendingStorage.js', () => ({
  getPendingPages: vi.fn(async () => []),
  removePendingPages: vi.fn(async () => {}),
}));

vi.mock('../../notificationHelper.js', () => ({
  PRIVACY_CONFIRM_NOTIFICATION_PREFIX: 'privacy-confirm-',
}));

vi.mock('../../../utils/logger.js', () => ({
  logWarn: vi.fn(async () => {}),
  logError: vi.fn(async () => {}),
  ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INVALID_INPUT: 'INVALID_INPUT', INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

beforeEach(() => {
  (globalThis as Record<string, unknown>).chrome = {
    notifications: {
      clear: vi.fn(() => Promise.resolve()),
    },
  };
});

describe('isValidNotificationUrl', () => {
  it('accepts https URLs', () => {
    expect(isValidNotificationUrl('https://example.com')).toBe(true);
  });

  it('accepts http URLs', () => {
    expect(isValidNotificationUrl('http://example.com')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidNotificationUrl('')).toBe(false);
  });

  it('rejects javascript: URLs', () => {
    expect(isValidNotificationUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(isValidNotificationUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  it('rejects URLs longer than 2000 characters', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2000);
    expect(isValidNotificationUrl(longUrl)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidNotificationUrl(null as unknown as string)).toBe(false);
  });

  it('rejects invalid URL format', () => {
    expect(isValidNotificationUrl('not-a-url')).toBe(false);
  });

  it('accepts chrome-extension: URLs', () => {
    expect(isValidNotificationUrl('chrome-extension://abcdef/popup.html')).toBe(true);
  });
});

describe('createNotificationHandlers', () => {
  const mockRecordingLogic = {
    record: vi.fn(async () => ({ success: true })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('onClicked clears notification if it has the privacy confirm prefix', () => {
    const { onClicked } = createNotificationHandlers(mockRecordingLogic as never);
    onClicked('privacy-confirm-abc123');

    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const notifMock = chromeMock.notifications as Record<string, unknown>;
    expect(notifMock.clear).toHaveBeenCalledWith('privacy-confirm-abc123');
  });

  it('onClicked does nothing for unrelated notification IDs', () => {
    const { onClicked } = createNotificationHandlers(mockRecordingLogic as never);
    onClicked('some-other-notification-id');

    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const notifMock = chromeMock.notifications as Record<string, unknown>;
    expect(notifMock.clear).not.toHaveBeenCalled();
  });

  it('onButtonClicked does nothing for non-privacy-confirm notification IDs', async () => {
    const { onButtonClicked } = createNotificationHandlers(mockRecordingLogic as never);
    await onButtonClicked('other-notification', 0);
    expect(mockRecordingLogic.record).not.toHaveBeenCalled();
  });

  it('onButtonClicked buttonIndex=0 attempts to record from pending pages (empty list)', async () => {
    const { onButtonClicked } = createNotificationHandlers(mockRecordingLogic as never);
    await onButtonClicked('privacy-confirm-encoded', 0);
    // getPendingPages が空なので record は呼ばれない
    expect(mockRecordingLogic.record).not.toHaveBeenCalled();
  });

  it('onButtonClicked buttonIndex=1 does not record but removes pending pages', async () => {
    const { onButtonClicked } = createNotificationHandlers(mockRecordingLogic as never);
    await onButtonClicked('privacy-confirm-encoded', 1);
    expect(mockRecordingLogic.record).not.toHaveBeenCalled();
  });
});
