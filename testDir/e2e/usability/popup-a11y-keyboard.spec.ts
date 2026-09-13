/**
 * popup-a11y-keyboard.spec.ts (PBI 2026-09-13-50)
 *
 * Keyboard-only completion of the "start recording" task. Lives apart from
 * a11y-usability.spec.ts because the record button is in the popup, which
 * needs the cleansing-preview fixture rather than the dashboard fixture.
 */
import { test } from '../fixtures/cleansing-preview.fixture.js';
import { expect } from '@playwright/test';

if (!process.env.CI && !process.env.DISPLAY) {
  test.skip(true, 'requires headed Chrome with display');
}

test.describe('Popup keyboard-only recording @extension', () => {
  test('user can start recording using only the keyboard', async ({ previewPage: page }) => {
    const recordBtn = page.locator('#recordBtn');
    await recordBtn.focus();
    await expect(recordBtn).toBeFocused();
    await page.keyboard.press('Enter');

    const modal = page.locator('#confirmationModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });
  });
});
