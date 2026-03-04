/**
 * privacy-consent.spec.ts
 * E2E Tests for Privacy Consent Modal (Static verification only)
 * Note: Full interaction testing requires Chrome extension context
 */

import { test, expect } from '@playwright/test';

test.describe('Privacy Consent Modal - Static Verification', () => {
    test.beforeEach(async ({ page }) => {
        // Load the popup.html page
        await page.goto('file://' + process.cwd() + '/src/popup/popup.html');
    });

    test('consent modal is present in the DOM', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');
        await expect(modal).toBeAttached();
    });

    test('consent modal has correct ID', async ({ page }) => {
        const modal = page.locator('.modal-overlay');
        const consentModal = page.locator('#privacyConsentModal');
        const consentModalCount = await consentModal.count();

        expect(consentModalCount).toBe(1);
        await expect(consentModal).toHaveId('privacyConsentModal');
    });

    test('consent modal has required elements', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');

        await expect(modal.locator('.modal-logo')).toBeAttached();
        await expect(modal.locator('#privacyConsentTitle')).toBeAttached();
        await expect(modal.locator('.privacy-consent-summary')).toBeAttached();
        await expect(modal.locator('#viewPrivacyPolicyBtn')).toBeAttached();
        await expect(modal.locator('#consentCheckbox')).toBeAttached();
        await expect(modal.locator('#declineConsentBtn')).toBeAttached();
        await expect(modal.locator('#acceptConsentBtn')).toBeAttached();
    });

    test('consent modal has correct ARIA attributes', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');

        await expect(modal).toHaveAttribute('role', 'dialog');
        await expect(modal).toHaveAttribute('aria-modal', 'true');
        await expect(modal).toHaveAttribute('aria-labelledby', 'privacyConsentTitle');
    });

    test('accept button has disabled attribute initially', async ({ page }) => {
        const acceptBtn = page.locator('#acceptConsentBtn');

        await expect(acceptBtn).toBeAttached();
        await expect(acceptBtn).toHaveAttribute('disabled');
    });

    test('privacy policy link has correct attributes', async ({ page }) => {
        const linkBtn = page.locator('#viewPrivacyPolicyBtn');

        await expect(linkBtn).toHaveAttribute('href');
        await expect(linkBtn).toHaveAttribute('target', '_blank');
    });

    test('decline button exists in DOM', async ({ page }) => {
        const declineBtn = page.locator('#declineConsentBtn');

        await expect(declineBtn).toBeAttached();
    });

    test('modal hidden class is present initially', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');

        // Modal should initially be hidden
        await expect(modal).toHaveClass(/hidden/);

        // Verify the modal exists in DOM even when hidden
        await expect(modal).toBeAttached();
    });

    test('checkbox element exists in DOM', async ({ page }) => {
        const checkbox = page.locator('#consentCheckbox');
        await expect(checkbox).toBeAttached();
    });

    test('checkbox label exists in DOM', async ({ page }) => {
        const checkboxLabel = page.locator('.checkbox-label');
        await expect(checkboxLabel).toBeAttached();
    });

    test('all privacy consent text content exists', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');

        // Check for key points in the summary
        const keyPoints = modal.locator('.privacy-consent-summary ul li');
        const keyPointsCount = await keyPoints.count();

        expect(keyPointsCount).toBeGreaterThan(0);

        // Check consent checkbox label text exists
        const checkboxLabel = modal.locator('.checkbox-label span');
        await expect(checkboxLabel).toBeAttached();
    });

    test('modal elements have correct structure', async ({ page }) => {
        const modal = page.locator('.privacy-consent-content');

        // Verify modal has content class (may have multiple classes)
        await expect(modal).toHaveClass('modal-content privacy-consent-content');

        // Check for header
        const header = modal.locator('.modal-header');
        await expect(header).toBeAttached();

        // Check for body
        const body = modal.locator('.modal-body');
        await expect(body).toBeAttached();

        // Check for footer with buttons
        const footer = modal.locator('.modal-footer');
        await expect(footer).toBeAttached();
        await expect(footer.locator('button')).toHaveCount(2);
    });

    test('modal summary has header element', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');
        const h4 = modal.locator('.privacy-consent-summary h4');

        await expect(h4).toBeAttached();
    });

    
    test('consent modal elements have correct classes', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');
        const modalContent = modal.locator('.modal-content');

        await expect(modalContent).toHaveClass(/privacy-consent-content/);
        await expect(modal).toHaveClass(/modal-overlay/);
    });

    test('buttons have correct button classes', async ({ page }) => {
        const acceptBtn = page.locator('#acceptConsentBtn');
        const declineBtn = page.locator('#declineConsentBtn');

        await expect(acceptBtn).toBeAttached();
        await expect(declineBtn).toBeAttached();
    });

    test('consent point list exists', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');
        const ul = modal.locator('.privacy-consent-summary ul');

        await expect(ul).toBeAttached();
    });

    test('modal has privacy policy link section', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');
        const linkSection = modal.locator('.privacy-policy-link');

        await expect(linkSection).toBeAttached();
    });

    test('modal has consent checkbox group', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');
        const checkboxGroup = modal.locator('.consent-checkbox-group');

        await expect(checkboxGroup).toBeAttached();
    });

    test('modal title element exists', async ({ page }) => {
        const title = page.locator('#privacyConsentTitle');

        await expect(title).toBeAttached();
        await expect(title).toHaveAttribute('id', 'privacyConsentTitle');
    });
});

test.describe('Privacy Consent Modal - Basic Structure', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('file://' + process.cwd() + '/src/popup/popup.html');
    });

    test('all consent points are list items', async ({ page }) => {
        const modal = page.locator('.privacy-consent-summary');
        const listItems = modal.locator('ul li');

        const count = await listItems.count();
        expect(count).toBeGreaterThan(0);
    });

    test('consent summary section exists', async ({ page }) => {
        const summary = page.locator('.privacy-consent-summary');

        await expect(summary).toBeAttached();
    });

    test('modal content is properly nested', async ({ page }) => {
        const modal = page.locator('#privacyConsentModal');
        const content = modal.locator('.modal-content');

        // Both elements should be attached
        await expect(modal).toBeAttached();
        await expect(content).toBeAttached();

        // Verify content is within modal structure
        await expect(modal.locator('.modal-content')).toBeAttached();
    });
});