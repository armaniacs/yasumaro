import { test as base, expect, Page } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const POPUP_PATH = join(__dirname, '../../dist/popup/popup.html');

type PopupFixtures = {
  popupPage: Page;
};

export const test = base.extend<PopupFixtures>({
  popupPage: async ({ page }, use) => {
    await page.goto(`file://${POPUP_PATH}`);
    await use(page);
  },
});

export { expect };
