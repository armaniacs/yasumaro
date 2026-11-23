/**
 * E2E: master-password lock UX guidance @extension
 *
 * UI-level contract only: while the master-password session is locked,
 * the Initial Setup panel disables API key fields and save actions with
 * an unlock guide, and the AI test explains the lock as the cause instead
 * of running decryption or network I/O. Durability of the lock flag itself
 * is covered by fault-injection integration tests; this spec pins the DOM
 * contract through the real extension page.
 */
import { testInteraction as test, expect } from './fixtures/dashboard.fixture.js';
import type { Page } from '@playwright/test';

test.use({ locale: 'en-US' });

// StorageKeys literals (e2e specs keep string literals, no src imports).
const MASTER_PASSWORD_ENABLED_KEY = 'master_password_enabled';
const IS_LOCKED_KEY = 'is_locked';

async function enterLockedSession(page: Page): Promise<void> {
  // Run the deferred startup migration first so the flat lock seed written
  // afterwards stays top-level (same order as session-lock-fanout.spec.ts).
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'PING' }));
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          chrome.storage.local
            .get(['settings_migrated'])
            .then((r) => (r['settings_migrated'] as { stage?: string } | undefined)?.stage),
        ),
      { timeout: 15_000 },
    )
    .toBe('completed');

  await page.evaluate(
    ({ enabledKey, lockedKey }) => chrome.storage.local.set({ [enabledKey]: true, [lockedKey]: true }),
    { enabledKey: MASTER_PASSWORD_ENABLED_KEY, lockedKey: IS_LOCKED_KEY },
  );

  // The lock display is applied on panel mount/refresh, so reload to drive
  // the production path (no synthetic event dispatch).
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#geminiSettings')).toBeVisible();
  await expect(page.locator('#sessionLockNotice')).toBeVisible();
}

test.describe('Master password lock UX @extension', () => {
  test('locked session disables API key fields and save with an unlock guide', async ({
    dashboardPage: page,
  }) => {
    await enterLockedSession(page);

    await expect(page.locator('#panel-general input[data-storage-key="obsidian_api_key"]')).toBeDisabled();
    await expect(page.locator('#panel-general input[data-storage-key="gemini_api_key"]')).toBeDisabled();
    await expect(page.locator('#save')).toBeDisabled();
    await expect(page.locator('#saveTop')).toBeDisabled();

    const notice = page.locator('#sessionLockNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/lock|ロック/i);
    await expect(notice).toContainText(/Setup order|Privacy|Unlock/);

    const unlockButton = page.locator('#sessionLockUnlockBtn');
    await expect(unlockButton).toBeVisible();
    await unlockButton.click();
    await expect(page.locator('#masterPasswordEnabled')).toBeVisible();
  });

  test('locked session AI test explains the lock cause instead of running', async ({
    dashboardPage: page,
  }) => {
    await enterLockedSession(page);

    // The AI test button itself stays enabled; the handler gates before any
    // save or TEST_AI round-trip and names the lock as the cause.
    await expect(page.locator('#testAiBtn')).toBeEnabled();
    await page.locator('#testAiBtn').click();

    const status = page.locator('#status');
    await expect(status).toContainText(/lock|ロック/i);
    await expect(status).toContainText(/Privacy|Unlock|master password|マスターパスワード|解除/);
  });
});
