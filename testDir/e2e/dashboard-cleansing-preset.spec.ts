import { testInteraction as test, expect } from './fixtures/dashboard.fixture.js';

/**
 * dashboard-cleansing-preset.spec.ts
 *
 * Regression pin: selecting a cleansing preset must stick. Two races used to
 * revert it to the stale value: (1) a fire-and-forget top-level re-read
 * inside applyAiSummaryCleansingSettingsToUI overwrote the just-applied
 * selection; (2) a slow mount-time migration wrote the stale detected value
 * after the user's write. Fixed by removing the redundant re-read, an apply
 * epoch that makes a late migration yield, and (since the PBI 2026-09-23-15
 * repository migration) a single locked delta write through the
 * SettingsRepository seam — the `settings` blob is the canonical location.
 * The legacy scattered top-level key is read-only fallback and is no longer
 * written.
 */
test.describe('Dashboard cleansing preset @extension', () => {
  test('selecting Balanced sticks in the UI and in the settings blob', async ({ dashboardPage: page }) => {
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
          page.evaluate(async () => {
            const blob = await chrome.storage.local.get('settings');
            return ((blob.settings as Record<string, unknown> | undefined)?.cleansing_preset as string | undefined) ?? null;
          }),
        { timeout: 10000 },
      )
      .toBe('balanced');
    await expect(select).toHaveValue('balanced');
  });
});
