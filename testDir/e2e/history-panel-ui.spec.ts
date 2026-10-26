/**
 * history-panel-ui.spec.ts
 *
 * Behavioral e2e for the SQLite history panel — the area rounds 5-7 changed
 * most (tag filter moved to SQL, pagination, star persistence). Previously
 * only panel-existence was covered (round 6 audit: High gap).
 *
 * Seeded and opened by the seededHistoryPanel fixture (DASHBOARD_SQLITE import
 * path); the UI is driven through the real sidebar navigation. The fixture
 * context is per-test, so each test seeds its own rows.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';
import { migrationSettled, poll } from './fixtures/dashboardSqliteHelpers.js';
import { readFileSync } from 'node:fs';

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

test.use({ panelSeedParams: { rows: buildSeedRows() } });

test.describe('History panel UI @extension', () => {
  test('panel lists the seeded rows (first page of 20)', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;

    const rowCount = await page.locator('#sqlite-entry-list .sqlite-entry').count();
    expect(rowCount).toBe(20);
    // Total count text reflects all 25 seeded rows.
    await expect(page.locator('.sqlite-history-count')).toContainText('25');
  });

  test('tag badge filters the list and clear restores it', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;

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

  test('star toggles and persists across reload', async ({ seededHistoryPanel }) => {
    const { page, client, seedRow: firstRow } = seededHistoryPanel;

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

  test('bulk star applies to checked rows and undo reverts it (PBI 2026-10-23-07)', async ({
    seededHistoryPanel,
  }) => {
    const { page } = seededHistoryPanel;

    // Check the first two rows; the bulk bar appears with the count.
    const checkboxes = page.locator('#sqlite-entry-list .sqlite-entry-checkbox');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await expect(page.locator('#sqlite-bulk-bar')).toBeVisible({ timeout: 15000 });

    // Two-step confirm: star button reveals the confirm group, apply-all stars both.
    await page.locator('#sqlite-star-selected').click();
    await expect(page.locator('#sqlite-star-confirm')).toBeVisible({ timeout: 15000 });
    await page.locator('#sqlite-star-confirm-all').click();

    const starred = page.locator('#sqlite-entry-list .sqlite-entry [data-action="star"].starred');
    await expect.poll(async () => starred.count(), { timeout: 15000 }).toBe(2);

    // Inline undo appears and reverts both rows.
    await expect(page.locator('#sqlite-star-undo')).toBeVisible({ timeout: 15000 });
    await page.locator('#sqlite-star-undo-btn').click();
    await expect.poll(async () => starred.count(), { timeout: 15000 }).toBe(0);
  });

  test('pagination pages through the second page', async ({ seededHistoryPanel }) => {
    const { page, client } = seededHistoryPanel;

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

test.describe('Research report @interaction (PBI 2026-10-23-09)', () => {
  // BDD: レポートが生成される + 送り先に届く — the panel conditions become the
  // scope, the button delivers the four-section Markdown through the existing
  // local-download path, and the status confirms the delivery.
  //
  // Headed-only: the download is initiated by the service worker
  // (chrome.downloads.download), and headless Chromium does not surface
  // SW-initiated downloads to page/context waitForEvent (directly probed:
  // the SW call resolves with a download id, no event fires). Page-initiated
  // downloads (CSV/JSON anchor path) stay @extension. Logic itself is pinned
  // headless by generator/handler/gateway unit tests.
  test.describe('', () => {
    test.use({
      panelSeedParams: {
        clearBeforeSeed: true,
        rows: [
          {
            url: 'https://report-e2e.test/alpha',
            title: 'Report E2E Alpha',
            summary: 'Alpha persisted summary',
            created_at: Date.UTC(2026, 8, 1, 12, 0, 0),
            domain: 'report-e2e.test',
            tags: 'reportE2e',
          },
          {
            url: 'https://report-e2e.test/beta',
            title: 'Report E2E Beta',
            summary: 'Beta persisted summary',
            created_at: Date.UTC(2026, 8, 1, 12, 1, 0),
            domain: 'report-e2e.test',
            tags: 'reportE2e',
          },
          {
            url: 'https://report-e2e.test/gamma',
            title: 'Report E2E Gamma',
            summary: '',
            created_at: Date.UTC(2026, 8, 1, 12, 2, 0),
            domain: 'report-e2e.test',
            tags: 'reportE2e',
          },
        ],
        rowText: 'Report E2E Alpha',
      },
    });

    test('generating downloads a four-section Markdown report and confirms delivery', async ({
      seededHistoryPanel,
    }) => {
      const { page } = seededHistoryPanel;
      const region = page.locator('#sqlite-research-report');
      const generateButton = region.locator('[data-report-action="generate"]');
      await expect(generateButton).toBeVisible({ timeout: 15000 });

      const downloadPromise = page.waitForEvent('download');
      await generateButton.click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toMatch(/^research-.*\.md$/);
      const savedPath = await download.path();
      expect(savedPath).toBeTruthy();
      const content = readFileSync(savedPath!, 'utf-8');
      expect(content).toContain('# 調査レポート');
      expect(content).toContain('## 要旨');
      expect(content).toContain('## 時系列');
      expect(content).toContain('## 引用');
      expect(content).toContain('## 未読穴');
      // Digest quotes the persisted summaries; the summary-less row lands in
      // the unread-holes section; citations link back to the original URLs.
      expect(content).toContain('Alpha persisted summary');
      expect(content).toContain('Report E2E Gamma');
      expect(content).toContain('https://report-e2e.test/alpha');

      // 送達確認: the status reports the delivered record count (file pins
      // locale en-US, so the English done text applies).
      await expect(region.locator('.research-report-status')).toContainText('3 records', {
        timeout: 15000,
      });
    });
  });

  // BDD: 生成の縮退・失敗が偽成功にならない + 失敗時は理由と再送ができる —
  // a scope matching nothing surfaces the reason, and restoring the scope
  // then generating again (再送) delivers the report.
  test.describe('', () => {
    test.use({
      panelSeedParams: {
        clearBeforeSeed: true,
        rows: [
          {
            url: 'https://report-e2e.test/retry-one',
            title: 'Retry Seed One',
            summary: 'Retry seed summary',
            created_at: Date.UTC(2026, 8, 2, 12, 0, 0),
            domain: 'report-e2e.test',
          },
          {
            url: 'https://report-e2e.test/retry-two',
            title: 'Retry Seed Two',
            summary: 'Second retry summary',
            created_at: Date.UTC(2026, 8, 2, 12, 1, 0),
            domain: 'report-e2e.test',
          },
        ],
        rowText: 'Retry Seed One',
      },
    });

    test('an empty match fails with a reason and a retry after restoring scope succeeds', async ({
      seededHistoryPanel,
    }) => {
      const { page } = seededHistoryPanel;
      const region = page.locator('#sqlite-research-report');
      const generateButton = region.locator('[data-report-action="generate"]');
      const status = region.locator('.research-report-status');
      const search = page.locator('#sqlite-search-input');
      await expect(search).toBeVisible({ timeout: 10000 });

      // Narrow the scope to nothing: the debounced search empties the list.
      await search.fill('zzz-no-such-record-09');
      await expect
        .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
        .toBe(0);

      await expect(generateButton).toBeVisible({ timeout: 15000 });
      await generateButton.click();
      // 縮退の出口: the raw reason surfaces — never a fake done state.
      await expect(status).toContainText('no_records', { timeout: 15000 });

      // 再送: restore the scope, wait for the rows to return, generate again.
      await search.fill('');
      await expect
        .poll(async () => page.locator('#sqlite-entry-list .sqlite-entry').count(), { timeout: 15000 })
        .toBeGreaterThan(0);

      const downloadPromise = page.waitForEvent('download');
      await generateButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^research-.*\.md$/);
      await expect(status).toContainText('records', { timeout: 15000 });
    });
  });
});
