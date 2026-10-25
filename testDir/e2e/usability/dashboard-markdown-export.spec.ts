/**
 * dashboard-markdown-export.spec.ts (PBI 2026-09-13-47)
 *
 * Confirms the "Export Markdown" button in the Export Logs panel actually
 * triggers a file download (not just a click handler that runs without
 * error) and that the downloaded file is Markdown containing the seeded data.
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';
import { createDashboardSqliteClient, migrationSettled, seedRows } from '../fixtures/dashboardSqliteHelpers.js';
import { LOG_EXPORT_VERSION } from '../../../src/dashboard/exportLogsService.js';
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

/**
 * PBI 2026-10-23-04 (portability-moat), BDD "公式exportで移行する":
 * the Export Logs panel's CSV and JSON buttons must also produce real
 * downloads whose bytes carry the seeded records in a documented shape
 * (CSV header, signed JSON envelope v2). JSONL has no exporter yet, so
 * there is deliberately no JSONL case here (see the PBI's open items).
 *
 * NOT run headed in this round (owner to run); mirrors the Markdown test
 * above element-for-element: seeded row, download event wait (a condition
 * wait on the download, not a fixed sleep), locale-independent asserts
 * (filename extension, content, status class — never UI strings).
 */
test.describe('Dashboard CSV/JSON export readability (PBI 2026-10-23-04) @extension', () => {
  test('clicking Export CSV downloads a .csv file with the documented header and the seeded entry', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, [
      { url: 'https://example.com/csv-export-target', title: 'CSV Export Target Page', tags: null, created_at: Date.UTC(2026, 0, 2), domain: 'example.com' },
    ]);

    await page.locator('[data-panel="panel-export-logs"]').click();
    await expect(page.locator('#export-csv-btn')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-csv-btn').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^yasumaro_export_.*\.csv$/);

    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    // Strip the UTF-8 BOM the exporter prepends for Excel compatibility.
    // Compared by code point (0xFEFF) so no invisible literal lives in source.
    const rawCsv = readFileSync(savedPath!, 'utf-8');
    const content = rawCsv.charCodeAt(0) === 0xFEFF ? rawCsv.slice(1) : rawCsv;
    expect(content.split('\n')[0]).toBe('url,title,summary,tags,created_at,domain,is_starred');
    expect(content).toContain('CSV Export Target Page');

    await expect(page.locator('#export-status')).toHaveClass(/success/, { timeout: 10000 });
  });

  test('clicking Export JSON downloads a signed v2 envelope containing the seeded entry', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, [
      { url: 'https://example.com/json-export-target', title: 'JSON Export Target Page', tags: null, created_at: Date.UTC(2026, 0, 3), domain: 'example.com' },
    ]);

    await page.locator('[data-panel="panel-export-logs"]').click();
    await expect(page.locator('#export-json-btn')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-json-btn').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^yasumaro_export_.*\.json$/);

    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();
    const parsed = JSON.parse(readFileSync(savedPath!, 'utf-8')) as {
      version: number; table: string; rows: Array<{ url: string }>; signature: string;
    };
    expect(parsed.version).toBe(LOG_EXPORT_VERSION);
    expect(parsed.table).toBe('browsing_logs');
    expect(typeof parsed.signature).toBe('string');
    expect(parsed.rows.some((row) => row.url === 'https://example.com/json-export-target')).toBe(true);

    await expect(page.locator('#export-status')).toHaveClass(/success/, { timeout: 10000 });
  });
});
