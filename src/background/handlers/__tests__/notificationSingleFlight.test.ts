import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNotificationHandlers } from '../notificationHandlers.js';
import { getPendingPages, removePendingPages } from '../../../utils/pendingStorage.js';

/**
 * VULN-009 reproduction: a fast double-click delivers two onButtonClicked events
 * for the same notification/URL. Without a single-flight guard both read the
 * page as pending and both call record() (double record). With the guard,
 * record() runs exactly once.
 */

vi.mock('../urlNotificationHandlers.js', () => ({
  decodeUrlFromNotificationId: vi.fn(async () => 'https://example.com/page'),
}));

const pendingPage = {
  url: 'https://example.com/page',
  title: 'Example',
  timestamp: 1,
  reason: 'cache-control' as const,
  expiry: Date.now() + 60_000,
};

vi.mock('../../../utils/pendingStorage.js', () => ({
  getPendingPages: vi.fn(),
  removePendingPages: vi.fn(async () => {}),
}));

vi.mock('../../notificationHelper.js', () => ({
  PRIVACY_CONFIRM_NOTIFICATION_PREFIX: 'privacy-confirm-',
}));

vi.mock('../../../utils/logger.js', () => ({
  logWarn: vi.fn(async () => {}),
  logError: vi.fn(async () => {}),
  ErrorCode: { UNKNOWN_ERROR: 'x', INVALID_INPUT: 'x', INTERNAL_ERROR: 'x' },
}));

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).chrome = {
    notifications: { clear: vi.fn(() => Promise.resolve()) },
  };
});

describe('notification button single-flight (VULN-009)', () => {
  it('records only once for two concurrent clicks on the same URL', async () => {
    // getPendingPages resolves slowly so the second click enters before the
    // first has removed the page.
    let resolveGet!: (v: unknown[]) => void;
    (getPendingPages as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => { resolveGet = r as (v: unknown[]) => void; })
    );

    const record = vi.fn(async () => ({ success: true }) as never);
    const { onButtonClicked } = createNotificationHandlers({ record });

    const p1 = onButtonClicked('privacy-confirm-abc', 0);
    await Promise.resolve();
    const p2 = onButtonClicked('privacy-confirm-abc', 0);
    await Promise.resolve();

    resolveGet([pendingPage]);
    await Promise.all([p1, p2]);

    expect(record).toHaveBeenCalledTimes(1);
    expect(removePendingPages).toHaveBeenCalledTimes(1);
  });
});
