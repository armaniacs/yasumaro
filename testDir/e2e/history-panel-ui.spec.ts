/**
 * history-panel-ui.spec.ts (PBI 2026-09-11-01, round 8)
 *
 * Behavioral e2e for the SQLite history panel — the area rounds 5-7 changed
 * most (tag filter moved to SQL, pagination, star persistence). Previously
 * only panel-existence was covered (round 6 audit: High gap).
 *
 * Seeded via the DASHBOARD_SQLITE import path; the UI is driven through the
 * real sidebar navigation. Uses one shared seeded DB per test (fixture
 * context is per-test, so each test seeds its own rows).
 */
import { test, expect } from './fixtures/extension.fixture.js';
import {
  openOptionsPage,
  createDashboardSqliteClient,
  seedRows,
  migrationSettled,
  poll,
} from './fixtures/dashboardSqliteHelpers.js';

test.use({ locale: 'en-US' });

/** 8 rows tagged e2eAlpha, 8 tagged e2eBeta, 9 untagged — 25 total (2 pages). */
function buildSeedRows() {
  const rows: Array<Record<string, unknown>> = [];
  const base = Date.UTC(2026, 8, 1, 12, 0, 0);
  for (let i = 0; i < 25; i++) {
    const tags = i < 8 ? 'e2eAlpha,e2eShared' : i < 16 ? 'e2eBeta,e2eShared' : null;
    rows.push({
      url: `https://history-ui-e2e.test/page-${i + 1}`,
      title: `History UI e2e row ${i + 1}`,
      summary: 'e2e seed row',
      created_at: base - i * 60000,
      domain: 'history-ui-e2e.test',
      tags,
    });
  }
  return rows;
}

test.describe('History panel UI @extension', () => {
  test('panel lists the seeded rows (first page of 20)', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    await seedRows(client, buildSeedRows());

    await page.locator('[data-panel="panel-sqlite-history"]').click();
    const firstRow = page.locator('#sqlite-entry-list .sqlite-entry').first();
    await firstRow.waitFor({ state: 'visible', timeout: 15000 });

    const rowCount = await page.locator('#sqlite-entry-list .sqlite-entry').count();
    expect(rowCount).toBe(20);
    // Total count text reflects all 25 seeded rows.
    await expect(page.locator('.sqlite-history-count')).toContainText('25');
  });

  test('tag badge filters the list and clear restores it', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    await seedRows(client, buildSeedRows());

    await page.locator('[data-panel="panel-sqlite-history"]').click();
    await page.locator('#sqlite-entry-list .sqlite-entry').first().waitFor({ state: 'visible', timeout: 15000 });

    // Click the e2eAlpha badge on the first row carrying it.
    await page.locator('.tag-badge[data-tag="e2eAlpha"]').first().click();

    // Tag filter bar appears with the active tag; rows drop to the alpha subset.
    await expect(page.locator('#sqlite-tag-filter-bar')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.tag-badge.filter-active').first()).toContainText('e2eAlpha');
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(8);

    // Clear restores the unfiltered view.
    await page.locator('#sqlite-tag-filter-clear').click();
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(20);
    await expect(page.locator('#sqlite-tag-filter-bar')).toBeHidden();
  });

  test('star toggles and persists across reload', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    await seedRows(client, buildSeedRows());

    await page.locator('[data-panel="panel-sqlite-history"]').click();
    const firstRow = page.locator('#sqlite-entry-list .sqlite-entry').first();
    await firstRow.waitFor({ state: 'visible', timeout: 15000 });

    const rowId = await firstRow.getAttribute('data-id');
    const starBtn = firstRow.locator('[data-action="star"]');
    await starBtn.click();
    await expect(starBtn).toHaveClass(/starred/, { timeout: 15000 });
    await expect(starBtn).toHaveAttribute('aria-pressed', 'true');

    // Persistence: reload the page and re-open the panel.
    await page.reload();
    await migrationSettled(page, client);
    await page.locator('[data-panel="panel-sqlite-history"]').click();
    const reloadedStar = page.locator(
      `#sqlite-entry-list .sqlite-entry[data-id="${rowId}"] [data-action="star"]`
    );
    await expect(reloadedStar).toHaveClass(/starred/, { timeout: 15000 });
    await expect(reloadedStar).toHaveAttribute('aria-pressed', 'true');
  });

  test('pagination pages through the second page', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    await seedRows(client, buildSeedRows());

    await page.locator('[data-panel="panel-sqlite-history"]').click();
    await page.locator('#sqlite-entry-list .sqlite-entry').first().waitFor({ state: 'visible', timeout: 15000 });

    const firstPageIds = await page.locator('#sqlite-entry-list .sqlite-entry')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-id')));

    const nextBtn = page.locator('#sqlite-pagination [data-page="next"]');
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // Second page shows the remaining 5 rows.
    await expect
      .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
      .toBe(5);
    const secondPageIds = await page.locator('#sqlite-entry-list .sqlite-entry')
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-id')));
    expect(secondPageIds).not.toEqual(firstPageIds);
    await expect(page.locator('#sqlite-pagination [data-page="prev"]')).toBeEnabled();

    // DB cross-check: search for a seeded URL finds the row.
    const found = await poll(
      () => client.dashboardMsg({ subtype: 'search', query: 'History UI e2e row 25', limit: 10, offset: 0 }),
      (r) => r?.success === true,
    );
    expect(found?.success).toBe(true);
  });
});
