/**
 * saved-collections.spec.ts
 *
 * Behavioral e2e for saved collections + auto-tag rules (PBI 2026-10-23-06).
 * The save captures the panel conditions, recall re-applies them; rename and
 * duplicate manage the list; the rule form stores a match rule. Rule-tag
 * *application* at save time rides the recording pipeline and is pinned by
 * the step unit tests — driving a full record save here would couple this
 * spec to the AI/cloud path.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';
import { migrationSettled } from './fixtures/dashboardSqliteHelpers.js';

test.use({ locale: 'en-US' });

function buildSeedRows() {
  const base = Date.UTC(2026, 8, 1, 12, 0, 0);
  return [
    { url: 'https://saved-collections-e2e.test/alpha', title: 'Alpha save-target one', summary: 'seed', created_at: base, domain: 'saved-collections-e2e.test' },
    { url: 'https://saved-collections-e2e.test/beta', title: 'Beta other two', summary: 'seed', created_at: base + 60000, domain: 'saved-collections-e2e.test' },
    { url: 'https://saved-collections-e2e.test/gamma', title: 'Gamma other three', summary: 'seed', created_at: base + 120000, domain: 'saved-collections-e2e.test' },
  ];
}

test.use({ panelSeedParams: { rows: buildSeedRows() } });

test.describe('Saved collections @extension', () => {
  test('save captures the search, recall re-applies it', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;

    await page.locator('#sqlite-search-input').fill('Alpha');
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(1);

    await page.locator('.saved-collection-name-input').fill('Alpha set');
    await page.locator('[data-collection-action="save"]').click();
    await expect(page.locator('.saved-collection-row')).toContainText('Alpha set', { timeout: 15000 });

    await page.locator('#sqlite-search-input').fill('');
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(3);

    await page.locator('[data-collection-action="apply"]').click();
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(1);
    await expect(page.locator('#sqlite-entry-list')).toContainText('Alpha save-target one');
  });

  test('rename and duplicate manage the list', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;

    await page.locator('#sqlite-search-input').fill('Beta');
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(1);
    await page.locator('.saved-collection-name-input').fill('Rename me');
    await page.locator('[data-collection-action="save"]').click();
    await expect(page.locator('.saved-collection-row')).toContainText('Rename me', { timeout: 15000 });

    await page.locator('[data-collection-action="rename"]').click();
    await page.locator('.saved-collection-rename-input').fill('Renamed');
    await page.locator('[data-collection-action="rename-save"]').click();
    await expect(page.locator('.saved-collection-row')).toContainText('Renamed', { timeout: 15000 });

    await page.locator('[data-collection-action="duplicate"]').click();
    await expect
      .poll(async () => page.locator('.saved-collection-row').count(), { timeout: 15000 })
      .toBe(2);
  });

  test('rule form stores a match rule and it survives reload', async ({ seededHistoryPanel }) => {
    const { page, client } = seededHistoryPanel;

    await page.locator('.auto-tag-rule-name').fill('E2E rule');
    await page.locator('.auto-tag-rule-domain').fill('saved-collections-e2e.test');
    await page.locator('.auto-tag-rule-tag').fill('auto-e2e');
    await page.locator('[data-rule-action="add"]').click();
    await expect(page.locator('.auto-tag-rule-row')).toContainText('E2E rule', { timeout: 15000 });

    await page.reload();
    await migrationSettled(page, client);
    await page.locator('[data-panel="panel-sqlite-history"]').click();
    await expect(page.locator('.auto-tag-rule-row')).toContainText('E2E rule', { timeout: 15000 });
  });
});
