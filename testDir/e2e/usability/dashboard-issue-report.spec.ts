/**
 * dashboard-issue-report.spec.ts (PBI 2026-09-13-51)
 *
 * E2E for the "Report a Bug" button added in PBI 45: click → preview modal
 * (no tab opened yet) → verify the sanitized body → "Open GitHub" opens a
 * tab with the sanitized body, or Cancel closes without opening anything.
 */
import { test, expect, SEEDED_API_KEY } from '../fixtures/dashboard-issue-report.fixture.js';

test.describe('Dashboard bug report link @extension', () => {
  test('preview shows sanitized diagnostics and "Open GitHub" opens the issue tab', async ({ dashboardPage: page }) => {
    await page.locator('[data-panel="panel-diagnostics"]').click();
    await expect(page.locator('#panel-diagnostics')).toBeVisible();

    await page.locator('#diagReportBugBtn').click();

    const modal = page.locator('#bugReportPreviewModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });

    const previewText = await page.locator('#bugReportPreviewContent').inputValue();
    expect(previewText).not.toContain(SEEDED_API_KEY);
    expect(previewText).toContain('gemini');

    await page.locator('#bugReportOpenBtn').click();

    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    const createdUrls = await page.evaluate(() => (window as any).__createdTabUrls as string[]);
    expect(createdUrls.length).toBeGreaterThanOrEqual(1);
    const openedUrl = createdUrls[createdUrls.length - 1];
    expect(openedUrl).toContain('https://github.com/armaniacs/yasumaro/issues/new');
    expect(openedUrl).not.toContain(SEEDED_API_KEY);
  });

  test('Cancel closes the preview without opening a tab', async ({ dashboardPage: page }) => {
    await page.locator('[data-panel="panel-diagnostics"]').click();
    await page.locator('#diagReportBugBtn').click();

    const modal = page.locator('#bugReportPreviewModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });

    await page.locator('#bugReportCancelBtn').click();
    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    const createdUrls = await page.evaluate(() => (window as any).__createdTabUrls as string[]);
    expect(createdUrls.length).toBe(0);
  });
});
