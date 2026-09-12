/**
 * UI search E2E (PBI 2026-09-12-44).
 *
 * Verifies the dashboard search input → debounce → filtered card rendering
 * pipeline end-to-end. The existing history-panel-ui.spec.ts covers
 * client.dashboardMsg() directly (bypassing the UI), so this is the first
 * test that drives the search box itself.
 *
 * Regression being guarded: normalizeStorageQuery dropping `text` and the
 * OPFS routing miss both produced "same rows for every query" — invisible
 * to client-API tests only checking success:true.
 */
import { test, expect } from './fixtures/extension.fixture.js';
import { createDashboardSqliteClient, migrationSettled, seedRows } from './fixtures/dashboardSqliteHelpers.js';

const BASE_MS = Date.UTC(2026, 8, 1); // 2026-09-01

function makeRows(): Array<Record<string, unknown>> {
  return [
    { url: 'https://example.com/tsukuba', title: '筑波大学の入試について', summary: '筑波大学の入試情報', tags: null, created_at: BASE_MS, domain: 'example.com' },
    { url: 'https://example.com/printer', title: 'プリンターレンタル比較', summary: 'プリンターの選び方', tags: null, created_at: BASE_MS + 1000, domain: 'example.com' },
    { url: 'https://example.com/recipe', title: 'カレーのレシピ', summary: 'カレーの作り方', tags: null, created_at: BASE_MS + 2000, domain: 'example.com' },
  ];
}

test.describe('dashboard search UI @extension', () => {
  test('searching for a topic filters the visible cards', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);

    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, makeRows());

    // Open the history panel and type into the search box.
    await page.locator('button[data-panel="panel-sqlite-history"]').click();
    await expect(page.locator('#sqlite-search-input')).toBeVisible({ timeout: 10000 });
    await page.locator('#sqlite-search-input').fill('筑波大学');

    // Debounce completes → only the matching card is shown.
    await expect(page.locator('#sqlite-entry-list')).toContainText('筑波大学', { timeout: 15000 });
    await expect(page.locator('#sqlite-entry-list')).not.toContainText('プリンターレンタル');
  });

  test('clearing the search box restores all rows', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);

    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, makeRows());

    await page.locator('button[data-panel="panel-sqlite-history"]').click();
    const searchInput = page.locator('#sqlite-search-input');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Search first to narrow.
    await searchInput.fill('筑波大学');
    await expect(page.locator('#sqlite-entry-list')).toContainText('筑波大学', { timeout: 15000 });

    // Clear → all rows come back.
    await searchInput.fill('');
    await expect(page.locator('#sqlite-entry-list .sqlite-entry')).toHaveCount(3, { timeout: 10000 });
  });
});


