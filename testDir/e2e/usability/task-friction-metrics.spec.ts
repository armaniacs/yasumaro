/**
 * task-friction-metrics.spec.ts (PBI 2026-09-13-52)
 *
 * Measures how many discrete clicks/fills each key task takes and fails CI
 * if a task now needs MORE steps than usability-budget.json records — a
 * proxy for "this UI change made the task harder", independent of whether
 * the task's own functional test (PBI 47/45) still passes.
 *
 * usability-budget.json is checked in; a regression here means either the
 * UI genuinely got harder to use (fix the UI) or the task legitimately
 * needs more steps now (update the budget file deliberately, in the same
 * PR, with a reviewer's eyes on the increase).
 */
import { testInteraction as test, expect } from '../fixtures/dashboard.fixture.js';
import { createDashboardSqliteClient, migrationSettled, seedRows } from '../fixtures/dashboardSqliteHelpers.js';
import { FrictionMeter } from './support/frictionMeter.js';
import budget from './support/usability-budget.json' with { type: 'json' };

test.describe('Task friction budget @extension', () => {
  test('adding a domain filter entry stays within its click budget', async ({ dashboardPage: page }) => {
    const meter = new FrictionMeter(page);

    await meter.click('[data-panel="panel-domain"]');
    const toggle = page.locator('#domainFilterToggle');
    if (!(await toggle.isChecked())) {
      await meter.click('#domainFilterToggle');
    }
    await meter.fill('#domainTagInput', 'friction-budget-test.example');
    await meter.click('#domainTagAddBtn');
    await meter.click('#domainSaveBtn');

    expect(meter.count, 'domain-filter-add task took more steps than budgeted').toBeLessThanOrEqual(
      budget['domain-filter-add']
    );
  });

  test('searching for a topic stays within its step budget', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, [
      { url: 'https://example.com/friction', title: 'Friction budget row', tags: null, created_at: Date.UTC(2026, 0, 1), domain: 'example.com' },
    ]);

    const meter = new FrictionMeter(page);
    await page.locator('button[data-panel="panel-sqlite-history"]').click();
    await expect(page.locator('#sqlite-search-input')).toBeVisible({ timeout: 10000 });
    await meter.fill('#sqlite-search-input', 'Friction budget');

    await expect(page.locator('#sqlite-entry-list')).toContainText('Friction budget row', { timeout: 15000 });

    expect(meter.count, 'search-topic task took more steps than budgeted').toBeLessThanOrEqual(
      budget['search-topic']
    );
  });

  test('exporting Markdown stays within its click budget', async ({ dashboardPage: page }) => {
    const meter = new FrictionMeter(page);
    await page.locator('[data-panel="panel-export-logs"]').click();
    await expect(page.locator('#export-markdown-btn')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await meter.click('#export-markdown-btn');
    await downloadPromise;

    expect(meter.count, 'markdown-export task took more steps than budgeted').toBeLessThanOrEqual(
      budget['markdown-export']
    );
  });

  test('opening the bug report preview stays within its click budget', async ({ dashboardPage: page }) => {
    const meter = new FrictionMeter(page);
    await meter.click('[data-panel="panel-diagnostics"]');
    await meter.click('#diagReportBugBtn');

    await expect(page.locator('#bugReportPreviewModal')).toHaveJSProperty('open', true, { timeout: 15000 });

    expect(meter.count, 'issue-report-open task took more steps than budgeted').toBeLessThanOrEqual(
      budget['issue-report-open']
    );
  });
});
