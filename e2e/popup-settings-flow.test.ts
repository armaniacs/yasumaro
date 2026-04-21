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

    await page.selectOption('#protocol', 'https');
    await page.click('#save');
    await page.waitForTimeout(200);

    await page.reload();
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await expect(page.locator('#protocol')).toHaveValue('https');
  });

  testInteraction('Obsidian每日pathを保存后読み込み @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    const testPath = '/test/{{date}}/{{title}}';
    await page.fill('#dailyPath', testPath);
    await page.click('#save');
    await page.waitForTimeout(200);

    await page.reload();
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await expect(page.locator('#dailyPath')).toHaveValue(testPath);
  });

  testInteraction('Min visit durationを保存后読み込み', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await page.fill('#minVisitDuration', '5000');
    await page.click('#save');
    await page.waitForTimeout(200);

    await page.reload();
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await expect(page.locator('#minVisitDuration')).toHaveValue('5000');
  });

  testInteraction('Scroll depthを保存后読み込み', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await page.fill('#minScrollDepth', '75');
    await page.click('#save');
    await page.waitForTimeout(200);

    await page.reload();
    await page.locator('#menuBtn').click();
    await page.locator('#generalTab').click();

    await expect(page.locator('#minScrollDepth')).toHaveValue('75');
  });
});

testInteraction.describe('Popup - Domain Filter Flow @interaction', () => {
  testInteraction('Domain Filter Mode切替でUIが变化 @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();

    // Whitelist mode
    await page.check('input[value="whitelist"]');
    await expect(page.locator('#whitelistTextarea')).toBeVisible();

    // Blacklist mode
    await page.check('input[value="blacklist"]');
    await expect(page.locator('#blacklistTextarea')).toBeVisible();

    // Disabled mode
    await page.check('input[value="disabled"]');
    await expect(page.locator('#whitelistTextarea')).toBeHidden();
    await expect(page.locator('#blacklistTextarea')).toBeHidden();
  });

  testInteraction('Whitelist domainsを保存后読み込み @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();

    await page.check('input[value="whitelist"]');
    const domains = 'example.com\ntest.com';
    await page.fill('#whitelistTextarea', domains);
    await page.click('#save');
    await page.waitForTimeout(200);

    await page.reload();
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();

    await expect(page.locator('#whitelistTextarea')).toHaveValue(domains);
  });

  testInteraction('Blacklist domainsを保存后読み込み', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();

    await page.check('input[value="blacklist"]');
    const blockedDomains = 'blocked.com\nspam.com';
    await page.fill('#blacklistTextarea', blockedDomains);
    await page.click('#save');
    await page.waitForTimeout(200);

    await page.reload();
    await page.locator('#menuBtn').click();
    await page.locator('#domainTab').click();

    await expect(page.locator('#blacklistTextarea')).toHaveValue(blockedDomains);
  });
});

testInteraction.describe('Popup - Privacy Settings Flow @interaction', () => {
  testInteraction('Privacy Mode切替が動作', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#privacyTab').click();

    await page.selectOption('select[name="privacyMode"]', 'full_pipeline');
    await expect(page.locator('select[name="privacyMode"]')).toHaveValue('full_pipeline');

    await page.selectOption('select[name="privacyMode"]', 'masked_cloud');
    await expect(page.locator('select[name="privacyMode"]')).toHaveValue('masked_cloud');
  });

  testInteraction('PII confirmation設定を保存后読み込み', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#privacyTab').click();

    await page.uncheck('input[name="piiConfirmation"]');
    await page.click('#save');
    await page.waitForTimeout(200);

    await page.reload();
    await page.locator('#menuBtn').click();
    await page.locator('#privacyTab').click();

    await expect(page.locator('input[name="piiConfirmation"]')).not.toBeChecked();
  });

  testInteraction('PII sanitize logs設定を保存后読み込み', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await page.locator('#privacyTab').click();

    await page.uncheck('input[name="piiSanitizeLogs"]');
    await page.click('#save');
    await page.waitForTimeout(200);

    await page.reload();
    await page.locator('#menuBtn').click();
    await page.locator('#privacyTab').click();

    await expect(page.locator('input[name="piiSanitizeLogs"]')).not.toBeChecked();
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