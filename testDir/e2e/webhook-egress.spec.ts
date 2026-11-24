import { expect, type Page } from '@playwright/test';
import { createDashboardFixture } from './fixtures/dashboard-shared.fixture.js';

/**
 * Webhook egress pins @extension.
 *
 * Browser-level chain unit tests cannot exercise (they mock fetch and jsdom
 * enforces no CSP):
 *
 * 1. Document CSP, the second layer behind the send gate: an origin outside
 *    both the allowlist and the extension_pages CSP (example.com, mapped to
 *    the dead port 127.0.0.1:9 in launchExtensionContext.ts so a gate
 *    regression never touches the real network) is blocked with
 *    connect-src (or default-src fallback).
 *
 * 2. Send-gate judgment source: the dedicated webhook destination allowlist
 *    (WEBHOOK_EXPORT_DESTINATION_PATTERNS via judgeWebhookDestination), not
 *    the live manifest and not chrome.permissions.contains. The real install
 *    grants example.com, so a granted-set check could never block it; the
 *    allowlist does. Pinned through the real settings UI: an allowlisted
 *    https loopback saves with the permitted status and persists to
 *    webhook_export_settings_v1.
 *
 * 3. Save-time pre-flight through the same UI and the same storage key: a
 *    new off-list or new non-https destination is rejected without writing,
 *    an unchanged stored http loopback destination is grandfathered
 *    (preserved, but the verdict still reports what the send gate does),
 *    and an empty URL saves without judgment. Rejection status lines carry
 *    the origin only, never the path or token.
 */

export const test = createDashboardFixture({
  seedPolicy: {
    consent: true,
    breakingChangesShown: true,
    provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
  },
});
export { expect };

// Pin the locale for determinism, but keep wording assertions locale-agnostic:
// headed Chromium inherits the OS UI language (ja on this machine), so
// chrome.i18n resolves the ja bundle here and the en bundle elsewhere.
test.use({ locale: 'en-US' });

const WEBHOOK_SETTINGS_KEY = 'webhook_export_settings_v1';
const OFF_LIST_URL = 'https://example.com/webhook-hook?token=secret';
const ALLOWED_URL = 'https://127.0.0.1:27123/hook';
const GRANDFATHERED_HTTP_URL = 'http://127.0.0.1:27123/hook';
const NEW_NON_HTTPS_URL = 'http://127.0.0.1:27124/hook';

async function openWebhookPanel(page: Page): Promise<void> {
  await page.locator('[data-panel="panel-webhook-export"]').click();
  await expect(page.locator('#panel-webhook-export')).toBeVisible();
  await expect(page.locator('#webhookExportUrl')).toBeVisible();
}

async function readRawSettings(page: Page): Promise<string | null> {
  return page.evaluate(async (key: string): Promise<string | null> => {
    const got = await chrome.storage.local.get(key);
    const value: unknown = got[key];
    return typeof value === 'string' ? value : null;
  }, WEBHOOK_SETTINGS_KEY);
}

async function expectUrlRoundTrip(page: Page, url: string): Promise<void> {
  // The stored URL is an encrypted envelope since PBI 2026-11-24-15, so
  // persistence is proven through the real UI: reload, reopen the panel,
  // and confirm load() decrypts the stored value back into the form.
  await page.reload();
  await openWebhookPanel(page);
  await expect(page.locator('#webhookExportUrl')).toHaveValue(url);
}

async function saveUrlThroughUi(page: Page, url: string): Promise<void> {
  await page.locator('#webhookExportUrl').fill(url);
  await page.locator('#webhookExportSaveBtn').click();
}

test.describe('Webhook egress @extension', () => {
  test('blocks an off-allowlist webhook origin through the document CSP', async ({ dashboardPage: page }) => {
    // Event-driven: resolves on the securitypolicyviolation event or the fetch
    // settlement; the timer only prevents a hang.
    const result = await page.evaluate(
      (url) =>
        new Promise<{ blocked: boolean; directive: string; blockedUri: string }>((resolve) => {
          // eslint-disable-next-line local/no-test-sleep -- upper bound on the event-driven wait, never a wait-to-pass (resolves on the event or the fetch settlement; the timer only prevents a hang)
          const timeout = setTimeout(() => resolve({ blocked: false, directive: '', blockedUri: '' }), 8000);
          document.addEventListener(
            'securitypolicyviolation',
            (event) => {
              clearTimeout(timeout);
              const violation = event as SecurityPolicyViolationEvent;
              resolve({
                blocked: true,
                directive: violation.effectiveDirective,
                blockedUri: violation.blockedURI,
              });
            },
            { once: true },
          );
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"probe":true}',
          }).then(
            () => {
              clearTimeout(timeout);
              resolve({ blocked: false, directive: '', blockedUri: '' });
            },
            () => {
              // Rejected without a violation event is a transport failure, not
              // a CSP block; the timeout path reports not-blocked.
            },
          );
        }),
      OFF_LIST_URL,
    );

    expect(result.blocked).toBe(true);
    expect(result.blockedUri).toContain('example.com');
    expect(['connect-src', 'default-src']).toContain(result.directive);
  });

  test('the send gate judges by the webhook allowlist, not the granted permission set', async ({
    dashboardPage: page,
  }) => {
    const grantedContains = await page.evaluate(() =>
      chrome.permissions.contains({ origins: ['https://example.com/*'] }),
    );
    // The real install grants example.com, so only the dedicated allowlist can
    // reject it.
    expect(grantedContains).toBe(true);

    await test.step('allowlisted https loopback saves through the real UI', async () => {
      await page.evaluate(async (key: string): Promise<void> => {
        await chrome.storage.local.remove(key);
      }, WEBHOOK_SETTINGS_KEY);
      await openWebhookPanel(page);
      await saveUrlThroughUi(page, ALLOWED_URL);

      const status = page.locator('#webhookExportStatus');
      // Locale-agnostic: en "Saved. Destination <origin> is permitted." /
      // ja "保存しました。宛先 <origin> は許可されています。"
      await expect(status).toContainText('https://127.0.0.1:27123');
      await expect(status).toContainText(/is permitted|は許可されています/);
      await expect(status).toHaveClass(/success/);

      // No plaintext URL in storage (PBI 2026-11-24-15), then UI round-trip.
      const raw = await readRawSettings(page);
      expect(raw).not.toBeNull();
      expect(raw).not.toContain(ALLOWED_URL);
      await expectUrlRoundTrip(page, ALLOWED_URL);
    });
  });

  test('the save pre-flight permits allowlisted, rejects new off-list or non-https, grandfathers stored', async ({
    dashboardPage: page,
  }) => {
    // Grandfather first: seed BEFORE opening the panel so load() reads the
    // stored destination into the form.
    await page.evaluate(
      async (args: { key: string; url: string }): Promise<void> => {
        await chrome.storage.local.set({
          [args.key]: JSON.stringify({ enabled: true, url: args.url, condition: {} }),
        });
      },
      { key: WEBHOOK_SETTINGS_KEY, url: GRANDFATHERED_HTTP_URL },
    );
    await openWebhookPanel(page);
    const urlInput = page.locator('#webhookExportUrl');
    await expect(urlInput).toHaveValue(GRANDFATHERED_HTTP_URL);

    await test.step('unchanged stored http loopback is preserved with an error status', async () => {
      await page.locator('#webhookExportSaveBtn').click();
      const status = page.locator('#webhookExportStatus');
      // Locale-agnostic: en "Saved. Existing destination <origin> is
      // preserved, but the send gate rejects it ..." / ja "保存しました。
      // 既存宛先 <origin> は現状維持されますが ...".
      await expect(status).toContainText(/preserved, but the send gate rejects it|現状維持/);
      await expect(status).toContainText('http://127.0.0.1:27123');
      await expect(status).toHaveClass(/error/);
      // The unchanged save re-encrypts the seeded plaintext (PBI 2026-11-24-15):
      // prove preservation through the UI round-trip instead of raw bytes.
      await expectUrlRoundTrip(page, GRANDFATHERED_HTTP_URL);
    });

    await test.step('a new non-https destination is rejected without writing', async () => {
      const before = await readRawSettings(page);
      await saveUrlThroughUi(page, NEW_NON_HTTPS_URL);
      const status = page.locator('#webhookExportStatus');
      // Locale-agnostic: en "Save rejected: the destination must be https
      // (<origin>)." / ja "保存を拒否しました: 宛先は https 専用です（<origin>）。"
      await expect(status).toContainText(/must be https|https 専用/);
      await expect(status).toContainText('http://127.0.0.1:27124');
      await expect(status).toHaveClass(/error/);
      expect(await readRawSettings(page)).toBe(before);
    });

    await test.step('an off-list destination with a token is rejected without leaking the secret', async () => {
      const beforeOffList = await readRawSettings(page);
      await saveUrlThroughUi(page, OFF_LIST_URL);
      const status = page.locator('#webhookExportStatus');
      // Locale-agnostic: en "Save rejected: destination origin <origin> is
      // not in the webhook destination allowlist." / ja "保存を拒否しました:
      // 宛先 origin <origin> は Webhook 宛先許可リストに含まれていません。"
      await expect(status).toContainText(/not in the webhook destination allowlist|許可リストに含まれていません/);
      await expect(status).toHaveClass(/error/);
      const text = (await status.textContent()) ?? '';
      expect(text).toContain('https://example.com');
      expect(text).not.toContain('secret');
      expect(text).not.toContain('/webhook-hook');
      expect(await readRawSettings(page)).toBe(beforeOffList);
    });

    await test.step('an empty URL saves without judgment', async () => {
      await saveUrlThroughUi(page, '');
      const status = page.locator('#webhookExportStatus');
      // Locale-agnostic: en "Webhook export settings saved." /
      // ja "Webhook エクスポート設定を保存しました。"
      await expect(status).toContainText(/Webhook export settings saved|エクスポート設定を保存しました/);
      await expect(status).toHaveClass(/success/);
      await expectUrlRoundTrip(page, '');
    });
  });
});
