/**
 * E2E: log-import AI repair entry (importLogsAiRepairUi) @extension
 *
 * UI-level contract only, through the real dashboard wiring
 * (exportImport renderLogsImportResult -> AiRepairUi.showForResult):
 *
 * 1. An import result with rejected rows renders the repair entry button
 *    ([data-ai-repair-entry]), and nothing is sent before the explicit
 *    entry click (no proposals rendered).
 * 2. An import result without rejected rows renders no entry.
 * 3. While the session is locked, clicking the entry shows the
 *    locked guidance instead of sending (isLocked short-circuit in
 *    handleRequest runs before any client creation).
 *
 * No real AI connection is used: tests 1-2 never click the entry, and
 * test 3 clicks it only while locked, where the production code returns
 * before creating a client. The unsigned payloads go through the
 * profile-migration import path (the only path that skips HMAC
 * verification, behind its explicit confirmation dialog), so no
 * signature forgery is needed.
 */
import { testInteraction as test, expect } from './fixtures/dashboard.fixture.js';
import type { Page } from '@playwright/test';

test.use({ locale: 'en-US' });

// StorageKeys.MASTER_PASSWORD_ENABLED / IS_LOCKED (utils/storage/types.ts) —
// e2e specs keep the string literals (no src imports, see the other specs).
const MASTER_PASSWORD_ENABLED_KEY = 'master_password_enabled';
const IS_LOCKED_KEY = 'is_locked';

function validRow(url: string, createdAt: number): Record<string, unknown> {
  return { url, title: 'E2E row', created_at: createdAt };
}

async function gotoExportImport(page: Page): Promise<void> {
  await page.locator('button[data-panel="panel-export-import"]').click();
  await expect(page.locator('#migrateLogsFileInput')).toBeAttached();
}

/**
 * Import an UNSIGNED payload through the real migration entry point
 * (#migrateLogsFileInput -> explicit confirm dialog -> importLogsService ->
 * renderLogsImportResult -> AiRepairUi.showForResult). Resolves when the
 * import result is rendered.
 */
async function migrateLogs(page: Page, payload: unknown): Promise<void> {
  await page.locator('#migrateLogsFileInput').setInputFiles({
    name: 'logs-migration-e2e.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  // Explicit user confirmation gate for the relaxed-verification path.
  const migrateButton = page.locator('.confirm-dialog-btn-danger');
  await expect(migrateButton).toBeVisible({ timeout: 15000 });
  await migrateButton.click();
  await expect(page.locator('#importLogsProgress')).toContainText(/Import complete|インポート完了/, {
    timeout: 60000,
  });
}

test.describe('Log import AI repair entry @extension', () => {
  test('shows the repair entry when the import has rejected rows, and sends nothing before the click', async ({
    dashboardPage: page,
  }) => {
    await gotoExportImport(page);
    const now = Date.now();
    await migrateLogs(page, {
      version: 1,
      rows: [validRow('https://ai-repair-e2e.test/with-invalid', now), { pageTitle: 'no url' }],
    });

    const entry = page.locator('#importLogsAiRepair [data-ai-repair-entry]');
    await expect(entry).toBeVisible({ timeout: 15000 });
    await expect(entry).toContainText(/Propose AI repairs|AI修正を提案/);

    // No explicit entry click yet: no proposals requested or rendered.
    await expect(page.locator('#importLogsAiRepair [data-ai-repair-diff]')).toHaveCount(0);
    await expect(page.locator('#importLogsAiRepair [data-ai-repair-apply]')).toHaveCount(0);
  });

  test('shows no repair entry when the import has no rejected rows', async ({
    dashboardPage: page,
  }) => {
    await gotoExportImport(page);
    const now = Date.now();
    await migrateLogs(page, {
      version: 1,
      rows: [
        validRow('https://ai-repair-e2e.test/valid-1', now),
        validRow('https://ai-repair-e2e.test/valid-2', now + 1),
      ],
    });

    await expect(page.locator('#importLogsAiRepair [data-ai-repair-entry]')).toHaveCount(0);
  });

  test('locked session turns the entry click into a no-send locked guidance', async ({
    dashboardPage: page,
  }) => {
    await gotoExportImport(page);
    const now = Date.now();
    await migrateLogs(page, {
      version: 1,
      rows: [validRow('https://ai-repair-e2e.test/locked', now), { pageTitle: 'no url' }],
    });

    const entry = page.locator('#importLogsAiRepair [data-ai-repair-entry]');
    await expect(entry).toBeVisible({ timeout: 15000 });

    await page.evaluate(
      ({ enabledKey, lockedKey }) =>
        chrome.storage.local.set({ [enabledKey]: true, [lockedKey]: true }),
      { enabledKey: MASTER_PASSWORD_ENABLED_KEY, lockedKey: IS_LOCKED_KEY },
    );

    await entry.click();

    // Suppression guidance, not a repair request: no proposals, no apply.
    await expect(page.locator('#importLogsAiRepair')).toContainText(/locked|施錠|ロック/i, {
      timeout: 15000,
    });
    await expect(page.locator('#importLogsAiRepair [data-ai-repair-diff]')).toHaveCount(0);
    await expect(page.locator('#importLogsAiRepair [data-ai-repair-apply]')).toHaveCount(0);
  });
});
