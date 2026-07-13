import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPTIONS_PATH = path.join(__dirname, '../../dist/chromium-mv3/options.html');

test.describe('Dashboard - Diagnostics Panel @ui', () => {
  test('has diagnostics panel section with all key elements', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    await expect(page.locator('#panel-diagnostics')).toBeAttached();
    await expect(page.locator('#diagStorageStats')).toBeAttached();
    await expect(page.locator('#diagSqliteStats')).toBeAttached();
    await expect(page.locator('#diagExtInfo')).toBeAttached();
    await expect(page.locator('#diagObsidianSettings')).toBeAttached();
    await expect(page.locator('#diagAiSettings')).toBeAttached();
    await expect(page.locator('#diagDeficiencyStats')).toBeAttached();

    await expect(page.locator('#diagTestObsidianBtn')).toBeAttached();
    await expect(page.locator('#diagTestAiBtn')).toBeAttached();
    await expect(page.locator('#diagTestSqliteBtn')).toBeAttached();
    await expect(page.locator('#diagDebugModeToggle')).toBeAttached();
    await expect(page.locator('#diagOpfsSpikeBtn')).toBeAttached();
    await expect(page.locator('#diagMigrateBtn')).toBeAttached();
    await expect(page.locator('#diagBackfillBtn')).toBeAttached();
    await expect(page.locator('#diagCleanupBtn')).toBeAttached();
    await expect(page.locator('#diagConnectionResult')).toBeAttached();
    await expect(page.locator('#diagSqliteResult')).toBeAttached();
    await expect(page.locator('#diagOpfsSpikeResult')).toBeAttached();
    await expect(page.locator('#diagMigrateResult')).toBeAttached();
    await expect(page.locator('#diagBackfillResult')).toBeAttached();
    await expect(page.locator('#diagCleanupResult')).toBeAttached();
    await expect(page.locator('#diagCompileOptionsSection')).toBeAttached();
    await expect(page.locator('#diagCompileOptionsStats')).toBeAttached();
    await expect(page.locator('#diagDivergenceWarning')).toBeAttached();
  });
});

test.describe('Dashboard - Export Logs Panel @ui', () => {
  test('has export logs panel section with all key elements', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    await expect(page.locator('#panel-export-logs')).toBeAttached();
    await expect(page.locator('#export-logs-container')).toBeAttached();
    await expect(page.locator('#export-json-btn')).toBeAttached();
    await expect(page.locator('#export-markdown-btn')).toBeAttached();
    await expect(page.locator('#export-csv-btn')).toBeAttached();
    await expect(page.locator('#export-db-btn')).toBeAttached();
    await expect(page.locator('#export-status')).toBeAttached();
    await expect(page.locator('#exportLocalMarkdownBtn')).toBeAttached();
  });
});

test.describe('Dashboard - Sidebar Navigation @ui', () => {
  test('has sidebar nav buttons for diagnostics and export logs', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    const diagnosticsBtn = page.locator('[data-panel="panel-diagnostics"]');
    await expect(diagnosticsBtn).toBeAttached();
    await expect(diagnosticsBtn).toHaveText(/Diagnostics/);

    const exportLogsBtn = page.locator('[data-panel="panel-export-logs"]');
    await expect(exportLogsBtn).toBeAttached();
    await expect(exportLogsBtn).toHaveText(/Export Logs/);
  });
});
