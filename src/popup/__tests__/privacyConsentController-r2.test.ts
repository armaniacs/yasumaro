// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockGetPrivacyConsent = vi.hoisted(() => vi.fn());
const mockSavePrivacyConsent = vi.hoisted(() => vi.fn());
const mockMigrateLegacyPrivacyConsent = vi.hoisted(() => vi.fn());
const mockRecordPolicyVersionAcknowledgment = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());
const mockFocusTrap = vi.hoisted(() => vi.fn(() => 'trap-id-r2'));
const mockFocusRelease = vi.hoisted(() => vi.fn());
const mockChromeTabsCreate = vi.hoisted(() => vi.fn());

const storageData: Record<string, any> = {};
const mockChromeStorageGet = vi.hoisted(() => vi.fn(async (key: string | string[]) => {
  if (Array.isArray(key)) {
    const result: Record<string, any> = {};
    for (const k of key) {
      if (k in storageData) result[k] = storageData[k];
    }
    return result;
  }
  return { [key as string]: storageData[key as string] };
}));
const mockChromeStorageSet = vi.hoisted(() => vi.fn(async (items: Record<string, any>) => {
  Object.assign(storageData, items);
}));

vi.mock('../utils/focusTrap.js', () => ({
  focusTrapManager: {
    trap: mockFocusTrap,
    release: mockFocusRelease,
  },
}));

vi.mock('../i18n.js', () => ({
  getMessage: mockGetMessage,
}));

vi.mock('../privacyConsent.js', () => ({
  getPrivacyConsent: mockGetPrivacyConsent,
  savePrivacyConsent: mockSavePrivacyConsent,
  migrateLegacyPrivacyConsent: mockMigrateLegacyPrivacyConsent,
  recordPolicyVersionAcknowledgment: mockRecordPolicyVersionAcknowledgment,
}));

vi.mock('../../utils/logger.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.stubGlobal('chrome', {
  runtime: { getURL: vi.fn((path: string) => `chrome-extension://test/${path}`) },
  tabs: { create: mockChromeTabsCreate },
  storage: {
    local: {
      get: mockChromeStorageGet,
      set: mockChromeStorageSet,
    },
  },
});

import {
  initPrivacyConsent,
  setupPrivacyConsentListeners,
  setConsentCallback,
} from '../privacyConsentController.js';

function setupDom(): void {
  document.body.innerHTML = `
    <div id="privacyConsentModal" class="hidden">
      <div id="privacyConsentTitle"></div>
      <a id="viewPrivacyPolicyBtn" href="#"></a>
      <input id="consentCheckbox" type="checkbox" />
      <input id="contentStorageConsentCheckbox" type="checkbox" />
      <button id="acceptConsentBtn" disabled>Accept</button>
      <button id="declineConsentBtn">Decline</button>
    </div>
  `;
}

function getModal(): HTMLElement | null {
  return document.getElementById('privacyConsentModal');
}

function getCheckbox(): HTMLInputElement | null {
  return document.getElementById('consentCheckbox') as HTMLInputElement;
}

function getAcceptBtn(): HTMLButtonElement | null {
  return document.getElementById('acceptConsentBtn') as HTMLButtonElement;
}

describe('privacyConsentController - r2 missed branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
    for (const key of Object.keys(storageData)) {
      delete storageData[key];
    }
    mockGetPrivacyConsent.mockReset();
    mockSavePrivacyConsent.mockReset();
    mockMigrateLegacyPrivacyConsent.mockReset();
    mockLogError.mockReset();
    mockGetMessage.mockReset();
    mockFocusTrap.mockClear();
    mockFocusRelease.mockClear();
    mockChromeTabsCreate.mockReset();
    mockChromeStorageGet.mockClear();
    mockChromeStorageSet.mockClear();

    mockGetMessage.mockImplementation((key: string) => {
      const messages: Record<string, string> = {
        viewFullPolicy: 'View Full Privacy Policy',
        privacyConsentTitle: 'Privacy Policy Consent',
        saveFailed: 'Failed to save consent',
        consentRequired: 'Privacy consent is required to use this extension.',
        consentDeclinedMessage: 'Without consent, main features will not be available.',
      };
      return messages[key] || key;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initPrivacyConsent - needsReconsent path', () => {
    it('should show modal when needsReconsent is true', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false, needsReconsent: true });

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.classList.contains('hidden')).toBe(false);
      expect(modal?.style.display).toBe('flex');
      expect(mockChromeStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({ privacy_consent_denied_count: 0 })
      );
    });
  });

  describe('initPrivacyConsent - denial count paths', () => {
    it('should show modal when denied 0 times', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      storageData['privacy_consent_denied_count'] = 0;

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.classList.contains('hidden')).toBe(false);
    });

    it('should hide modal when denied 3+ times within 30 days', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      storageData['privacy_consent_denied_count'] = 3;
      storageData['privacy_consent_last_denial_time'] = Date.now() - 1000;

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.classList.contains('hidden')).toBe(true);
    });

    it('should show modal when denied 3+ times but 30 days have passed', async () => {
      const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      storageData['privacy_consent_denied_count'] = 3;
      storageData['privacy_consent_last_denial_time'] = Date.now() - THIRTY_ONE_DAYS_MS;

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.classList.contains('hidden')).toBe(false);
    });

    it('should show modal when lastDenialTime is null despite 3+ denials', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      storageData['privacy_consent_denied_count'] = 3;
      delete storageData['privacy_consent_last_denial_time'];

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.classList.contains('hidden')).toBe(false);
    });
  });

  describe('getConsentDeniedCount error path', () => {
    it('should return 0 when storage throws', async () => {
      mockChromeStorageGet.mockRejectedValueOnce(new Error('Storage error'));
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.classList.contains('hidden')).toBe(false);
      mockChromeStorageGet.mockRestore();
    });
  });

  describe('showPrivacyConsentModal - missing modal', () => {
    it('should log error when modal element is not found', async () => {
      document.body.innerHTML = '';
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      expect(mockLogError).toHaveBeenCalledWith(
        '[PrivacyConsent] Modal element not found',
        {},
        'INTERNAL_ERROR'
      );
    });
  });

  describe('handleDeclineConsent - alert behavior', () => {
    it('should show alert when count < 3', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      storageData['privacy_consent_denied_count'] = 0;

      window.alert = vi.fn();

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      const declineBtn = document.getElementById('declineConsentBtn') as HTMLButtonElement;
      declineBtn.click();

      await vi.waitFor(() => {
        expect(window.alert).toHaveBeenCalled();
      });
    });

    it('should NOT show alert when count reaches 3', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      storageData['privacy_consent_denied_count'] = 2;

      window.alert = vi.fn();

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      const declineBtn = document.getElementById('declineConsentBtn') as HTMLButtonElement;
      declineBtn.click();

      await vi.waitFor(() => {
        expect(window.alert).not.toHaveBeenCalled();
      });
    });
  });

  describe('handleAcceptConsent error branch', () => {
    it('should show error text on save button when save fails', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      mockSavePrivacyConsent.mockRejectedValue(new Error('Save failed'));

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      const cb = getCheckbox()!;
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));

      getAcceptBtn()!.click();

      await vi.waitFor(() => {
        expect(mockLogError).toHaveBeenCalledWith(
          '[PrivacyConsent] Failed to save consent',
          expect.anything(),
          'INTERNAL_ERROR'
        );
      });

      const acceptBtn = getAcceptBtn()!;
      expect(acceptBtn.textContent).toBe('Failed to save consent');

      vi.advanceTimersByTime(2000);
      expect(acceptBtn.textContent).toBe('Accept');
    });
  });

  describe('hidePrivacyConsentModal - focus trap release', () => {
    it('should release focus trap when hiding modal', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      expect(mockFocusTrap).toHaveBeenCalled();

      const cb = getCheckbox()!;
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));

      mockSavePrivacyConsent.mockResolvedValue(undefined);
      mockRecordPolicyVersionAcknowledgment.mockResolvedValue(undefined);

      getAcceptBtn()!.click();

      await vi.waitFor(() => {
        expect(mockFocusRelease).toHaveBeenCalled();
      });
    });
  });

  describe('incrementConsentDeniedCount', () => {
    it('should increment from 0 to 1', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      storageData['privacy_consent_denied_count'] = 0;

      window.alert = vi.fn();

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      document.getElementById('declineConsentBtn')!.click();

      await vi.waitFor(() => {
        expect(mockChromeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({ privacy_consent_denied_count: 1 })
        );
      });
    });

    it('should increment from 2 to 3', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      storageData['privacy_consent_denied_count'] = 2;

      window.alert = vi.fn();

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      document.getElementById('declineConsentBtn')!.click();

      await vi.waitFor(() => {
        expect(mockChromeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({ privacy_consent_denied_count: 3 })
        );
      });
    });
  });

  describe('resetConsentDeniedCount', () => {
    it('should reset denial count and last denial time to 0', async () => {
      storageData['privacy_consent_denied_count'] = 5;
      storageData['privacy_consent_last_denial_time'] = 999;

      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false, needsReconsent: true });

      await initPrivacyConsent();

      expect(mockChromeStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          privacy_consent_denied_count: 0,
          privacy_consent_last_denial_time: 0,
        })
      );
    });
  });
});
