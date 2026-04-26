import { test, testInteraction, expect } from './fixtures/popup.fixture';

const testStatic = test;

testStatic.describe('Popup - Settings Flow @ui', () => {
  testStatic('Settings画面が表示される', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();
  });

  testStatic('全Tabが表示される', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#generalTab')).toBeVisible();
    await expect(page.locator('#domainTab')).toBeVisible();
    await expect(page.locator('#promptTab')).toBeVisible();
    await expect(page.locator('#privacyTab')).toBeVisible();
  });
});

testInteraction.describe('Popup - Settings Save Flow @interaction', () => {
  testInteraction('Protocol設定を保存后読み込み @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await page.fill('#protocol', 'https');
    await page.click('#save');
    await page.waitForTimeout(500);

    // Verify settings were saved using CDP - read from 'settings' object
    const storedSettings = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['settings'], (result) => {
          resolve(result.settings || {});
        });
      });
    });
    expect(storedSettings.obsidian_protocol).toBe('https');
  });

  testInteraction('Obsidian每日pathを保存后読み込み @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    const testPath = '/test/{{date}}/{{title}}';
    await page.fill('#dailyPath', testPath);
    await page.click('#save');
    await page.waitForTimeout(500);

    // Verify settings were saved using CDP - read from 'settings' object
    const storedSettings = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['settings'], (result) => {
          resolve(result.settings || {});
        });
      });
    });
    expect(storedSettings.obsidian_daily_path).toBe(testPath);
  });

  testInteraction('Min visit durationを保存后読み込み', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await page.fill('#minVisitDuration', '5000');
    await page.click('#save');
    await page.waitForTimeout(500);

    // Verify settings were saved using CDP - read from 'settings' object
    const storedSettings = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['settings'], (result) => {
          resolve(result.settings || {});
        });
      });
    });
    expect(storedSettings.min_visit_duration).toBe(5000);
  });

  testInteraction('Scroll depthを保存后読み込み', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await page.fill('#minScrollDepth', '75');
    await page.click('#save');
    await page.waitForTimeout(500);

    // Verify settings were saved using CDP - read from 'settings' object
    const storedSettings = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['settings'], (result) => {
          resolve(result.settings || {});
        });
      });
    });
    expect(storedSettings.min_scroll_depth).toBe(75);
  });
});

testInteraction.describe('Popup - Domain Filter Flow @interaction', () => {
  testInteraction('Domain Filter Mode切替でUIが变化 @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();

    // Whitelist mode - domain list section should be visible
    await page.check('input[value="whitelist"]');
    await expect(page.locator('#domainListSection')).toBeVisible();

    // Blacklist mode - domain list section should be visible
    await page.check('input[value="blacklist"]');
    await expect(page.locator('#domainListSection')).toBeVisible();

    // Disabled mode - domain list section should be hidden
    await page.check('input[value="disabled"]');
    await expect(page.locator('#domainListSection')).toBeHidden();
  });

  testInteraction('Whitelist domainsを保存后読み込み @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();

    await page.check('input[value="whitelist"]');
    const domains = 'example.com\ntest.com';
    await page.fill('#domainList', domains);
    await page.click('#saveDomainSettings');
    await page.waitForTimeout(500);

    // Verify settings were saved using CDP - read from 'settings' object
    const storedSettings = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['settings'], (result) => {
          const s = result.settings || {};
          resolve({
            domain_filter_mode: s.domain_filter_mode,
            domain_whitelist: s.domain_whitelist
          });
        });
      });
    });
    expect(storedSettings.domain_filter_mode).toBe('whitelist');
    expect(storedSettings.domain_whitelist).toEqual(['example.com', 'test.com']);
  });

  testInteraction('Blacklist domainsを保存后読み込み', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();

    await page.check('input[value="blacklist"]');
    const blockedDomains = 'blocked.com\nspam.com';
    await page.fill('#domainList', blockedDomains);
    await page.click('#saveDomainSettings');
    await page.waitForTimeout(500);

    // Verify settings were saved using CDP - read from 'settings' object
    const storedSettings = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['settings'], (result) => {
          const s = result.settings || {};
          resolve({
            domain_filter_mode: s.domain_filter_mode,
            domain_blacklist: s.domain_blacklist
          });
        });
      });
    });
    expect(storedSettings.domain_filter_mode).toBe('blacklist');
    expect(storedSettings.domain_blacklist).toEqual(['blocked.com', 'spam.com']);
  });
});

testInteraction.describe('Popup - Privacy Settings Flow @interaction', () => {
  testInteraction('Privacy Mode切替が動作', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#privacyTab').click();

    await page.check('#modeB');
    await expect(page.locator('#modeB')).toBeChecked();

    await page.check('#modeC');
    await expect(page.locator('#modeC')).toBeChecked();
  });
});

testInteraction.describe('Popup - Tab Navigation @interaction', () => {
  testInteraction('4つのTabが正しく表示切替 @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();

    const tabs = [
      { tab: '#generalTab', panel: '#generalPanel' },
      { tab: '#domainTab', panel: '#domainPanel' },
      { tab: '#promptTab', panel: '#promptPanel' },
      { tab: '#privacyTab', panel: '#privacyPanel' }
    ];

    for (const { tab, panel } of tabs) {
      await page.locator(tab).click();
      await expect(page.locator(panel)).toBeVisible();
    }
  });
});
