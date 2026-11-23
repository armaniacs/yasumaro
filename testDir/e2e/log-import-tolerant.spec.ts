/**
 * E2E: tolerant browsing-log import (PBI 2026-11-23-05) @extension
 *
 * UI-level contract only: a history file using the legacy `logs` key and
 * datetime/title/tags aliases is taken through the real migration entry
 * point (migrateLogsFileInput + explicit profile-migration confirmation),
 * valid rows land in SQLite with remapped keys, unfixable rows are reported
 * with per-reason counts, and re-importing the same file skips duplicates
 * instead of double-registering. The file holds four rows (two valid, two
 * unfixable), so no heavy DB generation is involved; synchronization uses
 * Playwright assertions with timeouts only (no real-time waits).
 */
import { testInteraction as test, expect } from './fixtures/dashboard.fixture.js';
import type { Page } from '@playwright/test';

test.use({ locale: 'en-US' });

const CREATED_A = Date.UTC(2026, 8, 1, 12, 0, 0);
const CREATED_B = Date.UTC(2026, 8, 1, 12, 1, 0);

/**
 * Legacy history file: legacy `logs` container key, datetime aliases
 * (`timestamp`, `visited_at`), title aliases (`pageTitle`, `name`), summary
 * alias (`description`), tags aliases (`keywords` array, `tag` string), plus
 * two unfixable rows (missing `url`, non-object row).
 */
function legacyHistoryJson(): string {
  return JSON.stringify({
    version: 1,
    logs: {
      a: {
        url: 'https://tolerant-e2e.test/a',
        pageTitle: 'Tolerant Legacy A',
        timestamp: CREATED_A,
        description: 'legacy summary a',
        keywords: ['tolerant-e2e'],
      },
      b: {
        url: 'https://tolerant-e2e.test/b',
        name: 'Tolerant Legacy B',
        visited_at: CREATED_B,
        tag: 'tolerant-e2e',
      },
      c: { pageTitle: 'Missing URL', timestamp: CREATED_B },
      d: 'not a row',
    },
  });
}

async function gotoExportImport(page: Page): Promise<void> {
  await page.locator('button[data-panel="panel-export-import"]').click();
  await expect(page.locator('#migrateLogsBtn')).toBeVisible();
}

/** Feed the legacy file through the migration entry point and confirm. */
async function importLegacyFile(page: Page): Promise<void> {
  await page.locator('#migrateLogsFileInput').setInputFiles({
    name: 'legacy-history.json',
    mimeType: 'application/json',
    buffer: Buffer.from(legacyHistoryJson()),
  });
  await expect(page.locator('.confirm-dialog-overlay')).toBeVisible();
  await expect(page.locator('.confirm-dialog-btn-danger')).toContainText(/Migrate|移行/);
  await page.locator('.confirm-dialog-btn-danger').click();
}

async function dashboardCount(page: Page): Promise<number> {
  const res = (await page.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'DASHBOARD_SQLITE',
      payload: { subtype: 'get_count' },
    }),
  )) as { success: boolean; count: number };
  expect(res.success).toBe(true);
  return res.count;
}

test.describe('Tolerant log import @extension', () => {
  test('imports alias-remapped rows and reports unfixable rows with reasons', async ({
    dashboardPage: page,
  }) => {
    await gotoExportImport(page);
    await importLegacyFile(page);

    const progress = page.locator('#importLogsProgress');
    await expect(progress).toContainText(/2 inserted|2 件挿入/, { timeout: 15000 });
    await expect(progress).toContainText(/0 skipped|0 件スキップ/, { timeout: 15000 });
    await expect(progress).toContainText(/2 invalid|2 件/, { timeout: 15000 });
    await expect(progress).toContainText('url must be a non-empty string', { timeout: 15000 });
    await expect(progress).toContainText('must be an object', { timeout: 15000 });

    // Alias remap proof: the legacy-titled row is searchable and keeps its URL.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            chrome.runtime
              .sendMessage({
                type: 'DASHBOARD_SQLITE',
                payload: { subtype: 'search', query: 'Tolerant Legacy A', limit: 10, offset: 0 },
              })
              .then((r) => JSON.stringify(r)),
          ),
        { timeout: 15000 },
      )
      .toContain('https://tolerant-e2e.test/a');

    await expect.poll(() => dashboardCount(page), { timeout: 15000 }).toBe(2);
  });

  test('re-importing the same file skips instead of double-registering', async ({
    dashboardPage: page,
  }) => {
    await gotoExportImport(page);
    await importLegacyFile(page);

    const progress = page.locator('#importLogsProgress');
    await expect(progress).toContainText(/2 inserted|2 件挿入/, { timeout: 15000 });
    await expect.poll(() => dashboardCount(page), { timeout: 15000 }).toBe(2);

    await importLegacyFile(page);

    // The second import reports the same valid rows as skipped; the waiting
    // texts ('0 inserted', '2 skipped') cannot match the first import's text.
    await expect(progress).toContainText(/0 inserted|0 件挿入/, { timeout: 15000 });
    await expect(progress).toContainText(/2 skipped|2 件スキップ/, { timeout: 15000 });
    await expect.poll(() => dashboardCount(page), { timeout: 15000 }).toBe(2);
  });
});
