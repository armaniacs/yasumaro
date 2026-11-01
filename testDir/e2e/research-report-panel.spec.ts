/**
 * research-report-panel.spec.ts
 *
 * PBI 2026-11-01-03 — the standalone research-report panel (@extension).
 * A stored collection is listed as a report target in the new sibling panel
 * (shared repositories, no shared state); `?tab=research-report` deep-links
 * to it. Seeding goes through storage (beforeSeed): since PBI 2026-11-01-04
 * the history panel no longer hosts a save UI.
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

test.use({
  panelSeedParams: {
    rows: buildSeedRows(),
    beforeSeed: async (page) => {
      await page.evaluate(async () => {
        const res = await chrome.storage.local.get('settings');
        const current = (res.settings as Record<string, unknown>) ?? {};
        await chrome.storage.local.set({
          settings: {
            ...current,
            saved_collections: {
              'col-e2e-report-alpha': {
                id: 'col-e2e-report-alpha',
                name: 'Alpha set',
                query: { search: 'Alpha' },
                createdAt: 1,
                updatedAt: 2,
              },
            },
          },
        });
      });
    },
  },
});

test.describe('Research report panel @extension', () => {
  test('stored collection appears as a report target in the new panel', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;

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
