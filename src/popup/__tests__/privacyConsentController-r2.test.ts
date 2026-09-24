// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// PBI 2026-09-15-08: the controller delegates state transitions to the deep
// module (src/utils/storage/privacyConsent.ts). These tests pin the WIRING —
// shouldPromptForConsent gates the modal, accept/decline reach the module,
// and the DOM/error branches behave as before. The denial-counter math and
// the 30-day rule are module tests (see privacyConsent-version.test.ts).

const mockShouldPromptForConsent = vi.hoisted(() => vi.fn());
const mockAcceptConsent = vi.hoisted(() => vi.fn());
const mockDeclineConsent = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());
const mockChromeTabsCreate = vi.hoisted(() => vi.fn());

vi.mock('../../utils/i18n.js', () => ({
  getMessage: mockGetMessage,
  getMessageOr: (key: string, fallback: string, subs?: unknown): string =>
      ((subs === undefined ? (mockGetMessage as (...a: any[]) => unknown)(key) : (mockGetMessage as (...a: any[]) => unknown)(key, subs)) || fallback) as string,
  getMessageWithSubstitutions: (
        key: string,
        subs: Record<string, string | number>,
        fallback: string,
      ): string =>
      ((mockGetMessage as (...a: any[]) => unknown)(key, subs) ||
        fallback.replace(/\{(\w+)\}/g, (_m: string, n: string) =>
          subs[n] !== undefined ? String(subs[n]) : `{${n}}`)) as string,
}));

vi.mock('../../utils/storage/privacyConsent.js', () => ({
  shouldPromptForConsent: mockShouldPromptForConsent,
  acceptConsent: mockAcceptConsent,
  declineConsent: mockDeclineConsent,
}));

// PBI 2026-09-17-19: the decline notice goes through the accessible dialog
// seam, so the stub moved from window.alert to the module mock.
const mockShowAlertDialog = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../utils/ui/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  showAlertDialog: mockShowAlertDialog,
}));

vi.mock('../../utils/logger/types.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));
vi.mock('../../utils/logger/core.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));
vi.mock('../../utils/logger/api.js', () => ({
  logError: mockLogError,
  ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.stubGlobal('chrome', {
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    sendMessage: vi.fn(),
  },
  tabs: { create: mockChromeTabsCreate },
});

import {
  initPrivacyConsent,
  setupPrivacyConsentListeners,
} from '../privacyConsentController.js';

/**
 * M21: privacyConsentModal is now a native <dialog>. jsdom doesn't
 * implement showModal()/close(), so polyfill them.
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

describe('privacyConsentController - r2 missed branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
    mockShouldPromptForConsent.mockReset();
    mockAcceptConsent.mockReset();
    mockDeclineConsent.mockReset();
    mockLogError.mockReset();
    mockGetMessage.mockReset();
    mockChromeTabsCreate.mockReset();

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

  describe('initPrivacyConsent - prompt gate', () => {
    it('should show modal when shouldPromptForConsent is true (needsReconsent path)', async () => {
      mockShouldPromptForConsent.mockResolvedValue(true);

      await initPrivacyConsent();

      const modal = getModal();
      expect(modal?.open).toBe(true);
    });
  });

  describe('showPrivacyConsentModal - missing modal', () => {
    it('should log error when modal element is not found', async () => {
      document.body.innerHTML = '';
      mockShouldPromptForConsent.mockResolvedValue(true);

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
    it('should show alert when the module reports count < 3', async () => {
      mockShouldPromptForConsent.mockResolvedValue(true);
      mockDeclineConsent.mockResolvedValue(1);

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      const declineBtn = document.getElementById('declineConsentBtn') as HTMLButtonElement;
      declineBtn.click();

      await vi.waitFor(() => {
        expect(mockShowAlertDialog).toHaveBeenCalled();
      });
    });

    it('should NOT show alert when the module reports count reaching 3', async () => {
      mockShouldPromptForConsent.mockResolvedValue(true);
      mockDeclineConsent.mockResolvedValue(3);

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      const declineBtn = document.getElementById('declineConsentBtn') as HTMLButtonElement;
      declineBtn.click();

      await vi.waitFor(() => {
        expect(mockDeclineConsent).toHaveBeenCalledTimes(1);
      });
      expect(mockShowAlertDialog).not.toHaveBeenCalled();
    });
  });

  describe('handleAcceptConsent error branch', () => {
    it('should show error text on save button when save fails', async () => {
      mockShouldPromptForConsent.mockResolvedValue(true);
      mockAcceptConsent.mockRejectedValue(new Error('Save failed'));

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

  describe('hidePrivacyConsentModal (M21: native dialog)', () => {
    it('calls showModal()/close() instead of the old focus-trap flow', async () => {
      mockShouldPromptForConsent.mockResolvedValue(true);
      const modal = getModal()!;
      const showModalSpy = vi.spyOn(modal, 'showModal');
      const closeSpy = vi.spyOn(modal, 'close');

      setupPrivacyConsentListeners();
      await initPrivacyConsent();

      expect(showModalSpy).toHaveBeenCalled();

      const cb = getCheckbox()!;
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));

      mockAcceptConsent.mockResolvedValue(undefined);

      getAcceptBtn()!.click();

      await vi.waitFor(() => {
        expect(closeSpy).toHaveBeenCalled();
      });
    });
  });
});
