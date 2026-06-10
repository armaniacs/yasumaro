import { test, expect } from './fixtures/popup.fixture';

test.describe('Popup - Tab Navigation @ui', () => {
  test('4つのTab正确に表示切替 (file)', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();

    const tabs = ['#generalTab', '#domainTab', '#promptTab', '#privacyTab'];
    const panels = ['#generalPanel', '#domainPanel', '#promptPanel', '#privacyPanel'];

    for (let i = 0; i < tabs.length; i++) {
      await page.locator(tabs[i]).click();
      await expect(page.locator(panels[i])).toBeVisible();
    }
  });
});
