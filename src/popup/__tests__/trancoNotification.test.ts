// @vitest-environment jsdom
/**
 * trancoNotification.test.ts
 * Tests for Tranco update notification banner UI and consent handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockSaveSettingsWithAllowedUrls = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());
const mockUpdateDomainFilterCache = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: mockGetSettings,
    setAll: mockSaveSettingsWithAllowedUrls,
    get: mockGetSettings,
    getMany: mockGetSettings,
    set: mockSaveSettingsWithAllowedUrls,
    clearCache: vi.fn(),
  },
  SettingsRepository: class {},
  ChromeStoragePort: class {},
  InMemoryStoragePort: class {},
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: mockGetSettings,
    saveSettingsWithAllowedUrls: mockSaveSettingsWithAllowedUrls,
    StorageKeys: {
      TRANCO_VERSION: 'tranco_version',
      TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
      TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
      TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
    },

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

    getSettings: mockGetSettings,
    saveSettingsWithAllowedUrls: mockSaveSettingsWithAllowedUrls,
    StorageKeys: {
      TRANCO_VERSION: 'tranco_version',
      TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
      TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
      TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
    },

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

    getSettings: mockGetSettings,
    saveSettingsWithAllowedUrls: mockSaveSettingsWithAllowedUrls,
    StorageKeys: {
      TRANCO_VERSION: 'tranco_version',
      TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
      TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
      TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
    },

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

    getSettings: mockGetSettings,
    saveSettingsWithAllowedUrls: mockSaveSettingsWithAllowedUrls,
    StorageKeys: {
      TRANCO_VERSION: 'tranco_version',
      TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
      TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
      TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
    },

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

    getSettings: mockGetSettings,
    saveSettingsWithAllowedUrls: mockSaveSettingsWithAllowedUrls,
    StorageKeys: {
      TRANCO_VERSION: 'tranco_version',
      TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
      TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
      TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
    },
    updateDomainFilterCache: mockUpdateDomainFilterCache,

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

    getSettings: mockGetSettings,
    saveSettingsWithAllowedUrls: mockSaveSettingsWithAllowedUrls,
    StorageKeys: {
      TRANCO_VERSION: 'tranco_version',
      TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
      TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
      TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
    },

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

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logError: mockLogError,
    ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  return i18nMock(mockGetMessage);
});

import { initTrancoUpdateNotification } from '../trancoNotification.js';

// ============================================================================
// Helpers
// ============================================================================

function setupBannerElements(): void {
  document.body.innerHTML = `
    <div id="trancoUpdateBanner" class="hidden">
      <div id="trancoUpdateDesc"></div>
      <div id="trancoUpdateActions"></div>
    </div>
  `;
}

// ============================================================================
// Tests
// ============================================================================

describe('initTrancoUpdateNotification', () => {
  beforeEach(() => {
    setupBannerElements();
    mockGetSettings.mockReset();
    mockSaveSettingsWithAllowedUrls.mockReset();
    mockLogError.mockReset();
    mockGetMessage.mockImplementation((key: string) => {
      const messages: Record<string, string> = {
        trancoUpdateNotificationDescription: 'Tranco list has been updated.',
        trancoUpdateConfirm: 'Accept',
        trancoUpdateDeny: 'Deny',
      };
      return messages[key] || key;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return early when banner elements are missing', async () => {
    document.body.innerHTML = '';
    console.warn = vi.fn();

    await initTrancoUpdateNotification();

    expect(console.warn).toHaveBeenCalledWith(
      '[Popup] Tranco update banner elements not found'
    );
    expect(mockGetSettings).not.toHaveBeenCalled();
  });

  it('should return early when no current version is set', async () => {
    mockGetSettings.mockResolvedValue({});

    await initTrancoUpdateNotification();

    const banner = document.getElementById('trancoUpdateBanner');
    expect(banner?.classList.contains('hidden')).toBe(true);
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
  });

  it('should show the banner when consent was never granted', async () => {
    mockGetSettings.mockResolvedValue({
      tranco_version: 'v2',
      tranco_consent_granted: null,
      tranco_consent_denied_reason: null,
      tranco_consent_denied_timestamp: null,
    });

    await initTrancoUpdateNotification();

    const banner = document.getElementById('trancoUpdateBanner');
    expect(banner?.classList.contains('hidden')).toBe(false);

    const desc = document.getElementById('trancoUpdateDesc');
    expect(desc?.textContent).toBe('Tranco list has been updated.');

    const actions = document.getElementById('trancoUpdateActions');
    expect(actions?.children.length).toBe(2);
    expect(actions?.children[0]?.textContent).toBe('Accept');
    expect(actions?.children[1]?.textContent).toBe('Deny');
  });

  it('should show the banner when granted version differs and the retry window has passed', async () => {
    // Well past the retry window: the 29/30/31-day boundary itself is pinned in
    // src/utils/storage/__tests__/trancoConsent.test.ts. This suite covers the
    // popup-side mapping, boolean decision -> banner visibility.
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    mockGetSettings.mockResolvedValue({
      tranco_version: 'v2',
      tranco_consent_granted: 'v1',
      tranco_consent_denied_reason: 'deny',
      tranco_consent_denied_timestamp: thirtyOneDaysAgo,
    });

    await initTrancoUpdateNotification();

    const banner = document.getElementById('trancoUpdateBanner');
    expect(banner?.classList.contains('hidden')).toBe(false);
  });

  it('should NOT show the banner while the retry window is still open', async () => {
    const twentyDaysAgo = Date.now() - 20 * 24 * 60 * 60 * 1000;
    mockGetSettings.mockResolvedValue({
      tranco_version: 'v2',
      tranco_consent_granted: 'v1',
      tranco_consent_denied_reason: 'deny',
      tranco_consent_denied_timestamp: twentyDaysAgo,
    });

    await initTrancoUpdateNotification();

    const banner = document.getElementById('trancoUpdateBanner');
    expect(banner?.classList.contains('hidden')).toBe(true);
  });

  it('should NOT show the banner when consent already granted for current version', async () => {
    mockGetSettings.mockResolvedValue({
      tranco_version: 'v2',
      tranco_consent_granted: 'v2',
      tranco_consent_denied_reason: null,
      tranco_consent_denied_timestamp: null,
    });

    await initTrancoUpdateNotification();

    const banner = document.getElementById('trancoUpdateBanner');
    expect(banner?.classList.contains('hidden')).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    mockGetSettings.mockRejectedValue(new Error('Storage error'));
    console.warn = vi.fn();

    await initTrancoUpdateNotification();

    expect(mockLogError).toHaveBeenCalledWith(
      '[Popup] Error initializing Tranco update notification',
      expect.objectContaining({ cause: expect.any(Error) }),
      'INTERNAL_ERROR'
    );
  });

  describe('consent button behavior', () => {
    beforeEach(() => {
      // The handlers run through the shared consent module; assertions target
      // the storage delta it writes, so no timer control is needed here.
    });

    it('should grant consent when accept button is clicked', async () => {
      mockGetSettings.mockResolvedValue({
        tranco_version: 'v2',
        tranco_consent_granted: null,
        tranco_consent_denied_reason: null,
        tranco_consent_denied_timestamp: null,
      });

      await initTrancoUpdateNotification();

      const banner = document.getElementById('trancoUpdateBanner');
      expect(banner?.classList.contains('hidden')).toBe(false);

      const acceptBtn = document.querySelector('#trancoUpdateActions button:first-child') as HTMLElement;
      acceptBtn.click();
      await vi.waitFor(() => {
        expect(mockSaveSettingsWithAllowedUrls).toHaveBeenCalledWith(
          expect.objectContaining({
            tranco_consent_granted: 'v2',
            tranco_consent_denied_reason: null,
            tranco_consent_denied_timestamp: null,
          })
        );
      });

      expect(banner?.classList.contains('hidden')).toBe(true);
    });

    it('should deny consent when deny button is clicked', async () => {
      mockGetSettings.mockResolvedValue({
        tranco_version: 'v2',
        tranco_consent_granted: null,
        tranco_consent_denied_reason: null,
        tranco_consent_denied_timestamp: null,
      });

      await initTrancoUpdateNotification();

      const banner = document.getElementById('trancoUpdateBanner');
      expect(banner?.classList.contains('hidden')).toBe(false);

      const denyBtn = document.querySelector('#trancoUpdateActions button:last-child') as HTMLElement;
      denyBtn.click();
      await vi.waitFor(() => {
        expect(mockSaveSettingsWithAllowedUrls).toHaveBeenCalledWith(
          expect.objectContaining({
            tranco_consent_granted: null,
            tranco_consent_denied_reason: 'deny',
          })
        );
      });

      expect(banner?.classList.contains('hidden')).toBe(true);
    });

    it('should handle error during grant', async () => {
      mockGetSettings.mockResolvedValue({
        tranco_version: 'v2',
        tranco_consent_granted: null,
      });
      mockSaveSettingsWithAllowedUrls.mockRejectedValue(new Error('Save failed'));

      await initTrancoUpdateNotification();

      const acceptBtn = document.querySelector('#trancoUpdateActions button:first-child') as HTMLElement;
      acceptBtn.click();
      await vi.waitFor(() => {
        expect(mockLogError).toHaveBeenCalledWith(
          '[Popup] Error granting Tranco consent',
          expect.objectContaining({ cause: expect.any(Error) }),
          'INTERNAL_ERROR'
        );
      });
    });

    it('should handle error during deny', async () => {
      mockGetSettings.mockResolvedValue({
        tranco_version: 'v2',
        tranco_consent_granted: null,
      });
      mockSaveSettingsWithAllowedUrls.mockRejectedValue(new Error('Save failed'));

      await initTrancoUpdateNotification();

      const denyBtn = document.querySelector('#trancoUpdateActions button:last-child') as HTMLElement;
      denyBtn.click();
      await vi.waitFor(() => {
        expect(mockLogError).toHaveBeenCalledWith(
          '[Popup] Error denying Tranco consent',
          expect.objectContaining({ cause: expect.any(Error) }),
          'INTERNAL_ERROR'
        );
      });
    });
  });
});
