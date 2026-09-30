/**
 * E2E: master-password KEK rotation UI contract (PBI 2026-09-27) @extension
 *
 * UI-level contract only: keys are kept (not wiped) across set/remove,
 * abort keeps the checkbox checked with a field-named error, and no success
 * message appears on failure. Durability under Service Worker termination is
 * covered deterministically by fault-injection integration tests
 * (encryptionSession-reencrypt.test.ts); driving a real SW kill from
 * Playwright is not reproducible here.
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

test.describe('Master password KEK rotation @extension', () => {
  test('set keeps a plaintext API key by re-encrypting it, then remove keeps it readable', async ({
    dashboardPage: page,
  }) => {
    await gotoPrivacy(page);

    // Seed one plaintext key in the nested blob (production read path handles it).
    await page.evaluate(() => chrome.storage.local.set({ settings: { obsidian_api_key: 'sk-live-e2e-obsidian' } }));

    // --- set flow ---
    await page.locator('#masterPasswordEnabled').check();
    await expect(page.locator('#passwordModal')).toBeVisible();
    await page.locator('#masterPasswordInput').fill(PASSWORD);
    await page.locator('#masterPasswordConfirm').fill(PASSWORD);
    await page.locator('#savePasswordBtn').click();
    await expect(page.locator('#status')).toContainText(/kept|保持/, { timeout: 60000 });

    const afterSet = await page.evaluate(() => chrome.storage.local.get(['settings', 'master_password_enabled']));
    expect(afterSet['master_password_enabled']).toBe(true);
    const blob = afterSet['settings'] as Record<string, unknown>;
    const envelope = blob['obsidian_api_key'] as { ciphertext?: unknown; iv?: unknown };
    expect(typeof envelope).toBe('object');
    expect(typeof envelope.ciphertext).toBe('string');
    expect(typeof envelope.iv).toBe('string');

    // --- remove flow keeps the key (envelope, not wiped to '') ---
    await page.locator('#masterPasswordEnabled').uncheck();
    await expect(page.locator('#passwordAuthModal')).toBeVisible({ timeout: 60000 });
    await page.locator('#masterPasswordAuthInput').fill(PASSWORD);
    await page.locator('#submitPasswordAuthBtn').click();
    // Real KDF (600k) makes this slow: poll the durable end state, and do not
    // mistake the earlier set-step message for remove's completion.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            chrome.storage.local.get('master_password_enabled').then((r) => r['master_password_enabled']),
          ),
        { timeout: 60000 },
      )
      .toBeUndefined();

    const afterRemove = await page.evaluate(() =>
      chrome.storage.local.get(['settings', 'master_password_enabled', 'master_password_salt']),
    );
    expect(afterRemove['master_password_enabled']).toBeUndefined();
    expect(afterRemove['master_password_salt']).toBeUndefined();
    const kept = (afterRemove['settings'] as Record<string, unknown>)['obsidian_api_key'] as {
      ciphertext?: unknown;
    };
    expect(typeof kept).toBe('object');
    expect(typeof kept.ciphertext).toBe('string');
  });

  test('remove aborts on an undecryptable field: checkbox stays checked, metadata and ciphertext intact', async ({
    dashboardPage: page,
  }) => {
    await gotoPrivacy(page);

    await page.evaluate(() => chrome.storage.local.set({ settings: { obsidian_api_key: 'sk-live-e2e-obsidian' } }));
    await page.locator('#masterPasswordEnabled').check();
    await expect(page.locator('#passwordModal')).toBeVisible();
    await page.locator('#masterPasswordInput').fill(PASSWORD);
    await page.locator('#masterPasswordConfirm').fill(PASSWORD);
    await page.locator('#savePasswordBtn').click();
    await expect(page.locator('#status')).toContainText(/kept|保持/, { timeout: 60000 });

    // Inject one ciphertext-shaped but undecryptable field (scattered).
    await page.evaluate(() =>
      chrome.storage.local.set({
        provider_api_key: { ciphertext: 'dW5yZWxhdGVkLWNpcGhlcnRleHQtcGF5bG9hZC0wMDA=', iv: 'dW5yZWxhdGVkLWl2LTA=' },
      }),
    );
    const before = await page.evaluate(() =>
      chrome.storage.local.get(['master_password_enabled', 'master_password_hash', 'provider_api_key']),
    );

    await page.locator('#masterPasswordEnabled').uncheck();
    await expect(page.locator('#passwordAuthModal')).toBeVisible({ timeout: 60000 });
    await page.locator('#masterPasswordAuthInput').fill(PASSWORD);
    await page.locator('#submitPasswordAuthBtn').click();

    // Abort contract: modal stays open, checkbox restored, field named, no success.
    await expect(page.locator('#passwordAuthModal')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#masterPasswordEnabled')).toBeChecked();
    await expect(page.locator('#passwordAuthError')).toContainText('provider_api_key', { timeout: 60000 });
    await expect(page.locator('#status')).not.toContainText(/kept|保持/);

    const after = await page.evaluate(() =>
      chrome.storage.local.get(['master_password_enabled', 'master_password_hash', 'provider_api_key']),
    );
    expect(after['master_password_enabled']).toBe(before['master_password_enabled']);
    expect(after['master_password_hash']).toBe(before['master_password_hash']);
    expect(JSON.stringify(after['provider_api_key'])).toBe(JSON.stringify(before['provider_api_key']));
  });
});
