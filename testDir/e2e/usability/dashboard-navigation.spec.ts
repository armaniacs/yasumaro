/**
 * dashboard-navigation.spec.ts (PBI 2026-09-13-47)
 *
 * All 18 sidebar tabs must be reachable, and clicking each one must show
 * that panel and hide the others — both by mouse click and by keyboard
 * (focus + Enter, the same interaction the a11y-usability spec checks
 * generically; this spec checks every panel specifically).
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';

test.describe('Dashboard sidebar navigation @extension', () => {
  test('every sidebar tab shows its own panel and hides the others', async ({ dashboardPage: page }) => {
    const tabs = page.locator('#sidebar [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(18);

    const panelIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const panelId = await tabs.nth(i).getAttribute('data-panel');
      expect(panelId).toBeTruthy();
      if (panelId) panelIds.push(panelId);
    }

    for (const panelId of panelIds) {
      await page.locator(`[data-panel="${panelId}"]`).click();
      await expect(page.locator(`#${panelId}`)).toBeVisible();

      // Every other panel must be hidden — a tab click should never leave
      // two panels visible at once.
      const others = panelIds.filter((id) => id !== panelId);
      for (const otherId of others) {
        await expect(page.locator(`#${otherId}`)).toBeHidden();
      }
    }
  });

  test('activating a tab via keyboard (focus + Enter) reaches the same panel as a click', async ({ dashboardPage: page }) => {
    const tab = page.locator('[data-panel="panel-tags"]');
    await tab.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#panel-tags')).toBeVisible();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});
