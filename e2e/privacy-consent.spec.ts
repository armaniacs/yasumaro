import { test, expect } from './fixtures/popup.fixture.js';

/**
 * E2E Tests for Privacy Consent Modal
 *
 * Verifies the static structure and accessibility attributes of the privacy consent modal.
 * Interaction tests (checkbox toggle, accept/decline flow) require Chrome extension context.
 */

test.describe('Privacy Consent Modal - Structure @ui @a11y', () => {
  test('modal exists with correct ID and role', async ({ popupPage: page }) => {
    const modal = page.locator('#privacyConsentModal');

    await test.step('Verify modal is in DOM', async () => {
      await expect(modal).toBeAttached();
      await expect(modal).toHaveId('privacyConsentModal');
    });

    await test.step('Verify modal has overlay class', async () => {
      await expect(modal).toHaveClass(/modal-overlay/);
    });
  });

  test('modal has correct ARIA attributes for dialog', async ({ popupPage: page }) => {
    const modal = page.locator('#privacyConsentModal');

    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal).toHaveAttribute('aria-labelledby', 'privacyConsentTitle');
  });

  test('modal is hidden initially', async ({ popupPage: page }) => {
    const modal = page.locator('#privacyConsentModal');

    await expect(modal).toHaveClass(/hidden/);
    await expect(modal).toBeAttached();
  });
});

test.describe('Privacy Consent Modal - Content @ui', () => {
  test('modal has header with logo and title', async ({ popupPage: page }) => {
    const modal = page.locator('#privacyConsentModal');

    await test.step('Verify logo image', async () => {
      await expect(modal.locator('.modal-logo')).toBeAttached();
    });

    await test.step('Verify title element', async () => {
      await expect(modal.locator('#privacyConsentTitle')).toBeAttached();
      await expect(modal.locator('#privacyConsentTitle')).toHaveAttribute('id', 'privacyConsentTitle');
    });
  });

  test('modal has content structure (header, body, footer)', async ({ popupPage: page }) => {
    const content = page.locator('.privacy-consent-content');

    await expect(content).toHaveClass(/modal-content/);
    await expect(content.locator('.modal-header')).toBeAttached();
    await expect(content.locator('.modal-body')).toBeAttached();
    await expect(content.locator('.modal-footer')).toBeAttached();
  });

  test('modal has privacy summary with key points list', async ({ popupPage: page }) => {
    const modal = page.locator('#privacyConsentModal');

    await test.step('Verify summary section', async () => {
      await expect(modal.locator('.privacy-consent-summary')).toBeAttached();
      await expect(modal.locator('.privacy-consent-summary h4')).toBeAttached();
      await expect(modal.locator('.privacy-consent-summary ul')).toBeAttached();
    });

    await test.step('Verify key points exist as list items', async () => {
      const keyPoints = modal.locator('.privacy-consent-summary ul li');
      await expect(keyPoints).not.toHaveCount(0);
    });
  });

  test('modal has privacy policy link', async ({ popupPage: page }) => {
    const linkBtn = page.locator('#viewPrivacyPolicyBtn');

    await expect(page.locator('.privacy-policy-link')).toBeAttached();
    await expect(linkBtn).toBeAttached();
    await expect(linkBtn).toHaveAttribute('href');
    await expect(linkBtn).toHaveAttribute('target', '_blank');
  });
});

test.describe('Privacy Consent Modal - Controls @ui', () => {
  test('modal has consent checkbox with label', async ({ popupPage: page }) => {
    const modal = page.locator('#privacyConsentModal');

    await test.step('Verify checkbox group structure', async () => {
      await expect(modal.locator('.consent-checkbox-group')).toBeAttached();
      await expect(modal.locator('.checkbox-label')).toBeAttached();
    });

    await test.step('Verify checkbox element', async () => {
      await expect(page.locator('#consentCheckbox')).toBeAttached();
    });

    await test.step('Verify checkbox label text exists', async () => {
      await expect(modal.locator('.checkbox-label span')).toBeAttached();
    });
  });

  test('accept button is disabled initially', async ({ popupPage: page }) => {
    const acceptBtn = page.locator('#acceptConsentBtn');

    await expect(acceptBtn).toBeAttached();
    await expect(acceptBtn).toHaveAttribute('disabled');
  });

  test('modal has decline and accept buttons in footer', async ({ popupPage: page }) => {
    const footer = page.locator('#privacyConsentModal .modal-footer');

    await expect(footer.locator('button')).toHaveCount(2);
    await expect(page.locator('#declineConsentBtn')).toBeAttached();
    await expect(page.locator('#acceptConsentBtn')).toBeAttached();
  });
});

test.describe('Privacy Consent Modal - Interaction @interaction', () => {
  test.fixme(true, 'Requires Chrome extension context for JS event handlers');

  test('checking checkbox should enable accept button', async ({ popupPage: page }) => {
    const checkbox = page.locator('#consentCheckbox');
    const acceptBtn = page.locator('#acceptConsentBtn');

    await checkbox.check();
    await expect(acceptBtn).toBeEnabled();
  });

  test('unchecking checkbox should disable accept button', async ({ popupPage: page }) => {
    const checkbox = page.locator('#consentCheckbox');

    await checkbox.check();
    await checkbox.uncheck();
    await expect(page.locator('#acceptConsentBtn')).toBeDisabled();
  });

  test('decline button should close modal', async ({ popupPage: page }) => {
    await page.locator('#declineConsentBtn').click();
    await expect(page.locator('#privacyConsentModal')).toHaveClass(/hidden/);
  });

  test('accept button should close modal after consent', async ({ popupPage: page }) => {
    await page.locator('#consentCheckbox').check();
    await page.locator('#acceptConsentBtn').click();
    await expect(page.locator('#privacyConsentModal')).toHaveClass(/hidden/);
  });
});
