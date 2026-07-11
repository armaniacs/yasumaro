// @vitest-environment jsdom
/**
 * privacyConsentController.test.ts
 * Tests for the privacy policy consent modal UI controller
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mock Setup (vi.mock is hoisted above all imports)
// ============================================================================

const mockGetPrivacyConsent = vi.hoisted(() => vi.fn());
const mockSavePrivacyConsent = vi.hoisted(() => vi.fn());
const mockMigrateLegacyPrivacyConsent = vi.hoisted(() => vi.fn());
const mockRecordPolicyVersionAcknowledgment = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());
const mockChromeTabsCreate = vi.hoisted(() => vi.fn());
const mockChromeStorageSet = vi.hoisted(() => vi.fn());

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
  storage: { local: { get: vi.fn(), set: mockChromeStorageSet } },
});

import {
  initPrivacyConsent,
  setupPrivacyConsentListeners,
  setConsentCallback,
} from '../privacyConsentController.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * M21: privacyConsentModal is now a native <dialog>. jsdom doesn't
 * implement showModal()/close(), so polyfill them (close() also fires a
 * real 'close' event; 'cancel' is polyfilled too so the ESC-key-blocking
 * listener in privacyConsentController.ts has something to attach to).
 */
function polyfillDialogMethods(): void {
  const modal = document.getElementById('privacyConsentModal') as any;
  if (!modal) return;
  modal.showModal = function () { this.open = true; };
  modal.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

function setupDom(): void {
  document.body.innerHTML = `
    <dialog id="privacyConsentModal">
      <div id="privacyConsentTitle"></div>
      <a id="viewPrivacyPolicyBtn" href="#"></a>
      <input id="consentCheckbox" type="checkbox" />
      <input id="contentStorageConsentCheckbox" type="checkbox" />
      <button id="acceptConsentBtn" disabled>Accept</button>
      <button id="declineConsentBtn">Decline</button>
    </dialog>
  `;
  polyfillDialogMethods();
}

function getModal(): HTMLDialogElement | null {
  return document.getElementById('privacyConsentModal') as HTMLDialogElement | null;
}

function getCheckbox(): HTMLInputElement | null {
  return document.getElementById('consentCheckbox') as HTMLInputElement;
}

function getAcceptBtn(): HTMLButtonElement | null {
  return document.getElementById('acceptConsentBtn') as HTMLButtonElement;
}

function getDeclineBtn(): HTMLButtonElement | null {
  return document.getElementById('declineConsentBtn') as HTMLButtonElement;
}

function getTitle(): HTMLElement | null {
  return document.getElementById('privacyConsentTitle');
}

function getPolicyLink(): HTMLAnchorElement | null {
  return document.getElementById('viewPrivacyPolicyBtn') as HTMLAnchorElement;
}

// ============================================================================
// Tests
// ============================================================================

describe('privacyConsentController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
    mockGetPrivacyConsent.mockReset();
    mockSavePrivacyConsent.mockReset();
    mockMigrateLegacyPrivacyConsent.mockReset();
    mockLogError.mockReset();
    mockGetMessage.mockReset();
    mockChromeTabsCreate.mockReset();

    mockGetMessage.mockImplementation((key: string) => {
      const messages: Record<string, string> = {
        viewFullPolicy: 'View Full Privacy Policy',
        privacyConsentTitle: 'Privacy Policy Consent',
        saveFailed: 'Failed to save consent',
        consentRequired: 'Privacy consent is required to use this extension.',
      };
      return messages[key] || key;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initPrivacyConsent', () => {
    it('should call migrateLegacyPrivacyConsent on init', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true });

      await initPrivacyConsent();

      expect(mockMigrateLegacyPrivacyConsent).toHaveBeenCalledTimes(1);
    });

    it('should show consent modal when user has not consented', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.open).toBe(true);
    });

    it('should not show modal when user has already consented', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true });

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.open).toBe(false);
    });

    it('should initialize modal state when shown', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      await initPrivacyConsent();

      const cb = getCheckbox();
      expect(cb?.checked).toBe(false);

      const acceptBtn = getAcceptBtn();
      expect(acceptBtn?.disabled).toBe(true);

      const policyLink = getPolicyLink();
      expect(policyLink?.href).toContain('permissions.html');
      expect(policyLink?.getAttribute('aria-label')).toBe('View Full Privacy Policy');

      const title = getTitle();
      expect(title?.textContent).toBe('Privacy Policy Consent');
    });

    it('calls showModal() when modal is shown (M21: native dialog handles focus trapping)', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      const modal = getModal()!;
      const showModalSpy = vi.spyOn(modal, 'showModal');

      await initPrivacyConsent();

      expect(showModalSpy).toHaveBeenCalled();
    });

    it('should handle errors during initialization', async () => {
      mockMigrateLegacyPrivacyConsent.mockRejectedValue(new Error('Migration error'));

      await initPrivacyConsent();

      expect(mockLogError).toHaveBeenCalledWith(
        '[PrivacyConsent] Error in initialization',
        expect.objectContaining({ cause: expect.any(Error) }),
        'INTERNAL_ERROR'
      );
    });
  });

  describe('setupPrivacyConsentListeners', () => {
    beforeEach(() => {
      setupPrivacyConsentListeners();
    });

    it('should enable accept button when checkbox is checked', () => {
      const cb = getCheckbox();
      const acceptBtn = getAcceptBtn();

      expect(acceptBtn?.disabled).toBe(true);

      cb!.checked = true;
      cb!.dispatchEvent(new Event('change'));

      expect(acceptBtn?.disabled).toBe(false);
    });

    it('should disable accept button when checkbox is unchecked', () => {
      const cb = getCheckbox();
      const acceptBtn = getAcceptBtn();

      // First enable
      cb!.checked = true;
      cb!.dispatchEvent(new Event('change'));
      expect(acceptBtn?.disabled).toBe(false);

      // Then disable
      cb!.checked = false;
      cb!.dispatchEvent(new Event('change'));
      expect(acceptBtn?.disabled).toBe(true);
    });

    it('prevents ESC-key close via the dialog cancel event (M21)', () => {
      const modal = getModal()!;
      const event = new Event('cancel', { cancelable: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      modal.dispatchEvent(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('should open privacy policy in new tab', () => {
      const policyLink = getPolicyLink();
      const event = new MouseEvent('click');
      vi.spyOn(event, 'preventDefault').mockImplementation(() => {});

      policyLink!.dispatchEvent(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockChromeTabsCreate).toHaveBeenCalledWith({
        url: policyLink!.href,
      });
    });
  });

  describe('consent flow with listeners', () => {
    beforeEach(() => {
      setupPrivacyConsentListeners();
    });

    it('should save consent and hide modal when accept is clicked', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      mockSavePrivacyConsent.mockResolvedValue(undefined);
      mockRecordPolicyVersionAcknowledgment.mockResolvedValue(undefined);

      await initPrivacyConsent();

      const cb = getCheckbox();
      cb!.checked = true;
      cb!.dispatchEvent(new Event('change'));

      const acceptBtn = getAcceptBtn();
      expect(acceptBtn?.disabled).toBe(false);

      acceptBtn!.click();
      await vi.waitFor(() => {
        expect(mockSavePrivacyConsent).toHaveBeenCalled();
        expect(mockRecordPolicyVersionAcknowledgment).toHaveBeenCalled();
      });

      const modal = getModal();
      expect(modal?.open).toBe(false);
    });

    it('should call consent callback on accept', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      mockSavePrivacyConsent.mockResolvedValue(undefined);

      const callback = vi.fn();
      setConsentCallback(callback);

      await initPrivacyConsent();

      const cb = getCheckbox();
      cb!.checked = true;
      cb!.dispatchEvent(new Event('change'));
      getAcceptBtn()!.click();

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledWith(true);
      });
    });

    it('should decline and close modal permanently when decline is clicked', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      window.alert = vi.fn();

      await initPrivacyConsent();

      const declineBtn = getDeclineBtn();
      declineBtn!.click();
      await vi.waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith(
          'consentDeclinedMessage'
        );
      });

      const modal = getModal();
      expect(modal?.open).toBe(false);
    });

    it('should call consent callback on decline', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      window.alert = vi.fn();
      const callback = vi.fn();
      setConsentCallback(callback);

      await initPrivacyConsent();

      getDeclineBtn()!.click();

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledWith(false);
      });
    });

    it('should show error text when save fails during accept', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      mockSavePrivacyConsent.mockRejectedValue(new Error('Save failed'));

      await initPrivacyConsent();

      const cb = getCheckbox();
      cb!.checked = true;
      cb!.dispatchEvent(new Event('change'));

      getAcceptBtn()!.click();

      await vi.waitFor(() => {
        expect(mockLogError).toHaveBeenCalledWith(
        '[PrivacyConsent] Failed to save consent',
        expect.anything(),
        'INTERNAL_ERROR'
      );
      });
    });

    it('should persist content storage consent when checkbox is checked on accept', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      mockSavePrivacyConsent.mockResolvedValue(undefined);

      await initPrivacyConsent();

      // Enable the main consent checkbox so the accept button is enabled
      const mainCb = document.getElementById('consentCheckbox') as HTMLInputElement;
      mainCb!.checked = true;
      mainCb!.dispatchEvent(new Event('change'));

      const cb = document.getElementById('contentStorageConsentCheckbox') as HTMLInputElement;
      cb!.checked = true;
      getAcceptBtn()!.click();

      await vi.waitFor(() => {
        expect(mockChromeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({ content_storage_enabled: true })
        );
      });
    });

    it('should persist content storage disabled when checkbox is unchecked on accept', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });
      mockSavePrivacyConsent.mockResolvedValue(undefined);

      await initPrivacyConsent();

      const mainCb = document.getElementById('consentCheckbox') as HTMLInputElement;
      mainCb!.checked = true;
      mainCb!.dispatchEvent(new Event('change'));

      const cb = document.getElementById('contentStorageConsentCheckbox') as HTMLInputElement;
      cb!.checked = false;
      getAcceptBtn()!.click();

      await vi.waitFor(() => {
        expect(mockChromeStorageSet).toHaveBeenCalledWith(
          expect.objectContaining({ content_storage_enabled: false })
        );
      });
    });
  });
});
