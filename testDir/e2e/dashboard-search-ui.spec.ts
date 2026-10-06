/**
 * UI search E2E (PBI 2026-09-12-44).
 *
 * Debounce specialization only: drives the dashboard search input itself and
 * verifies the debounce → filtered card rendering pipeline. Result counts,
 * the clear-to-restore flow, and the empty state live in the canonical
 * usability/dashboard-search-results.spec.ts; keyboard-only search driving
 * lives in usability/a11y-usability.spec.ts.
 *
 * Regression being guarded: normalizeStorageQuery dropping `text` and the
 * OPFS routing miss both produced "same rows for every query" — invisible
 * to client-API tests only checking success:true.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';

const BASE_MS = Date.UTC(2026, 8, 1); // 2026-09-01

function makeRows(): Array<Record<string, unknown>> {
  return [
    { url: 'https://example.com/tsukuba', title: '筑波大学の入試について', summary: '筑波大学の入試情報', tags: null, created_at: BASE_MS, domain: 'example.com' },
    { url: 'https://example.com/printer', title: 'プリンターレンタル比較', summary: 'プリンターの選び方', tags: null, created_at: BASE_MS + 1000, domain: 'example.com' },
    { url: 'https://example.com/recipe', title: 'カレーのレシピ', summary: 'カレーの作り方', tags: null, created_at: BASE_MS + 2000, domain: 'example.com' },
  ];
}

test.use({ panelSeedParams: { rows: makeRows(), clearBeforeSeed: true } });

test.describe('dashboard search UI @extension', () => {
  test('searching for a topic filters the visible cards', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;
    // Type into the search box — the fixture already seeded the rows and
    // opened the history panel.
    await expect(page.locator('#sqlite-search-input')).toBeVisible({ timeout: 10000 });
    await page.locator('#sqlite-search-input').fill('筑波大学');

    // Debounce completes → only the matching card is shown.
    await expect(page.locator('#sqlite-entry-list')).toContainText('筑波大学', { timeout: 15000 });
    await expect(page.locator('#sqlite-entry-list')).not.toContainText('プリンターレンタル');
  });
});
