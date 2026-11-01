/**
 * saved-collections-panel.spec.ts
 *
 * PBI 2026-11-01-01 — the standalone saved-collections panel (@extension).
 * A collection saved in the history region is listed in the new sibling
 * panel (shared repositories, no shared state); recall restores the stored
 * conditions into the panel draft. `?tab=collections` deep-links to it.
 *
 * NOTE: not executed in this environment (no Playwright browser installed);
 * unit + integration specs cover the same BDD scenarios.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';

test.use({ locale: 'en-US' });

function buildSeedRows() {
  const base = Date.UTC(2026, 8, 1, 12, 0, 0);
  return [
    { url: 'https://saved-collections-panel-e2e.test/alpha', title: 'Alpha save-target one', summary: 'seed', created_at: base, domain: 'saved-collections-panel-e2e.test' },
    { url: 'https://saved-collections-panel-e2e.test/beta', title: 'Beta other two', summary: 'seed', created_at: base + 60000, domain: 'saved-collections-panel-e2e.test' },
  ];
}

test.use({ panelSeedParams: { rows: buildSeedRows() } });

test.describe('Saved collections panel @extension', () => {
  test('collection saved in history appears in the new panel; recall restores the draft', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;

    await page.locator('#sqlite-search-input').fill('Alpha');
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(1);
    await page.locator('#panel-sqlite-history .saved-collection-name-input').fill('Alpha set');
    await page.locator('#panel-sqlite-history [data-collection-action="save"]').click();
    await expect(page.locator('#panel-sqlite-history .saved-collection-row')).toContainText('Alpha set', { timeout: 15000 });

    await page.locator('[data-panel="panel-saved-collections"]').click();
    await expect(page.locator('#panel-saved-collections')).toBeVisible();
    await expect(page.locator('#panel-saved-collections .saved-collection-row')).toContainText('Alpha set', { timeout: 15000 });

    await page.locator('#panel-saved-collections [data-collection-action="apply"]').click();
    await expect(page.locator('#panel-saved-collections .saved-collections-draft')).toContainText('Alpha');
  });

  test('?tab=collections deep-links to the new panel', async ({ seededHistoryPanel, extensionId }) => {
    const { page } = seededHistoryPanel;
    await page.goto(`chrome-extension://${extensionId}/options.html?tab=collections`, { waitUntil: 'networkidle' });
    await expect(page.locator('#panel-saved-collections')).toBeVisible();
  });

  test('rule added in the new panel lists immediately', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;
    await page.locator('[data-panel="panel-saved-collections"]').click();
    await expect(page.locator('#panel-saved-collections')).toBeVisible();

    await page.locator('#panel-saved-collections .auto-tag-rule-name').fill('E2E panel rule');
    await page.locator('#panel-saved-collections .auto-tag-rule-domain').fill('saved-collections-panel-e2e.test');
    await page.locator('#panel-saved-collections .auto-tag-rule-tag').fill('panel-e2e');
    await page.locator('#panel-saved-collections [data-rule-action="add"]').click();
    await expect(page.locator('#panel-saved-collections .auto-tag-rule-row')).toContainText('E2E panel rule', { timeout: 15000 });
  });
});
