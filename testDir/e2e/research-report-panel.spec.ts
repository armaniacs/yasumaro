/**
 * research-report-panel.spec.ts
 *
 * PBI 2026-11-01-03 — the standalone research-report panel (@extension).
 * A collection saved in the history region is listed as a report target in
 * the new sibling panel (shared repositories, no shared state);
 * `?tab=research-report` deep-links to it.
 *
 * NOTE: not executed in this environment (no Playwright browser installed);
 * unit + integration specs cover the same BDD scenarios. The full
 * generate-to-Markdown pass needs real history data and stays a manual
 * owner check.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';

test.use({ locale: 'en-US' });

function buildSeedRows() {
  const base = Date.UTC(2026, 8, 1, 12, 0, 0);
  return [
    { url: 'https://research-report-panel-e2e.test/alpha', title: 'Alpha report-target one', summary: 'seed', created_at: base, domain: 'research-report-panel-e2e.test' },
    { url: 'https://research-report-panel-e2e.test/beta', title: 'Beta other two', summary: 'seed', created_at: base + 60000, domain: 'research-report-panel-e2e.test' },
  ];
}

test.use({ panelSeedParams: { rows: buildSeedRows() } });

test.describe('Research report panel @extension', () => {
  test('collection saved in history appears as a report target in the new panel', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;

    await page.locator('#sqlite-search-input').fill('Alpha');
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(1);
    await page.locator('#panel-sqlite-history .saved-collection-name-input').fill('Alpha set');
    await page.locator('#panel-sqlite-history [data-collection-action="save"]').click();
    await expect(page.locator('#panel-sqlite-history .saved-collection-row')).toContainText('Alpha set', { timeout: 15000 });

    await page.locator('[data-panel="panel-research-report"]').click();
    await expect(page.locator('#panel-research-report')).toBeVisible();
    await expect(page.locator('#panel-research-report .research-report-target')).toContainText('Alpha set', { timeout: 15000 });
  });

  test('?tab=research-report deep-links to the new panel', async ({ seededHistoryPanel, extensionId }) => {
    const { page } = seededHistoryPanel;
    await page.goto(`chrome-extension://${extensionId}/options.html?tab=research-report`, { waitUntil: 'networkidle' });
    await expect(page.locator('#panel-research-report')).toBeVisible();
  });
});
