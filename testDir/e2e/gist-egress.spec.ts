import { expect, type Page } from '@playwright/test';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDashboardFixture } from './fixtures/dashboard-shared.fixture.js';

/**
 * Gist egress full flow @extension (PBI 2026-10-18-25 blocker 1 / 2026-10-21-11)
 *
 * Pins the browser-level egress chain that unit tests cannot exercise (they
 * mock global.fetch, and jsdom enforces no CSP):
 *
 * 1. A valid PAT reaching the DECLARED origin: the settings UI saves the PAT,
 *    the connection tester resolves the shared sqlite client, fetchWithTimeout
 *    sends `GET https://api.github.com/user` with the Authorization header, and
 *    the response validation shows the success status. The request must pass
 *    the extension_pages CSP connect-src (the origin matches the declared
 *    `https://api.github.com` entry) and host_permissions (GIST_EGRESS_HOSTS).
 *
 * 2. The failure contract: an invalid PAT (401 from the API) shows the error
 *    status — fail-closed all the way to the UI, never a silent success.
 *
 * 3. The CSP is actually ENFORCING: a fetch to an UNDECLARED origin from the
 *    extension page is blocked by the document CSP (observed manually on
 *    2026-10-21 as `default-src 'none'` fallback before the meta CSP tag was
 *    removed, and as an allowed fetch after). This pin proves the positive
 *    pin above is meaningful rather than vacuous.
 *
 * HOW the origin is served: extension_pages CSP matches the ORIGIN STRING
 * (`https://api.github.com`), not the resolved IP, so mapping
 * api.github.com:443 → 127.0.0.1:8444 (launchExtensionContext) keeps the
 * browser CSP gate running while the TLS mock answers locally. example.com is
 * mapped to a dead port (127.0.0.1:9) so the undeclared-origin pin never
 * touches the real network even if the CSP were not enforcing. No real PAT is
 * needed: the mock classifies by the Authorization header, so the real
 * credential check stays owner-manual (the token cannot be committed).
 */

export const test = createDashboardFixture({
  seedPolicy: {
    consent: true,
    breakingChangesShown: true,
    provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
  },
});
export { expect };

const VALID_PAT = 'e2e-valid-pat';
const INVALID_PAT = 'e2e-invalid-pat';
// Must match the MAP target in launchExtensionContext.ts
const GIST_TLS_PORT = 8444;

let gistTlsServer: HttpsServer;

test.beforeAll(async () => {
  const fixturesDir = join(process.cwd(), 'testDir/e2e/fixtures');
  gistTlsServer = createHttpsServer(
    {
      cert: readFileSync(join(fixturesDir, 'dev-server-cert.pem')),
      key: readFileSync(join(fixturesDir, 'dev-server-key.pem')),
    },
    (req, res) => {
      const pathOnly = (req.url || '/').split('?')[0] || '/';
      if (req.method === 'GET' && pathOnly === '/user') {
        const auth = req.headers.authorization || '';
        if (auth === `token ${VALID_PAT}`) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ login: 'e2e-user', id: 1 }));
          return;
        }
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Bad credentials' }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found' }));
    },
  );
  await new Promise<void>((resolve) => gistTlsServer.listen(GIST_TLS_PORT, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  if (gistTlsServer) {
    await new Promise<void>((resolve) => gistTlsServer.close(() => resolve()));
  }
});

async function openDiagnosticsGistSection(page: Page): Promise<void> {
  // The Gist sync section lives in the Export/Import panel (Tools section),
  // outside the collapsed settings subgroup — directly reachable.
  await page.locator('[data-panel="panel-export-import"]').click();
  await expect(page.locator('#panel-export-import')).toBeVisible();
  await expect(page.locator('#testGistConnectionBtn')).toBeVisible();
}

test.describe('Gist egress @extension', () => {
  test('test connection with a valid PAT reaches the declared origin end to end', async ({ dashboardPage: page }) => {
    await openDiagnosticsGistSection(page);

    await test.step('save a PAT through the settings UI', async () => {
      await page.locator('#githubPat').fill(VALID_PAT);
      await page.locator('#saveGistSettingsBtn').click();
      // The saved message is i18n-resolved; the success class is the locale-agnostic contract.
      await expect(page.locator('#gistStatus')).toHaveClass(/success/);
    });

    await test.step('test connection succeeds through CSP + host_permissions', async () => {
      await page.locator('#testGistConnectionBtn').click();
      // Literal message from GistSyncTarget.testConnection — not i18n.
      await expect(page.locator('#gistStatus')).toContainText('Connected to GitHub successfully');
      await expect(page.locator('#gistStatus')).toHaveClass(/success/);
    });
  });

  test('test connection with an invalid PAT shows the error status (fail-closed to the UI)', async ({ dashboardPage: page }) => {
    await openDiagnosticsGistSection(page);

    await page.locator('#githubPat').fill(INVALID_PAT);
    await page.locator('#saveGistSettingsBtn').click();
    await expect(page.locator('#gistStatus')).toHaveClass(/success/);

    await page.locator('#testGistConnectionBtn').click();
    await expect(page.locator('#gistStatus')).toContainText('Invalid GitHub PAT (unauthorized)');
    await expect(page.locator('#gistStatus')).toHaveClass(/error/);
  });

  test('blocks an undeclared origin through the document CSP', async ({ dashboardPage: page }) => {
    // The standard CSP reporting channel: the document's securitypolicyviolation
    // event fires when connect is blocked, with the effective directive and the
    // blocked URI. If the CSP were not enforcing, the fetch would instead fail
    // on the dead-port transport (127.0.0.1:9) with NO violation event — the
    // assertion below then fails, correctly reporting the regression.
    const result = await page.evaluate(
      () =>
        new Promise<{ blocked: boolean; directive: string; blockedUri: string }>((resolve) => {
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
          fetch('https://example.com/never').then(
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
    // Chrome reports the fallback target directive for connect-src fallback
    // blocks; assert loosely across the two spellings seen in the wild.
    expect(['connect-src', 'default-src']).toContain(result.directive);
  });
});
