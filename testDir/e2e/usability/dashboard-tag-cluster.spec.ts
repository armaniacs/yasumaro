/**
 * dashboard-tag-cluster.spec.ts (PBI 2026-09-13-47)
 *
 * Canonical home for tag-cloud assertions: rendered node count matching the
 * unique tags, per-tag label matching, and the untagged empty state. Only
 * the 1500-row cap regression lives in tag-cluster.spec.ts and is not
 * repeated here.
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';
import { createDashboardSqliteClient, migrationSettled, seedRows } from '../fixtures/dashboardSqliteHelpers.js';

const UNIQUE_TAGS = ['#alpha', '#bravo', '#charlie', '#delta', '#echo'];

function makeRows(baseMs: number): Array<Record<string, unknown>> {
  return UNIQUE_TAGS.map((tag, i) => ({
    url: `https://example.com/tag-cluster-${i}`,
    title: `Tag cluster row ${i}`,
    tags: tag,
    created_at: baseMs + i * 1000,
    domain: 'example.com',
  }));
}

function makeUntaggedRows(total: number, baseMs: number): Array<Record<string, unknown>> {
  return Array.from({ length: total }, (_, i) => ({
    url: `https://example.com/untagged-${i}`,
    title: `Untagged row ${i}`,
    tags: null,
    created_at: baseMs + i * 1000,
    domain: 'example.com',
  }));
}

test.describe('Dashboard tag cluster node count @extension', () => {
  test('the number of rendered SVG nodes matches the number of unique tags', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, makeRows(Date.UTC(2026, 0, 1)));

    await page.locator('button[data-panel="panel-tag-cluster"]').click();
    const svg = page.locator('#tagClusterSvg');
    await expect(svg).toBeVisible();

    // The panel defaults to the last-7-days view (user decision
    // 2026-09-24): switch to 全期間 so the January-seeded rows render.
    await page.locator('#tagClusterFilter button[data-preset="all"]').click();
    await expect(page.locator('.tag-cluster-loading-overlay')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('#tagClusterEmptyState')).toBeHidden();

    const circles = svg.locator('circle.tag-cluster-node');
    await expect(circles.first()).toBeVisible({ timeout: 5000 });
    await expect(circles).toHaveCount(UNIQUE_TAGS.length);

    // Every seeded tag must have a corresponding label in the cloud —
    // matching node count alone wouldn't catch "N nodes, wrong tags".
    const texts = svg.locator('text.tag-cluster-text');
    for (const tag of UNIQUE_TAGS) {
      await expect(texts.filter({ hasText: tag }).first()).toBeVisible();
    }
  });

  test('shows empty state when only untagged history exists', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    const baseMs = Date.UTC(2025, 0, 2);
    // Only 1000 untagged rows — cloud must be empty regardless of cap.
    await seedRows(client, makeUntaggedRows(1000, baseMs));

    await page.locator('button[data-panel="panel-tag-cluster"]').click();
    await expect(page.locator('#tagClusterSvg')).toBeVisible();
    await expect(page.locator('.tag-cluster-loading-overlay')).toBeHidden({ timeout: 15000 });
    await expect(page.locator('#tagClusterEmptyState')).toBeVisible();
    await expect(page.locator('#tagClusterSvg circle.tag-cluster-node')).toHaveCount(0);
  });
});
