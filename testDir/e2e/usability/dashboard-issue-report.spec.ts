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
    // Settings children stay collapsed until Initial Setup is pressed.
    await page.locator('[data-panel="panel-general"]').click();
    await page.locator('[data-panel="panel-diagnostics"]').click();
    await expect(page.locator('#panel-diagnostics')).toBeVisible();

    await page.locator('#diagReportBugBtn').click();

    const modal = page.locator('#bugReportPreviewModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });
    // open=true alone cannot catch a CSS regression that leaves the dialog
    // invisible — the user-facing symptom is visibility, not the property.
    await expect(modal).toBeVisible();
    // "Open GitHub" stays disabled until the sanitized body is ready.
    await expect(page.locator('#bugReportOpenBtn')).toBeEnabled();

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
    // Settings children stay collapsed until Initial Setup is pressed.
    await page.locator('[data-panel="panel-general"]').click();
    await page.locator('[data-panel="panel-diagnostics"]').click();
    await page.locator('#diagReportBugBtn').click();

    const modal = page.locator('#bugReportPreviewModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });

    await page.locator('#bugReportCancelBtn').click();
    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    const createdUrls = await page.evaluate(() => (window as any).__createdTabUrls as string[]);
    expect(createdUrls.length).toBe(0);
  });

  test('sidebar button opens the same preview from any panel, without navigating to Diagnostics', async ({ dashboardPage: page }) => {
    // Stay on the default (General) panel — never click into Diagnostics.
    await expect(page.locator('#panel-diagnostics')).toBeHidden();

    await page.locator('#sidebarReportBugBtn').click();

    const modal = page.locator('#bugReportPreviewModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });
    await expect(modal).toBeVisible();
    await expect(page.locator('#bugReportOpenBtn')).toBeEnabled();

    const previewText = await page.locator('#bugReportPreviewContent').inputValue();
    expect(previewText).not.toContain(SEEDED_API_KEY);
    expect(previewText).toContain('gemini');

    await page.locator('#bugReportOpenBtn').click();
    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    const createdUrls = await page.evaluate(() => (window as any).__createdTabUrls as string[]);
    expect(createdUrls.length).toBeGreaterThanOrEqual(1);
    expect(createdUrls[createdUrls.length - 1]).toContain('https://github.com/armaniacs/yasumaro/issues/new');
  });

  test('the diagnostics panel button and the sidebar button both work in the same session', async ({ dashboardPage: page }) => {
    // Diagnostics panel button first (settings subgroup needs expanding).
    await page.locator('[data-panel="panel-general"]').click();
    await page.locator('[data-panel="panel-diagnostics"]').click();
    await page.locator('#diagReportBugBtn').click();
    const modal = page.locator('#bugReportPreviewModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });
    await page.locator('#bugReportOpenBtn').click();
    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    // Then the sidebar button, in the same page session.
    await page.locator('[data-panel="panel-general"]').click();
    await page.locator('#sidebarReportBugBtn').click();
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });
    await expect(page.locator('#bugReportOpenBtn')).toBeEnabled();
    await page.locator('#bugReportOpenBtn').click();
    await expect(modal).toHaveJSProperty('open', false, { timeout: 15000 });

    const createdUrls = await page.evaluate(() => (window as any).__createdTabUrls as string[]);
    expect(createdUrls.length).toBe(2);
  });

  test('a hung on-device availability check still opens the report with data', async ({ context, extensionId }) => {
    // The on-device LanguageModel.availability() has no timeout of its own;
    // in a browser where the model service is stuck (observed in Edge) it
    // never settles. The snapshot must degrade that probe to "unknown" and
    // still open the report, not time out the whole collection.
    const page = await context.newPage();
    await page.addInitScript(() => {
      const win = window as unknown as { LanguageModel?: { availability?: unknown } };
      if (win.LanguageModel && typeof win.LanguageModel.availability === 'function') {
        win.LanguageModel.availability = () => new Promise<never>(() => {});
      } else {
        win.LanguageModel = { availability: () => new Promise<never>(() => {}) };
      }
    });

    await page.goto(`chrome-extension://${extensionId}/options.html?tab=history`, { waitUntil: 'networkidle' });
    await expect(page.locator('#sidebarReportBugBtn')).toBeVisible();

    await page.locator('#sidebarReportBugBtn').click();

    const modal = page.locator('#bugReportPreviewModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });
    await expect(modal).toBeVisible();
    await expect(page.locator('#bugReportOpenBtn')).toBeEnabled({ timeout: 15000 });

    const previewText = await page.locator('#bugReportPreviewContent').inputValue();
    expect(previewText).toContain('## Diagnostic Information');
    expect(previewText).not.toContain('Collecting diagnostics');
    await page.close();
  });
});
