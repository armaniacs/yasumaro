/**
 * popup-record-flow.spec.ts (PBI 2026-09-13-49)
 *
 * Usability E2E for the record → preview → confirm task, and the cancel
 * path that must return the popup to its idle state without saving.
 * Reuses the cleansing-preview fixture (record/preview/save round trip).
 */
import { test, MASKED_CONTENT } from '../fixtures/cleansing-preview.fixture.js';
import { expect } from '@playwright/test';

if (!process.env.CI && !process.env.DISPLAY) {
  test.skip(true, 'requires headed Chrome with display');
}

test.describe('Popup record task completion @extension', () => {
  test('user completes record → preview → confirm as one task', async ({ previewPage: page }) => {
    await page.locator('#recordBtn').click();

    const modal = page.locator('#confirmationModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });

    await expect(page.locator('#previewContent')).toHaveValue(MASKED_CONTENT);

    await page.locator('#confirmPreviewBtn').click();
    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    const payloads = await page.evaluate(() => (window as any).__saveRecordPayloads as unknown[]);
    expect(payloads.length).toBeGreaterThanOrEqual(1);
  });

  test('user cancels the preview and the popup returns to idle without saving', async ({ previewPage: page }) => {
    await page.locator('#recordBtn').click();
    const modal = page.locator('#confirmationModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });

    await page.locator('#cancelPreviewBtn').click();
    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    const payloads = await page.evaluate(() => (window as any).__saveRecordPayloads as unknown[]);
    expect(payloads.length).toBe(0);

    // The record button is usable again — idle state, not stuck disabled.
    await expect(page.locator('#recordBtn')).toBeEnabled();
  });
});
