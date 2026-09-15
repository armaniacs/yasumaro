import { testInteraction as test, expect } from './fixtures/dashboard.fixture.js';

/**
 * dashboard-cleansing-preset.spec.ts
 *
 * Regression pin: selecting a cleansing preset must stick. Two races used to
 * revert it to the stale value: (1) a fire-and-forget top-level re-read
 * inside applyAiSummaryCleansingSettingsToUI overwrote the just-applied
 * selection; (2) a slow mount-time migration wrote the stale detected value
 * after the user's write. Fixed by removing the redundant re-read, writing
 * through to the top-level key in applyPreset, and an apply epoch that makes
 * a late migration yield.
 */
test.describe('Dashboard cleansing preset @extension', () => {
  test('selecting Balanced sticks in the UI and in both storage locations', async ({ dashboardPage: page }) => {
    await page.locator('button[data-panel="panel-ai-summary-cleansing"]').click();
    const select = page.locator('#cleansing-preset');
    await expect(select).toBeVisible({ timeout: 10000 });
    // The select is disabled until its stored value is restored.
    await expect(select).toBeEnabled({ timeout: 10000 });

    await select.selectOption('balanced');
    // The UI reflects the pick immediately, but the storage writes are async
    // (port round-trips) — wait for the write to land, not just the DOM.
    await expect
      .poll(
        async () =>
          page.evaluate(
            async () => (await chrome.storage.local.get('cleansing_preset') as Record<string, unknown>).cleansing_preset,
          ),
        { timeout: 10000 },
      )
      .toBe('balanced');
    await expect(select).toHaveValue('balanced');

    const stored = await page.evaluate(async () => {
      const blob = await chrome.storage.local.get('settings');
      return ((blob.settings as Record<string, unknown> | undefined)?.cleansing_preset as string | undefined) ?? null;
    });
    expect(stored).toBe('balanced');
  });
});
