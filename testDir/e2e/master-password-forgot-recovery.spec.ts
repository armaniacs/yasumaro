/**
 * E2E: master-password forgot recovery UI contract (PBI 2026-11-23-04) @extension
 *
 * UI-level contract only: the forgot entry arms on first click, asks an
 * explicit confirmation dialog on second click, and only then disables
 * protection and deletes API keys while keeping other settings. The normal
 * disable path still requires the old password (auth modal, empty submit
 * rejected before any KDF work).
 */
import { testInteraction as test, expect } from './fixtures/dashboard.fixture.js';
import type { Page } from '@playwright/test';

test.use({ locale: 'en-US' });

const PASSWORD = 'E2eValidP@ss1';

async function gotoPrivacy(page: Page): Promise<void> {
  // Settings children stay collapsed until Initial Setup is pressed.
  await page.locator('button[data-panel="panel-general"]').click();
  await page.locator('button[data-panel="panel-privacy"]').click();
  await expect(page.locator('#masterPasswordEnabled')).toBeVisible();
}

async function setPassword(page: Page): Promise<void> {
  await page.locator('#masterPasswordEnabled').check();
  await expect(page.locator('#passwordModal')).toBeVisible();
  await page.locator('#masterPasswordInput').fill(PASSWORD);
  await page.locator('#masterPasswordConfirm').fill(PASSWORD);
  await page.locator('#savePasswordBtn').click();
  await expect(page.locator('#status')).toContainText(/kept|保持/, { timeout: 60000 });
}

test.describe('Master password forgot recovery @extension', () => {
  test('forgot entry deletes protection and API keys after explicit confirmation, keeps other settings', async ({
    dashboardPage: page,
  }) => {
    await gotoPrivacy(page);

    // One plaintext key in the nested blob plus an unrelated top-level setting.
    await page.evaluate(() =>
      chrome.storage.local.set({
        settings: { obsidian_api_key: 'sk-live-e2e-obsidian' },
        obsidian_host: '127.0.0.1',
      }),
    );
    await setPassword(page);
    await expect(page.locator('#forgotMasterPasswordBtn')).toBeVisible();

    // First click only arms: label switches, no dialog, no deletion.
    await page.locator('#forgotMasterPasswordBtn').click();
    await expect(page.locator('#forgotMasterPasswordBtn')).toContainText('もう一度');
    await expect(page.locator('.confirm-dialog-overlay')).toHaveCount(0);
    const stillEnabled = await page.evaluate(() =>
      chrome.storage.local.get('master_password_enabled').then((r) => r['master_password_enabled']),
    );
    expect(stillEnabled).toBe(true);

    // Second click opens the explicit destructive confirmation.
    await page.locator('#forgotMasterPasswordBtn').click();
    await expect(page.locator('.confirm-dialog-overlay')).toBeVisible();
    await page.locator('.confirm-dialog-overlay .confirm-dialog-btn-danger').click();

    await expect(page.locator('#status')).toContainText('保護を無効化しAPIキーを削除しました', {
      timeout: 60000,
    });
    await expect(page.locator('#masterPasswordEnabled')).not.toBeChecked();

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            chrome.storage.local.get('master_password_enabled').then((r) => r['master_password_enabled']),
          ),
        { timeout: 60000 },
      )
      .toBeUndefined();

    const after = await page.evaluate(() =>
      chrome.storage.local.get(['settings', 'obsidian_host', 'master_password_salt', 'master_password_hash']),
    );
    expect((after['settings'] as Record<string, unknown>)?.['obsidian_api_key']).toBeUndefined();
    expect(after['obsidian_host']).toBe('127.0.0.1');
    expect(after['master_password_salt']).toBeUndefined();
    expect(after['master_password_hash']).toBeUndefined();
  });

  test('normal disable still requires the old password', async ({ dashboardPage: page }) => {
    await gotoPrivacy(page);

    await page.evaluate(() =>
      chrome.storage.local.set({ settings: { obsidian_api_key: 'sk-live-e2e-obsidian' } }),
    );
    await setPassword(page);

    // Checkbox-off routes to the auth modal, never to the forgot path.
    await page.locator('#masterPasswordEnabled').uncheck();
    await expect(page.locator('#passwordAuthModal')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.confirm-dialog-overlay')).toHaveCount(0);

    // Empty submit is rejected before any KDF work: old password stays required.
    await page.locator('#submitPasswordAuthBtn').click();
    await expect(page.locator('#passwordAuthError')).toContainText(/master password|マスターパスワード|password/i);
    await expect(page.locator('#passwordAuthModal')).toBeVisible();

    const enabled = await page.evaluate(() =>
      chrome.storage.local.get('master_password_enabled').then((r) => r['master_password_enabled']),
    );
    expect(enabled).toBe(true);
  });
});
