/**
 * cleansing-preview-confirm.spec.ts (PBI 2026-09-11-02, round 8)
 *
 * Behavioral e2e for the cleansing preview round trip: modal open → mask
 * navigation → edit → confirm → SAVE_RECORD. Previously only unit-tested
 * (round 6 audit: High gap; round 7 reworked the settle seam directly
 * beneath this flow).
 *
 * NOTE (environment): this spec requires headed Chrome (MV3 service worker);
 * headless environments skip it via the fixture. It runs in CI with a
 * display server.
 */
import { test, MASKED_CONTENT } from './fixtures/cleansing-preview.fixture.js';
import { expect } from '@playwright/test';

test.describe('Cleansing preview @extension', () => {
  test('preview modal opens with masked content and counter at 0/2', async ({ previewPage: page }) => {
    // Trigger the record flow — the fixture stubs tabs.query + PREVIEW_RECORD.
    await page.locator('#recordBtn').click();

    const modal = page.locator('#confirmationModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });

    const content = await page.locator('#previewContent').inputValue();
    expect(content).toBe(MASKED_CONTENT);

    // Two masks → counter starts at 0/2.
    await expect(page.locator('#maskNavCounter')).toHaveText('0/2');
  });

  test('mask navigation moves the counter and selection', async ({ previewPage: page }) => {
    await page.locator('#recordBtn').click();
    const modal = page.locator('#confirmationModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });

    // Next: counter 0/2 → 1/2, selection moves onto a masked span.
    await page.locator('#maskNavNext').click();
    await expect(page.locator('#maskNavCounter')).toHaveText('1/2');
    const selAfterNext = await page.locator('#previewContent').evaluate(
      (el: HTMLTextAreaElement) => ({
        start: el.selectionStart,
        end: el.selectionEnd,
        selected: el.value.slice(el.selectionStart, el.selectionEnd),
      })
    );
    expect(selAfterNext.selected).toMatch(/^\[MASKED:\w+\]$/);

    // Prev: back to 0/2.
    await page.locator('#maskNavPrev').click();
    await expect(page.locator('#maskNavCounter')).toHaveText('0/2');
  });

  test('confirm closes the modal and captures SAVE_RECORD with edited content', async ({ previewPage: page }) => {
    await page.locator('#recordBtn').click();
    const modal = page.locator('#confirmationModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });

    // Edit the content in the textarea (user reviews before sending).
    const edited = MASKED_CONTENT + ' USER-EDIT-TOKEN';
    await page.locator('#previewContent').fill(edited);

    await page.locator('#confirmPreviewBtn').click();

    // Modal closes (settle seam → modal.close()).
    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    // The captured SAVE_RECORD payload carries the edited content.
    const payloads = await page.evaluate(() => (window as any).__saveRecordPayloads as unknown[]);
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const first = payloads[0] as Record<string, unknown>;
    expect(first.content).toBe(edited);
    expect(first.title).toBe('Preview e2e article');
    expect(first.url).toBe('https://preview-e2e.test/article');
  });
});
