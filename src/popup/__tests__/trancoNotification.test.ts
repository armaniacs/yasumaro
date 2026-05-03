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

vi.mock('../../utils/storage.js', () => ({
  getSettings: mockGetSettings,
  saveSettingsWithAllowedUrls: mockSaveSettingsWithAllowedUrls,
  StorageKeys: {
    TRANCO_VERSION: 'tranco_version',
    TRANCO_CONSENT_GRANTED: 'tranco_consent_granted',
    TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason',
    TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.mock('../i18n.js', () => ({
  getMessage: mockGetMessage,
}));

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
    vi.useFakeTimers();
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
    vi.useRealTimers();
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
    expect(actions?.children[0].textContent).toBe('Accept');
    expect(actions?.children[1].textContent).toBe('Deny');
  });

  it('should show the banner when granted version differs and denied >30 days ago', async () => {
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

  it('should NOT show the banner when denied within the last 30 days', async () => {
    const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
    mockGetSettings.mockResolvedValue({
      tranco_version: 'v2',
      tranco_consent_granted: 'v1',
      tranco_consent_denied_reason: 'deny',
      tranco_consent_denied_timestamp: fiveDaysAgo,
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
      // Consent button tests do not need fake timers since the consent
      // handlers use async/await internally and we use vi.waitFor.
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
