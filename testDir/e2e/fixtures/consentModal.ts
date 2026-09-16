/**
 * consentModal.ts
 * Shared consent-modal dismissal for the popup fixtures.
 *
 * The modal is opened by initPopup()'s async chain (shouldPromptForConsent →
 * signature verification → showModal), which is still in flight when
 * page.goto() resolves on the 'load' event. A bare isVisible() check therefore
 * races it: the check runs first, finds nothing, and the modal opens a moment
 * later on top of #recordBtn — leaving the button unfocusable and every
 * keyboard-driven spec failing on an element that looks perfectly enabled.
 *
 * Fixtures seed consent as a raw chrome.storage.local value, which does not
 * carry the signature getPrivacyConsent() requires, so the modal is expected
 * to appear in practice. It is still treated as optional: a fixture that does
 * satisfy the consent gate must not stall here for the full timeout.
 */
import type { Page } from '@playwright/test';

/** How long to wait for the modal to appear before concluding it won't. */
const CONSENT_MODAL_TIMEOUT_MS = 10000;

export async function dismissConsentModal(page: Page): Promise<void> {
  const consentModal = page.locator('#privacyConsentModal');

  try {
    await consentModal.waitFor({ state: 'visible', timeout: CONSENT_MODAL_TIMEOUT_MS });
  } catch {
    // No modal: consent was already satisfied for this fixture.
    return;
  }

  await page.locator('#consentCheckbox').check();
  await page.locator('#acceptConsentBtn').click();

  // acceptConsent() is awaited before the modal is hidden, so the dialog is
  // still open for a tick after the click. Returning here would hand the spec
  // a popup whose <dialog open> still makes the page behind it inert.
  await consentModal.waitFor({ state: 'hidden', timeout: CONSENT_MODAL_TIMEOUT_MS });
}
