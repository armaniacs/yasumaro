import { test, expect } from './fixtures/extension.fixture.js';
import type { BrowserContext, Page } from '@playwright/test';
import { createDashboardSqliteClient, migrationSettled, seedRows } from './fixtures/dashboardSqliteHelpers.js';

/**
 * domain-intel.spec.ts (PBI 2026-10-23-10)
 *
 * End-to-end pins for the BDD scenarios behind 情報源の偏りと見直し提案:
 * a lopsided fetch shows the bias and its basis, and a noise proposal
 * applies through a user action and undoes cleanly. A third test pins the
 * few-records retreat (縮退表示) instead of a judgment built on a handful
 * of rows.
 *
 * Shape follows tag-cluster.spec.ts: seed SQLite through the dashboard
 * client, open the panel through the real sidebar navigation, switch the
 * period filter to 全期間, press Run (the panel is explicit-apply), then
 * wait on conditions with expect.poll — no fixed sleeps. Assertions stay
 * structural (visibility, row counts, button transitions) so they hold in
 * both ja and en locales.
 */

const PANEL_NAV = 'button[data-panel="panel-domain-analysis"]';
const PRESET_ALL = '#domainAnalysisFilter button[data-preset="all"]';
const RUN_BTN = '#domainAnalysisRunBtn';
const BIAS_LINE = '#domainIntelBiasLine';
const PROPOSAL_ROW = '.domain-intel-proposal-row';

function seedRow(domain: string, index: number, baseMs: number): Record<string, unknown> {
  return {
    url: `https://${domain}/page-${index}`,
    title: `Domain intel e2e row ${index}`,
    tags: null,
    created_at: baseMs - index * 1000,
    domain,
  };
}

/** 12 recent rows: 8 on the loud domain, 2 + 2 elsewhere (share 67%). */
function lopsidedSeed(): Array<Record<string, unknown>> {
  const baseMs = Date.now() - 60_000;
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 8; i++) rows.push(seedRow('noisy-intel-e2e.test', i, baseMs));
  for (let i = 0; i < 2; i++) rows.push(seedRow('quiet-a-intel-e2e.test', 100 + i, baseMs));
  for (let i = 0; i < 2; i++) rows.push(seedRow('quiet-b-intel-e2e.test', 200 + i, baseMs));
  return rows;
}

/** 3 rows: below MIN_RECORDS_FOR_BIAS, so the panel must retreat. */
function tinySeed(): Array<Record<string, unknown>> {
  const baseMs = Date.now() - 60_000;
  return [0, 1, 2].map((i) => seedRow('tiny-intel-e2e.test', i, baseMs));
}

async function openDomainAnalysis(
  context: BrowserContext,
  extensionId: string,
  rows: Array<Record<string, unknown>>,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
  const client = createDashboardSqliteClient(page);
  await migrationSettled(page, client);

  const clearToken = await client.tokenFor('clear_all', []);
  await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
  await seedRows(client, rows);

  await page.locator(PANEL_NAV).click();
  await page.locator(PRESET_ALL).click();
  await page.locator(RUN_BTN).click();
  return page;
}

test.describe('domain intel @extension', () => {
  test('lopsided fetch shows the bias and its proposal basis', async ({ context, extensionId }) => {
    const page = await openDomainAnalysis(context, extensionId, lopsidedSeed());

    // BDD: 偏りが見える — the bias line names the loud domain and its basis.
    await expect(page.locator(BIAS_LINE)).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => page.locator(BIAS_LINE).textContent(), { timeout: 15000 })
      .toContain('noisy-intel-e2e.test');

    // One proposal for the loud domain, carrying its count basis.
    await expect
      .poll(async () => page.locator(PROPOSAL_ROW).count(), { timeout: 15000 })
      .toBe(1);
    await expect(page.locator(PROPOSAL_ROW).first()).toContainText('noisy-intel-e2e.test');
    await expect(page.locator(PROPOSAL_ROW).first()).toContainText('8');
  });

  test('proposal applies through the user action and undoes cleanly', async ({ context, extensionId }) => {
    const page = await openDomainAnalysis(context, extensionId, lopsidedSeed());

    await expect
      .poll(async () => page.locator(PROPOSAL_ROW).count(), { timeout: 15000 })
      .toBe(1);
    const row = page.locator(PROPOSAL_ROW).first();
    const applyButton = row.locator('[data-intel-action="apply"]');
    const undoButton = row.locator('[data-intel-action="undo"]');
    const status = row.locator('.domain-intel-status');

    // BDD: 見直しを適用できる — applying is a click, never automatic.
    await applyButton.click();
    await expect
      .poll(async () => status.textContent(), { timeout: 15000 })
      .not.toBe('');
    await expect(undoButton).toBeVisible();
    await expect(applyButton).toBeDisabled();

    // 取消ができる — undo restores the apply affordance.
    await undoButton.click();
    await expect
      .poll(async () => undoButton.isHidden(), { timeout: 15000 })
      .toBe(true);
    await expect(applyButton).toBeEnabled();
    await expect
      .poll(async () => status.textContent(), { timeout: 15000 })
      .not.toBe('');
  });

  test('tiny fetch shows the retreat instead of a bias judgment', async ({ context, extensionId }) => {
    const page = await openDomainAnalysis(context, extensionId, tinySeed());

    // 少件数時の縮退表示: the reason names the count, and no proposal waits.
    await expect(page.locator(BIAS_LINE)).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => page.locator(BIAS_LINE).textContent(), { timeout: 15000 })
      .toContain('3');
    await expect
      .poll(async () => page.locator(PROPOSAL_ROW).count(), { timeout: 15000 })
      .toBe(0);
  });
});
