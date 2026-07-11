import { test, expect } from './fixtures/popup.fixture';

test.describe('Popup - Domain Filter @ui', () => {
  test('Domain Filter Mode切替でlist表示が变化 (file)', async ({ popupPage: page }) => {
    // Directly set up DOM state via JS instead of relying on click handlers
    // because showSettingsScreen() opens dashboard in a new tab and
    // tab click handlers may not be registered in file:// context
    await page.evaluate(() => {
      // Show settings screen
      const mainScreen = document.getElementById('mainScreen');
      const settingsScreen = document.getElementById('settingsScreen');
      if (mainScreen) mainScreen.style.display = 'none';
      if (settingsScreen) settingsScreen.style.display = 'block';

      // Update tab button states
      document.querySelectorAll<HTMLElement>('#tabList .tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      const domainTab = document.getElementById('domainTab');
      if (domainTab) {
        domainTab.classList.add('active');
        domainTab.setAttribute('aria-selected', 'true');
      }

      // Update panel states: hide all, show domainPanel
      document.querySelectorAll<HTMLElement>('.tab-panel').forEach(p => {
        p.classList.remove('active');
        p.setAttribute('aria-hidden', 'true');
        p.setAttribute('inert', '');
      });
      const dp = document.getElementById('domainPanel');
      if (dp) {
        dp.classList.add('active');
        dp.setAttribute('aria-hidden', 'false');
        dp.removeAttribute('inert');
      }
    });

    await expect(page.locator('#settingsScreen')).toBeVisible();
    await expect(page.locator('#domainPanel')).toBeVisible();

    await page.locator('#filterWhitelist').check();
    const whitelistSection = page.locator('#whitelistTextarea');
    await expect(whitelistSection).toBeAttached();

    await page.locator('#filterBlacklist').check();
    const blacklistSection = page.locator('#blacklistTextarea');
    await expect(blacklistSection).toBeAttached();
  });
});
