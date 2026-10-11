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

    // PBI 2026-10-11-16: status text is i18n-resolved, so assert the success
    // state (class), not the English string — /completed/i can never match a
    // Japanese UI. The class is written whole by showStatus and the success
    // state shows for 3s, so polling catches it in any locale.
    await expect(page.locator('#export-status')).toHaveClass(/success/, { timeout: 10000 });
  });
});
