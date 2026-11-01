/**
 * saved-collections-panel.spec.ts
 *
 * PBI 2026-11-01-01 — the standalone saved-collections panel (@extension).
 * A stored collection is listed in the new sibling panel (shared
 * repositories, no shared state); recall restores the stored conditions
 * into the panel draft (draft-only since PBI 2026-11-01-04: recall no longer
 * applies to the history list). `?tab=collections` deep-links to it.
 * Seeding goes through storage (beforeSeed): the history panel no longer
 * hosts a save UI.
 *
 * NOTE: not executed in this environment (no Playwright browser installed);
 * unit + integration specs cover the same BDD scenarios.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';
import { migrationSettled } from './fixtures/dashboardSqliteHelpers.js';

test.use({ locale: 'en-US' });

function buildSeedRows() {
  const base = Date.UTC(2026, 8, 1, 12, 0, 0);
  return [
    { url: 'https://saved-collections-panel-e2e.test/alpha', title: 'Alpha save-target one', summary: 'seed', created_at: base, domain: 'saved-collections-panel-e2e.test' },
    { url: 'https://saved-collections-panel-e2e.test/beta', title: 'Beta other two', summary: 'seed', created_at: base + 60000, domain: 'saved-collections-panel-e2e.test' },
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
              'col-e2e-saved-alpha': {
                id: 'col-e2e-saved-alpha',
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

test.describe('Saved collections panel @extension', () => {
  test('stored collection appears in the new panel; recall restores the draft', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;

    await page.locator('[data-panel="panel-saved-collections"]').click();
    await expect(page.locator('#panel-saved-collections')).toBeVisible();
    await expect(page.locator('#panel-saved-collections .saved-collection-row')).toContainText('Alpha set', { timeout: 15000 });

    await page.locator('#panel-saved-collections [data-collection-action="apply"]').click();
    await expect(page.locator('#panel-saved-collections .saved-collections-draft')).toContainText('Alpha');
  });

  test('rename and duplicate manage the list (moved from saved-collections.spec.ts, PBI 2026-11-01-04)', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;
    await page.locator('[data-panel="panel-saved-collections"]').click();
    await expect(page.locator('#panel-saved-collections')).toBeVisible();

    // Saving captures the panel draft: recall the seeded collection first so
    // the draft holds a condition (an empty draft fails closed).
    await page.locator('#panel-saved-collections [data-collection-action="apply"]').click();
    await expect(page.locator('#panel-saved-collections .saved-collections-draft')).toContainText('Alpha');
    await page.locator('#panel-saved-collections .saved-collection-name-input').fill('Rename me');
    await page.locator('#panel-saved-collections [data-collection-action="save"]').click();
    await expect(page.locator('#panel-saved-collections .saved-collection-row')).toContainText('Rename me', { timeout: 15000 });

    const renameRow = page.locator('#panel-saved-collections .saved-collection-row', { hasText: 'Rename me' });
    await renameRow.locator('[data-collection-action="rename"]').click();
    await renameRow.locator('.saved-collection-rename-input').fill('Renamed');
    await renameRow.locator('[data-collection-action="rename-save"]').click();
    await expect(page.locator('#panel-saved-collections .saved-collection-row')).toContainText('Renamed', { timeout: 15000 });

    const renamedRow = page.locator('#panel-saved-collections .saved-collection-row', { hasText: 'Renamed' });
    await renamedRow.locator('[data-collection-action="duplicate"]').click();
    await expect
      .poll(async () => page.locator('#panel-saved-collections .saved-collection-row').count(), { timeout: 15000 })
      .toBe(3);
  });

  test('?tab=collections deep-links to the new panel', async ({ seededHistoryPanel, extensionId }) => {
    const { page } = seededHistoryPanel;
    await page.goto(`chrome-extension://${extensionId}/options.html?tab=collections`, { waitUntil: 'networkidle' });
    await expect(page.locator('#panel-saved-collections')).toBeVisible();
  });

  test('rule added in the new panel lists immediately and survives reload (reload half moved from saved-collections.spec.ts, PBI 2026-11-01-04)', async ({ seededHistoryPanel }) => {
    const { page, client } = seededHistoryPanel;
    await page.locator('[data-panel="panel-saved-collections"]').click();
    await expect(page.locator('#panel-saved-collections')).toBeVisible();

    await page.locator('#panel-saved-collections .auto-tag-rule-name').fill('E2E panel rule');
    await page.locator('#panel-saved-collections .auto-tag-rule-domain').fill('saved-collections-panel-e2e.test');
    await page.locator('#panel-saved-collections .auto-tag-rule-tag').fill('panel-e2e');
    await page.locator('#panel-saved-collections [data-rule-action="add"]').click();
    await expect(page.locator('#panel-saved-collections .auto-tag-rule-row')).toContainText('E2E panel rule', { timeout: 15000 });

    await page.reload();
    await migrationSettled(page, client);
    await page.locator('[data-panel="panel-saved-collections"]').click();
    await expect(page.locator('#panel-saved-collections .auto-tag-rule-row')).toContainText('E2E panel rule', { timeout: 15000 });
  });
});
