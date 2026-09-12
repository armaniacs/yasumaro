import { test, expect } from './fixtures/extension.fixture.js';
import { createDashboardSqliteClient, migrationSettled, seedRows } from './fixtures/dashboardSqliteHelpers.js';

/**
 * Regression for 6.8.12 hotfix: tagCluster plain cap 1000 → 10000.
 * The panel requests 10000 rows. With the old 1000-cap, the 1500-row seed
 * where hot tags live beyond the first 1000 produced an empty cloud.
 * With the 10000-cap the hot tags are visible and the SVG renders.
 */

function makeRows(total: number, tagOffset: number, baseMs: number): Array<Record<string, unknown>> {
  return Array.from({ length: total }, (_, i) => ({
    url: `https://example.com/page-${i}`,
    title: `Page ${i}`,
    tags: i < tagOffset ? null : i % 2 === 0 ? '#hot #other' : '#hot',
    created_at: baseMs + i * 1000,
    domain: 'example.com',
  }));
}

test.describe('tag cluster @extension', () => {
  test('renders SVG nodes when hot tags are beyond first 1000 (1500-row regression)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);

    // Clear and seed 1500 rows where first 1000 are untagged.
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    const baseMs = Date.UTC(2025, 0, 1);
    const rows = makeRows(1500, 1000, baseMs);
    await seedRows(client, rows.slice(0, 1000));
    await seedRows(client, rows.slice(1000));

    // Open tag cluster panel via sidebar button (the file:// navigation guard
    // does not apply here — the extension runtime is up).
    await page.locator('button[data-panel="panel-tag-cluster"]').click();
    const svg = page.locator('#tagClusterSvg');
    await expect(svg).toBeVisible();

    // Wait for the panel's load to finish (loading overlay removed).
    await expect(page.locator('.tag-cluster-loading-overlay')).toBeHidden({ timeout: 15000 });

    // Empty state must be hidden and SVG must contain the hot tag.
    await expect(page.locator('#tagClusterEmptyState')).toBeHidden();
    const circles = svg.locator('circle.tag-cluster-node');
    await expect(circles.first()).toBeVisible({ timeout: 5000 });
    await expect(circles).not.toHaveCount(0);
    const texts = svg.locator('text.tag-cluster-text');
    await expect(texts.filter({ hasText: '#hot' }).first()).toBeVisible();
  });

  test('shows empty state when only untagged history exists (old-bug simulation)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);

    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    const baseMs = Date.UTC(2025, 0, 2);
    // Only 1000 untagged rows — cloud must be empty regardless of cap.
    await seedRows(client, makeRows(1000, 1000, baseMs));

    await page.locator('button[data-panel="panel-tag-cluster"]').click();
    await expect(page.locator('#tagClusterSvg')).toBeVisible();
    await expect(page.locator('.tag-cluster-loading-overlay')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('#tagClusterEmptyState')).toBeVisible();
    await expect(page.locator('#tagClusterSvg circle.tag-cluster-node')).toHaveCount(0);
  });
});
