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
 * 2. The sender's pre-check data source: the manifest's DECLARED
 *    host_permissions do not cover the undeclared webhook origin
 *    (example.com), so the sender's gate
 *    (defaultIsWebhookHostPermitted → chrome.runtime.getManifest()) resolves
 *    `undeclared-origin` WITHOUT issuing any network request (fail-closed
 *    before fetch). The pin also documents why the gate must read the
 *    manifest instead of chrome.permissions.contains: the content script
 *    declares `<all_urls>`, Chromium grants that match at install time, and
 *    the probe shows contains() returning TRUE for example.com — a
 *    granted-based check could never block an undeclared destination.
 *    The same pin syncs the inline pattern-copy with the unit matcher's
 *    port semantics (PBI 2026-10-31-10): the declared loopback entries
 *    (http|https://127.0.0.1|localhost:27123|27124|11434|1234/*) carry an
 *    explicit port and are covered by host+port, while the undeclared
 *    origin stays non-covered.
 *
 * A declared-origin end-to-end POST is intentionally NOT pinned here: the
 * webhook destination is user-configurable, and the loopback coverage fact
 * above pins the declared-pattern side against the real manifest. Delivery
 * to declared origins rides the unit-pinned sender
 * (webhookExportSender.test.ts).
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

  test('the webhook gate reads declared host_permissions, which exclude the undeclared origin', async ({
    dashboardPage: page,
  }) => {
    // Two facts pin the gate's real-environment contract:
    // (a) the manifest's declared host_permissions — the data source
    //     defaultIsWebhookHostPermitted reads — do not cover example.com;
    // (b) chrome.permissions.contains answers from the GRANTED set, and the
    //     content script's <all_urls> match is granted at install time, so it
    //     returns true for the undeclared origin. This is why a granted-based
    //     check can never implement "undeclared origins are blocked" and the
    //     gate reads the manifest (see webhookExportSender.ts module header).
    const result = await page.evaluate(async () => {
      const declared: string[] = chrome.runtime.getManifest().host_permissions ?? [];
      const coveredByPattern = (url: string, pattern: string): boolean => {
        if (pattern === '<all_urls>') return true;
        const schemeSeparator = pattern.indexOf('://');
        if (schemeSeparator < 0) return false;
        const [scheme, rest] = [pattern.slice(0, schemeSeparator), pattern.slice(schemeSeparator + 3)];
        const slash = rest.indexOf('/');
        const host = slash < 0 ? rest : rest.slice(0, slash);
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return false;
        }
        if (scheme !== '*' && scheme !== parsed.protocol.replace(/:$/, '')) return false;
        if (scheme === '*' && parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        if (host === '*') return true;
        if (host.startsWith('*.')) {
          const base = host.slice(2);
          return parsed.hostname === base || parsed.hostname.endsWith(`.${base}`);
        }
        // Same port fix as the unit matcher (PBI 2026-10-31-10): a pattern
        // host that carries an explicit port compares against the URL's
        // host+port (parsed.host, which keeps the explicit port and drops
        // the scheme default); a portless pattern keeps the hostname
        // comparison (any port matches).
        const patternHasPort = host.lastIndexOf(':') > host.lastIndexOf(']');
        return host === (patternHasPort ? parsed.host : parsed.hostname);
      };
      const declaredCover = declared.some((pattern) => coveredByPattern('https://example.com/hook', pattern));
      // PBI 2026-10-31-10: the manifest declares the 16 loopback patterns
      // (http|https://127.0.0.1|localhost:27123|27124|11434|1234/*) and the
      // synced inline copy must cover one of them by host+port. The pre-fix
      // copy (host === parsed.hostname, portless) covered none of them.
      const loopbackPattern = declared.find((pattern) => /^https:\/\/(127\.0\.0\.1|localhost):\d+\//.test(pattern));
      const loopbackCover =
        loopbackPattern !== undefined
          ? coveredByPattern(`${loopbackPattern.replace(/\/\*$/, '')}/hook`, loopbackPattern)
          : false;
      // Awaiting the API directly: no timers, no retries — it resolves once
      // the browser answers.
      const grantedContains = await chrome.permissions.contains({ origins: ['https://example.com/*'] });
      return { declaredCount: declared.length, declaredCover, loopbackCover, grantedContains };
    });
    expect(result.declaredCount).toBeGreaterThan(0);
    expect(result.declaredCover).toBe(false);
    expect(result.loopbackCover).toBe(true);
    // The granted set covers every origin in a real install (the content
    // script's <all_urls> match): the reason the gate reads the manifest.
    expect(result.grantedContains).toBe(true);
  });
});
