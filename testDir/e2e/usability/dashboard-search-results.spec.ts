/**
 * dashboard-search-results.spec.ts (PBI 2026-09-13-47)
 *
 * Usability angle on search: not just "does the debounce/filter pipeline
 * work" (dashboard-search-ui.spec.ts already covers that), but "does the
 * user get correct counts and a clear empty state" — the two things a user
 * actually looks at to decide whether search worked as expected.
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';
import { createDashboardSqliteClient, migrationSettled, seedRows } from '../fixtures/dashboardSqliteHelpers.js';

const BASE_MS = Date.UTC(2026, 8, 1);

function makeRows(): Array<Record<string, unknown>> {
  return [
    { url: 'https://example.com/a', title: '筑波大学の入試について', summary: '筑波大学の入試情報', tags: null, created_at: BASE_MS, domain: 'example.com' },
    { url: 'https://example.com/b', title: 'プリンターレンタル比較', summary: 'プリンターの選び方', tags: null, created_at: BASE_MS + 1000, domain: 'example.com' },
  ];
}

test.describe('Dashboard search result usability @extension', () => {
  test('a matching search shows the correct result count', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, makeRows());

    await page.locator('button[data-panel="panel-sqlite-history"]').click();
    await expect(page.locator('#sqlite-search-input')).toBeVisible({ timeout: 10000 });

    await page.locator('#sqlite-search-input').fill('筑波大学');
    await expect(page.locator('#sqlite-entry-list .sqlite-entry')).toHaveCount(1, { timeout: 15000 });
  });

  test('a search with no matches shows a clear empty state, not a blank panel', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, makeRows());

    await page.locator('button[data-panel="panel-sqlite-history"]').click();
    await expect(page.locator('#sqlite-search-input')).toBeVisible({ timeout: 10000 });

    await page.locator('#sqlite-search-input').fill('no-such-keyword-xyz-zzz');

    await expect(page.locator('#sqlite-entry-list .sqlite-entry')).toHaveCount(0, { timeout: 15000 });
    // A user seeing an empty panel with no message cannot tell "no results"
    // apart from "search is broken" — an explicit empty-state message is required.
    await expect(page.locator('#sqlite-entry-list .empty-state')).toBeVisible();
  });
});
