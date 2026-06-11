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
const mockLogError = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());
const mockFocusTrap = vi.hoisted(() => vi.fn(() => 'trap-id-1'));
const mockFocusRelease = vi.hoisted(() => vi.fn());
const mockChromeTabsCreate = vi.hoisted(() => vi.fn());

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
}));

vi.mock('../../utils/logger.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.stubGlobal('chrome', {
  runtime: { getURL: vi.fn((path: string) => `chrome-extension://test/${path}`) },
  tabs: { create: mockChromeTabsCreate },
  storage: { local: { get: vi.fn(), set: vi.fn() } },
});

import {
  initPrivacyConsent,
  setupPrivacyConsentListeners,
  setConsentCallback,
} from '../privacyConsentController.js';

// ============================================================================
// Helpers
// ============================================================================

function setupDom(): void {
  document.body.innerHTML = `
    <div id="privacyConsentModal" class="hidden">
      <div id="privacyConsentTitle"></div>
      <a id="viewPrivacyPolicyBtn" href="#"></a>
      <input id="consentCheckbox" type="checkbox" />
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
    mockFocusTrap.mockClear();
    mockFocusRelease.mockClear();
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
      expect(modal?.classList.contains('hidden')).toBe(false);
      expect(modal?.style.display).toBe('flex');
      expect(modal?.classList.contains('show')).toBe(true);
    });

    it('should not show modal when user has already consented', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: true });

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.classList.contains('hidden')).toBe(true);
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

    it('should set up focus trap when modal is shown', async () => {
      mockGetPrivacyConsent.mockResolvedValue({ hasConsented: false });

      await initPrivacyConsent();

      const modal = getModal();
      expect(mockFocusTrap).toHaveBeenCalledWith(modal, expect.any(Function));
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

    it('should prevent modal close on outside click', () => {
      const modal = getModal();
      const stopPropagation = vi.fn();
      const event = new MouseEvent('click');
      vi.spyOn(event, 'stopPropagation').mockImplementation(stopPropagation);

      modal!.dispatchEvent(event);
      expect(stopPropagation).toHaveBeenCalled();
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

      await initPrivacyConsent();

      const cb = getCheckbox();
      cb!.checked = true;
      cb!.dispatchEvent(new Event('change'));

      const acceptBtn = getAcceptBtn();
      expect(acceptBtn?.disabled).toBe(false);

      acceptBtn!.click();
      await vi.waitFor(() => {
        expect(mockSavePrivacyConsent).toHaveBeenCalled();
      });

      const modal = getModal();
      expect(modal?.classList.contains('show')).toBe(false);
      expect(modal?.style.display).toBe('none');
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
      expect(modal?.classList.contains('hidden')).toBe(true);
      expect(modal?.style.display).toBe('none');
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
  });
});
