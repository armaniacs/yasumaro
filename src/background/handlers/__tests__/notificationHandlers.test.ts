import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidNotificationUrl, createNotificationHandlers } from '../notificationHandlers.js';
import type { AdmissionOutcome } from '../../recordingAdmission.js';

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

// PBI 2026-10-19-10: pin the durable claim so the consent gate is the only
// reason the re-run can stop. Without this the claim can fail for unrelated
// reasons and the withdrawal test would pass even with the gate removed.
vi.mock('../../../utils/recoveryClaimStore.js', () => ({
  claimRecoveryOwner: vi.fn(async () => true),
  releaseRecoveryOwner: vi.fn(async () => {}),
}));

vi.mock('../../notificationHelper.js', () => ({
  PRIVACY_CONFIRM_NOTIFICATION_PREFIX: 'privacy-confirm-',
}));

vi.mock('../../../utils/logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logWarn: 'asyncNoop',
    logError: 'asyncNoop',
    ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INVALID_INPUT: 'INVALID_INPUT', INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);
vi.mock('../../../utils/logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logWarn: 'asyncNoop',
    logError: 'asyncNoop',
    ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INVALID_INPUT: 'INVALID_INPUT', INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);
vi.mock('../../../utils/logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logWarn: 'asyncNoop',
    logError: 'asyncNoop',
    ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INVALID_INPUT: 'INVALID_INPUT', INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);

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
  const mockNotificationDeps = {
    record: vi.fn(async () => ({ success: true })),
    // PBI 2026-10-18-04: the click handler runs the common admission
    // pre-stage before any record; the default mock admits (consented).
    admit: vi.fn(async (): Promise<AdmissionOutcome> => ({ settings: {} })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('onClicked clears notification if it has the privacy confirm prefix', () => {
    const { onClicked } = createNotificationHandlers(mockNotificationDeps as never);
    onClicked('privacy-confirm-abc123');

    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const notifMock = chromeMock.notifications as Record<string, unknown>;
    expect(notifMock.clear).toHaveBeenCalledWith('privacy-confirm-abc123');
  });

  it('onClicked does nothing for unrelated notification IDs', () => {
    const { onClicked } = createNotificationHandlers(mockNotificationDeps as never);
    onClicked('some-other-notification-id');

    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const notifMock = chromeMock.notifications as Record<string, unknown>;
    expect(notifMock.clear).not.toHaveBeenCalled();
  });

  it('onButtonClicked does nothing for non-privacy-confirm notification IDs', async () => {
    const { onButtonClicked } = createNotificationHandlers(mockNotificationDeps as never);
    await onButtonClicked('other-notification', 0);
    expect(mockNotificationDeps.record).not.toHaveBeenCalled();
  });

  it('onButtonClicked buttonIndex=0 attempts to record from pending pages (empty list)', async () => {
    const { onButtonClicked } = createNotificationHandlers(mockNotificationDeps as never);
    await onButtonClicked('privacy-confirm-encoded', 0);
    // getPendingPages が空なので record は呼ばれない
    expect(mockNotificationDeps.record).not.toHaveBeenCalled();
  });

  it('onButtonClicked buttonIndex=1 does not record but removes pending pages', async () => {
    const { onButtonClicked } = createNotificationHandlers(mockNotificationDeps as never);
    await onButtonClicked('privacy-confirm-encoded', 1);
    expect(mockNotificationDeps.record).not.toHaveBeenCalled();
  });

  // PBI 2026-10-18-04 (supersedes the PBI 2026-10-19-10 bare consent re-read):
  // the notification outlives the consent it was raised under. The shared
  // admission pre-stage refuses a withdrawn profile with
  // privacy_consent_required, the record never runs, and the pending page has
  // to survive so a re-consented user can retry the same action.
  it('does not record a pending page after consent was withdrawn', async () => {
    const pendingStorage = await import('../../../utils/pendingStorage.js');
    mockNotificationDeps.admit.mockResolvedValueOnce({
      rejected: { success: false, reason: 'privacy_consent_required' },
    });
    const { onButtonClicked } = createNotificationHandlers(mockNotificationDeps as never);

    await onButtonClicked('privacy-confirm-encoded', 0);

    expect(mockNotificationDeps.admit).toHaveBeenCalledWith('save');
    expect(mockNotificationDeps.record).not.toHaveBeenCalled();
    expect(pendingStorage.removePendingPages).not.toHaveBeenCalled();
  });

  // PBI 2026-10-18-04: a consented profile records exactly as before — the
  // admission pre-stage admits ({ settings }), the durable recovery claim is
  // taken and released around the record, and the pending page is removed only
  // after the successful record.
  it('records the pending page when the admission pre-stage admits', async () => {
    const pendingStorage = await import('../../../utils/pendingStorage.js');
    vi.mocked(pendingStorage.getPendingPages).mockResolvedValueOnce([
      { title: 'Example', url: 'https://example.com/page' },
    ] as never);
    const claimStore = await import('../../../utils/recoveryClaimStore.js');
    const { onButtonClicked } = createNotificationHandlers(mockNotificationDeps as never);

    await onButtonClicked('privacy-confirm-encoded', 0);

    expect(mockNotificationDeps.admit).toHaveBeenCalledWith('save');
    expect(mockNotificationDeps.record).toHaveBeenCalledTimes(1);
    expect(mockNotificationDeps.record).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Example',
        url: 'https://example.com/page',
        recordType: 'auto',
        force: true,
        skipDuplicateCheck: true,
      }),
    );
    expect(claimStore.claimRecoveryOwner).toHaveBeenCalledWith('https://example.com/page', 'manual');
    expect(claimStore.releaseRecoveryOwner).toHaveBeenCalledWith('https://example.com/page', 'manual');
    expect(pendingStorage.removePendingPages).toHaveBeenCalledWith(['https://example.com/page']);
  });
});
