import { expect } from '@playwright/test';
import { createDashboardFixture } from './fixtures/dashboard-shared.fixture.js';

/**
 * Webhook egress undeclared-origin pin @extension (PBI 2026-10-22-05).
 *
 * Modeled on the Gist 3-pin (testDir/e2e/gist-egress.spec.ts, pin 3): unit
 * tests mock global.fetch and jsdom enforces no CSP, so only a real
 * Chromium extension page can prove the browser-level egress chain.
 *
 * What this pins for the user-configured webhook destination
 * (src/background/webhookExport/webhookExportSender.ts):
 *
 * 1. An UNDECLARED origin (example.com — mapped to the dead port
 *    127.0.0.1:9 in launchExtensionContext.ts, so even a gate regression
 *    never touches the real network) is blocked by the extension_pages
 *    document CSP: the securitypolicyviolation event fires with the
 *    connect-src/default-src directive. This is the second layer behind the
 *    sender's chrome.permissions.contains pre-check.
 *
 * 2. The sender's pre-check primitive itself: chrome.permissions.contains
 *    returns false for that undeclared webhook origin from a real extension
 *    page, so the send path resolves `undeclared-origin` WITHOUT issuing
 *    any network request (fail-closed before fetch).
 *
 * A declared-origin end-to-end POST is intentionally NOT pinned here: the
 * webhook destination is user-configured, so no single origin can be
 * declared in host_permissions for it. Delivery to declared origins rides
 * the unit-pinned sender (webhookExportSender.test.ts).
 */

export const test = createDashboardFixture({
  seedPolicy: {
    consent: true,
    breakingChangesShown: true,
    provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
  },
});
export { expect };

test.describe('Webhook egress @extension', () => {
  test('blocks an undeclared webhook origin through the document CSP', async ({ dashboardPage: page }) => {
    // Same event-driven contract as the Gist pin 3: the promise resolves on
    // the securitypolicyviolation event or the fetch settlement, never by
    // the timer (which only prevents a hang — see the local/no-test-sleep
    // justification inline).
    const result = await page.evaluate(
      () =>
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
          fetch('https://example.com/webhook-hook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"probe":true}',
          }).then(
            () => {
              clearTimeout(timeout);
              resolve({ blocked: false, directive: '', blockedUri: '' });
            },
            () => {
              // Rejected without a violation event: a transport failure, not a
              // CSP block. Let the timeout path report not-blocked.
            },
          );
        }),
    );

    expect(result.blocked).toBe(true);
    expect(result.blockedUri).toContain('example.com');
    expect(['connect-src', 'default-src']).toContain(result.directive);
  });

  test('the sender pre-check sees the undeclared webhook origin as not permitted', async ({
    dashboardPage: page,
  }) => {
    // chrome.permissions.contains mirrors exactly what
    // permissionManager.isHostPermitted (and therefore the webhook sender's
    // undeclared-origin gate) observes for this origin. Awaiting the boolean
    // directly: no timers, no retries — the API resolves once the browser
    // answers.
    const permitted: boolean = await page.evaluate(() =>
      chrome.permissions.contains({ origins: ['https://example.com/*'] }),
    );
    expect(permitted).toBe(false);
  });
});
