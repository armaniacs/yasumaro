/**
 * dashboard-markdown-export.spec.ts (PBI 2026-09-13-47)
 *
 * Confirms the "Export Markdown" button in the Export Logs panel actually
 * triggers a file download (not just a click handler that runs without
 * error) and that the downloaded file is Markdown containing the seeded data.
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';
import { createDashboardSqliteClient, migrationSettled, seedRows } from '../fixtures/dashboardSqliteHelpers.js';
import { readFileSync } from 'node:fs';

test.describe('Dashboard Markdown export @extension', () => {
  test('clicking Export Markdown downloads a .md file containing the seeded entry', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, [
      { url: 'https://example.com/md-export-target', title: 'Markdown Export Target Page', tags: null, created_at: Date.UTC(2026, 0, 1), domain: 'example.com' },
    ]);

    await page.locator('[data-panel="panel-export-logs"]').click();
    await expect(page.locator('#export-markdown-btn')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-markdown-btn').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.md$/);

    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    const content = readFileSync(savedPath!, 'utf-8');
    expect(content).toContain('Markdown Export Target Page');

    await expect(page.locator('#export-status')).toContainText(/completed/i, { timeout: 10000 });
  });
});
