import { test, expect } from './fixtures/popup.fixture';

test.describe('Popup - Domain Filter @ui', () => {
  test('Domain Filter Mode切替でlist表示が变化 (file)', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();

    await page.locator('#domainTab').click();
    await expect(page.locator('#domainPanel')).toBeVisible();

    await page.locator('#filterWhitelist').check();
    const whitelistSection = page.locator('#whitelistTextarea');
    await expect(whitelistSection).toBeAttached();

    await page.locator('#filterBlacklist').check();
    const blacklistSection = page.locator('#blacklistTextarea');
    await expect(blacklistSection).toBeAttached();
  });
});
