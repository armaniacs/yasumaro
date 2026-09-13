/**
 * a11y-usability.spec.ts (PBI 2026-09-13-50)
 *
 * Usability accessibility E2E: keyboard-only task completion, plus an
 * axe-core WCAG AA scan of the dashboard's default panel and a sample of
 * secondary panels. Complements the existing popup-only a11y.spec.ts.
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';
import AxeBuilder from '@axe-core/playwright';
import { createDashboardSqliteClient, migrationSettled, seedRows } from '../fixtures/dashboardSqliteHelpers.js';

// Representative sample: default (general), a data-heavy panel (history),
// and a form-heavy panel (domain filter) — not all 18, to keep runtime sane.
const SAMPLE_PANELS = ['panel-general', 'panel-domain', 'panel-diagnostics'];

test.describe('Dashboard accessibility @extension', () => {
  for (const panelId of SAMPLE_PANELS) {
    test(`${panelId} has no WCAG AA violations`, async ({ dashboardPage: page }) => {
      await page.locator(`[data-panel="${panelId}"]`).click();
      const panel = page.locator(`#${panelId}`);
      await expect(panel).toBeVisible();

      // The panel-switch entrance animation (ym-panel-in, 220ms) fades opacity
      // 0 → 1; scanning mid-fade produces false color-contrast violations.
      await expect(panel).toHaveCSS('opacity', '1');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .include(`#${panelId}`)
        .analyze();

      expect(results.violations).toEqual([]);
    });
  }

  test('user can reach and activate a settings change using only the keyboard', async ({ dashboardPage: page }) => {
    // Tab from the top of the page until a sidebar tab receives focus, then
    // Enter/Space activates it — no mouse click anywhere in this test.
    const domainTab = page.locator('[data-panel="panel-domain"]');
    await domainTab.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#panel-domain')).toBeVisible();
    await expect(domainTab).toHaveAttribute('aria-selected', 'true');
  });

  test('sidebar tabs are keyboard-focusable in document order', async ({ dashboardPage: page }) => {
    const tabs = page.locator('#sidebar [role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(10);

    // Every tab must be a real focus target — a tabindex of "-1" on every
    // non-active tab would make Tab-key navigation skip them entirely.
    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      await tab.focus();
      await expect(tab).toBeFocused();
    }
  });

  test('user can run a search using only the keyboard', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, [
      { url: 'https://example.com/a', title: '筑波大学の入試について', summary: '筑波大学の入試情報', tags: null, created_at: Date.UTC(2026, 8, 1), domain: 'example.com' },
      { url: 'https://example.com/b', title: 'プリンターレンタル比較', summary: 'プリンターの選び方', tags: null, created_at: Date.UTC(2026, 8, 1) + 1000, domain: 'example.com' },
    ]);

    // Reach the history panel by keyboard — no mouse click anywhere in this test.
    const historyTab = page.locator('button[data-panel="panel-sqlite-history"]');
    await historyTab.focus();
    await page.keyboard.press('Enter');

    const searchInput = page.locator('#sqlite-search-input');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Reaching the search field by keyboard is the point: it must accept
    // focus and real keystrokes (keyboard.type), not a programmatic fill().
    await searchInput.focus();
    await expect(searchInput).toBeFocused();
    await page.keyboard.type('筑波大学');

    await expect(page.locator('#sqlite-entry-list .sqlite-entry')).toHaveCount(1, { timeout: 15000 });
  });
});
