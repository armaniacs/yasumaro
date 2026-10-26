/**
 * dashboard-sustainable-maintenance.spec.ts
 *
 * E2E for PBI 2026-10-23-05 (持続保守 ― 減らす設計と委譲の下地).
 * Covers the three BDD-level round trips that had no extension-context test:
 *
 * 1. 月次で追える: monthly digest generate → status display settles.
 *    Outcome-agnostic: without an AI key the worker reports skipped/failed,
 *    with a key it reports success. Either way the button must re-enable and
 *    the status line must show something (locale-independent: non-empty, no
 *    wording assertion). A headed run with a real key should additionally
 *    observe the success path by eye (owner-manual).
 * 2. 設定で迷わない: advanced <details> opens/closes and saving around it
 *    persists the edited value (folding never touches stored defaults).
 * 3. タグ正規化: proposal → apply → undo against seeded sqlite rows, verified
 *    through the dashboard sqlite seam (not through message wording).
 *
 * Conventions: condition waits only (expect.poll, web-first assertions).
 * No fixed sleeps, no page.waitForTimeout, no retry raises. Text assertions
 * avoid message wording so the specs pass under ja and en locales.
 */
import { test, expect } from './fixtures/seeded-history-panel.fixture.js';

test.use({ locale: 'en-US' });

/** 4 rows carrying the legacy tag + 1 untagged control row. */
function buildSeedRows() {
  const rows: Array<Record<string, unknown>> = [];
  const base = Date.UTC(2026, 8, 1, 12, 0, 0);
  for (let i = 0; i < 4; i++) {
    rows.push({
      url: `https://tag-norm-e2e.test/legacy-${i + 1}`,
      title: `Tag norm e2e legacy row ${i + 1}`,
      summary: 'tag normalization e2e seed row',
      created_at: base - i * 60000,
      domain: 'tag-norm-e2e.test',
      tags: 'e2eLegacy,e2eShared',
    });
  }
  rows.push({
    url: 'https://tag-norm-e2e.test/plain',
    title: 'Tag norm e2e untagged row',
    summary: 'tag normalization e2e control row',
    created_at: base - 9 * 60000,
    domain: 'tag-norm-e2e.test',
    tags: null,
  });
  return rows;
}

test.use({ panelSeedParams: { rows: buildSeedRows() } });

/** sqlite row counts per tag through the dashboard seam. */
async function tagCount(
  dashboardMsg: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>,
  tag: string,
): Promise<number> {
  const res = await dashboardMsg({ subtype: 'query', tagFilter: tag, limit: 50 });
  if (res?.success !== true) throw new Error(`query failed: ${JSON.stringify(res)}`);
  return Number(res?.total ?? -1);
}

test.describe('Sustainable maintenance @extension', () => {
  test('monthly digest generate settles with a visible status', async ({ seededHistoryPanel }) => {
    const { page } = seededHistoryPanel;
    await page.locator('button[data-panel="panel-general"]').click();
    // The manual digest buttons live behind the review-summary toggle.
    await page.locator('#reviewSummaryEnabled').check();
    const generateBtn = page.locator('#generateMonthlySummaryBtn');
    const status = page.locator('#reviewSummaryStatus');
    await expect(generateBtn).toBeVisible({ timeout: 15000 });

    await generateBtn.click();

    // The button disables while the worker runs and re-enables when the
    // round trip finishes (success, skip, or failure alike).
    await expect
      .poll(async () => generateBtn.isEnabled(), { timeout: 45000 })
      .toBe(true);
    // Some outcome text is displayed in every path (generated / skipped /
    // failed). Wording is locale-dependent, so only require non-empty.
    await expect(status).not.toBeEmpty();
  });

  test('advanced details opens, closes, and saving around it persists', async ({
    seededHistoryPanel,
  }) => {
    const { page } = seededHistoryPanel;
    await page.locator('button[data-panel="panel-general"]').click();
    const details = page.locator('#obsidianSettingsDetails');

    // Default: folded (no open attribute), inputs already in the DOM.
    await expect(details).not.toHaveAttribute('open', '');
    await expect(page.locator('#port')).toBeAttached();

    // Open and close via the native summary toggle.
    await details.locator('summary').first().click();
    await expect(details).toHaveAttribute('open', '');
    await details.locator('summary').first().click();
    await expect(details).not.toHaveAttribute('open', '');

    // Edit a value inside the folded section, save, and require the write
    // to land (condition wait on the settings blob, not on the DOM).
    await details.locator('summary').first().click();
    await expect(details).toHaveAttribute('open', '');
    await page.locator('#port').fill('27199');
    await page.locator('#save').click();
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const blob = await chrome.storage.local.get('settings');
            return ((blob.settings as Record<string, unknown> | undefined)?.obsidian_port as string | undefined) ?? null;
          }),
        { timeout: 10000 },
      )
      .toBe('27199');

    // Reload: the edited value survives and folding is still default-closed.
    await page.reload();
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
    await page.locator('button[data-panel="panel-general"]').click();
    await expect(page.locator('#port')).toHaveValue('27199', { timeout: 15000 });
    await expect(page.locator('#obsidianSettingsDetails')).not.toHaveAttribute('open', '');
  });

  test('tag proposal applies and undoes across seeded rows', async ({ seededHistoryPanel }) => {
    const { page, client } = seededHistoryPanel;
    // The settings subgroup (Tags lives in it) expands on Initial Setup press.
    await page.locator('button.sidebar-nav-btn[data-panel="panel-general"]').click();
    await page.locator('button.sidebar-nav-btn[data-panel="panel-tags"]').click();

    // Register the rename rule through the panel UI and save it.
    await page.locator('#normFromInput').fill('e2eLegacy');
    await page.locator('#normToInput').fill('e2eCanonical');
    await page.locator('#addNormEntryBtn').click();
    await page.locator('#saveTagsBtn').click();
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const blob = await chrome.storage.local.get('settings');
            const dict = (blob.settings as Record<string, unknown> | undefined)?.tag_normalization_dict as
              | Array<{ from: string; to: string }>
              | undefined;
            return dict?.some((e) => e.from === 'e2eLegacy' && e.to === 'e2eCanonical') ?? false;
          }),
        { timeout: 10000 },
      )
      .toBe(true);

    // The proposal surfaces (one row: the legacy tag under the new rule).
    await page.locator('#refreshNormProposalsBtn').click();
    const rows = page.locator('#tagNormProposals .norm-proposal-row');
    await expect.poll(async () => rows.count(), { timeout: 15000 }).toBe(1);
    await expect(rows.first()).toContainText('e2eLegacy');

    // Apply: all 4 seeded rows move to the canonical tag (sqlite evidence).
    await rows.first().locator('[data-norm-action="apply"]').click();
    await expect
      .poll(async () => tagCount(client.dashboardMsg, 'e2eLegacy'), { timeout: 15000 })
      .toBe(0);
    await expect
      .poll(async () => tagCount(client.dashboardMsg, 'e2eCanonical'), { timeout: 15000 })
      .toBe(4);
    // Success reveals the inline undo affordance.
    await expect(rows.first().locator('[data-norm-action="undo"]')).toBeVisible();

    // Undo: the rename reverses end to end.
    await rows.first().locator('[data-norm-action="undo"]').click();
    await expect
      .poll(async () => tagCount(client.dashboardMsg, 'e2eLegacy'), { timeout: 15000 })
      .toBe(4);
    await expect
      .poll(async () => tagCount(client.dashboardMsg, 'e2eCanonical'), { timeout: 15000 })
      .toBe(0);
  });
});
