/**
 * onboarding-banner.spec.ts
 *
 * First-launch onboarding banner (PBI 2026-10-22-02). A fresh profile shows
 * the three entry choices once; dismissing hides it across reloads; the
 * まず試す choice navigates to the history panel. Zero-config recording
 * itself rides the existing no-summary path (covered by unit pins); this spec
 * owns the banner slice.
 */
import { test, expect } from './fixtures/extension.fixture.js';
import { openOptionsPage } from './fixtures/dashboardSqliteHelpers.js';

test.use({ locale: 'en-US' });

test.describe('Onboarding banner @extension', () => {
  test('fresh profile shows three choices, dismiss persists across reload', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);

    const banner = page.locator('#onboardingBanner');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner.locator('[data-onboarding-action="try-first"]')).toBeVisible();
    await expect(banner.locator('[data-onboarding-action="obsidian"]')).toBeVisible();
    await expect(banner.locator('[data-onboarding-action="ai"]')).toBeVisible();

    await banner.locator('[data-onboarding-action="dismiss"]').click();
    await expect(banner).toBeHidden({ timeout: 15000 });

    await page.reload();
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
    await expect(page.locator('#onboardingBanner')).toBeHidden({ timeout: 15000 });
  });

  test('try-first navigates to the history panel', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);

    const banner = page.locator('#onboardingBanner');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await banner.locator('[data-onboarding-action="try-first"]').click();
    await expect(page.locator('[data-panel="panel-sqlite-history"]')).toBeVisible({ timeout: 15000 });
  });
});
