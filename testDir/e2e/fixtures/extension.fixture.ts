import { test as base, chromium, BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// WXT outputs to dist/<browser>-mv3/ directory
const EXTENSION_PATH = path.join(__dirname, '../../../dist/chromium-mv3');

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
};

/**
 * Attempt to launch a persistent Chrome context with the extension loaded.
 * The `@extension` tag tests require headed mode because Manifest V3
 * service workers are not supported in headless Chromium.
 *
 * On headless environments (CI, SSH, background processes) these tests
 * will gracefully skip with test.fixme().
 *
 * @returns {Promise<BrowserContext | null>} The browser context, or null if
 *   the environment does not support extension testing.
 */
async function tryLaunchExtensionContext(): Promise<BrowserContext | null> {
  try {
    // First try with the system Chrome (has full extension support)
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
        // PBI 2026-09-22-04 (regenerate e2e): extension-created tabs lose the
        // Playwright interception attach race on their MAIN document request
        // (context.route/page.route never see it → chrome-error page → no
        // content script → GET_CONTENT "receiving end"). Map the fixture host
        // to the spec's local TLS server instead, so tabs.create navigation
        // resolves locally without interception. Only api.openai.com:443 is
        // remapped (no other spec uses that origin); --ignore-certificate-
        // errors only matters for TLS and every other spec talks plain
        // http://localhost.
        '--host-resolver-rules=MAP api.openai.com:443 127.0.0.1:8443',
        '--ignore-certificate-errors',
      ],
      // MV3 extension service workers must be allowed to run — without this
      // the DASHBOARD_SQLITE handler in the SW never wakes and messages time
      // out (E2E blocker resolved 2026-09-06).
      serviceWorkers: 'allow',
      acceptDownloads: true,
    });

    // Wait briefly for the extension service worker to register
    const sw = await Promise.race([
      new Promise<boolean>((resolve) => {
        const check = () => {
          if (context.serviceWorkers().length > 0) {
            resolve(true);
          } else {
            setTimeout(check, 200);
          }
        };
        check();
      }),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 5000),
      ),
    ]);

    if (sw) return context;

    // Extension SW did not start — headed mode needed.
    await context.close();
    return null;
  } catch {
    // Failed to launch — likely headless environment.
    return null;
  }
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const context = await tryLaunchExtensionContext();
    if (!context) {
      test.fixme(true, 'Extension tests require headed Chrome (Manifest V3 service workers unsupported in headless)');
      return;
    }
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    if (!context) return;
    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', { timeout: 10000 }));
    await use(serviceWorker.url().split('/')[2] ?? '');
  },
});

export { expect } from '@playwright/test';
