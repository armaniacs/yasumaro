/**
 * dashboard-tag-cluster.spec.ts (PBI 2026-09-13-47)
 *
 * Usability angle on the tag cloud: not just "does at least one node render"
 * (tag-cluster.spec.ts already covers the 1000-row regression), but "does
 * the number of rendered nodes match the number of unique tags in the data"
 * — a user comparing the cloud to their own tag list needs that to hold.
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
});
