import { expect } from '@playwright/test';
import { createDashboardFixture } from './fixtures/dashboard-shared.fixture.js';
import {
  WEBHOOK_EXPORT_DESTINATION_PATTERNS,
  judgeWebhookDestination,
} from '../../src/background/webhookExport/webhookExportDestinations.js';
import {
  WEBHOOK_EXPORT_SETTINGS_KEY,
  WebhookDestinationBlockedError,
  saveWebhookExportSettings,
  type WebhookExportStore,
} from '../../src/background/webhookExport/webhookExportSettings.js';

/**
 * Webhook egress pins @extension.
 *
 * Unit tests mock global.fetch and jsdom enforces no CSP, so only a real
 * Chromium extension page can prove the browser-level egress chain.
 *
 * 1. An origin outside the webhook allowlist (example.com, mapped to the dead
 *    port 127.0.0.1:9 in launchExtensionContext.ts so a gate regression never
 *    touches the real network) is blocked by the extension_pages document CSP.
 *    This is the second layer behind the send gate.
 *
 * 2. The send/save judgment source is the dedicated allowlist
 *    (WEBHOOK_EXPORT_DESTINATION_PATTERNS via judgeWebhookDestination), not
 *    the live manifest and not chrome.permissions.contains. The real
 *    extension grants example.com (the content script's <all_urls> match is
 *    granted at install time), so a granted-based check could never block it;
 *    the allowlist does.
 *
 * 3. The save-time pre-flight runs against the same judgment: an allowlisted
 *    https destination saves, a new off-list or new non-https destination
 *    throws WebhookDestinationBlockedError without writing, an unchanged stored
 *    allowlisted destination is grandfathered, and an empty URL is not judged.
 */

export const test = createDashboardFixture({
  seedPolicy: {
    consent: true,
    breakingChangesShown: true,
    provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
  },
});
export { expect };

const OFF_LIST_URL = 'https://example.com/webhook-hook';
const ALLOWED_URL = 'https://127.0.0.1:27123/hook';
const GRANDFATHERED_HTTP_URL = 'http://127.0.0.1:27123/hook';

function memoryStore(initial: string | null): WebhookExportStore & { writes: number; value: string | null } {
  const store = {
    value: initial,
    writes: 0,
    get: async (): Promise<string | null> => store.value,
    set: async (_key: string, value: string): Promise<void> => {
      store.value = value;
      store.writes += 1;
    },
  };
  return store;
}

function storedJson(url: string): string {
  return JSON.stringify({ enabled: true, url, condition: {} });
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

    expect(WEBHOOK_EXPORT_DESTINATION_PATTERNS.length).toBeGreaterThan(0);
    expect(judgeWebhookDestination(OFF_LIST_URL)).toEqual({
      permitted: false,
      reason: 'destination-not-in-allowlist',
      origin: 'https://example.com',
    });
    expect(judgeWebhookDestination(ALLOWED_URL)).toMatchObject({ permitted: true, reason: 'permitted' });
    // The http loopback entry is in the list but the https requirement wins.
    expect(judgeWebhookDestination(GRANDFATHERED_HTTP_URL)).toMatchObject({
      permitted: false,
      reason: 'non-https-or-empty-destination',
    });
  });

  test('the save pre-flight permits allowlisted, rejects new off-list or non-https, grandfathers stored', async () => {
    const allowedStore = memoryStore(null);
    const allowedVerdict = await saveWebhookExportSettings(
      { enabled: true, url: ALLOWED_URL, condition: {} },
      allowedStore,
    );
    expect(allowedVerdict).toMatchObject({ permitted: true });
    expect(allowedStore.writes).toBe(1);

    for (const url of [OFF_LIST_URL, GRANDFATHERED_HTTP_URL]) {
      const store = memoryStore(null);
      await expect(saveWebhookExportSettings({ enabled: true, url, condition: {} }, store)).rejects.toBeInstanceOf(
        WebhookDestinationBlockedError,
      );
      expect(store.writes).toBe(0);
    }

    // Unchanged stored off-list destination: still rejected (the clause covers
    // the initial allowlist only).
    const storedOffList = memoryStore(storedJson(OFF_LIST_URL));
    await expect(
      saveWebhookExportSettings({ enabled: true, url: OFF_LIST_URL, condition: {} }, storedOffList),
    ).rejects.toBeInstanceOf(WebhookDestinationBlockedError);

    const storedHttp = memoryStore(storedJson(GRANDFATHERED_HTTP_URL));
    const grandfatheredVerdict = await saveWebhookExportSettings(
      { enabled: false, url: GRANDFATHERED_HTTP_URL, condition: {} },
      storedHttp,
    );
    // Saved, but the verdict still reports what the send gate will do.
    expect(grandfatheredVerdict).toMatchObject({ permitted: false, reason: 'non-https-or-empty-destination' });
    expect(storedHttp.writes).toBe(1);

    const emptyStore = memoryStore(storedJson(OFF_LIST_URL));
    await expect(saveWebhookExportSettings({ enabled: false, url: '', condition: {} }, emptyStore)).resolves.toBeNull();
    expect(JSON.parse(emptyStore.value ?? '{}')).toMatchObject({ url: '' });
    expect(WEBHOOK_EXPORT_SETTINGS_KEY).toBe('webhook_export_settings_v1');
  });
});
