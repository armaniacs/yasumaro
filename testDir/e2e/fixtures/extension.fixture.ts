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

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', { timeout: 10000 }));
    await use(serviceWorker.url().split('/')[2]);
  },
});

export { expect } from '@playwright/test';
