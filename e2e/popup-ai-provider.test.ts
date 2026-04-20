import { test as staticTest, testInteraction, expect } from './fixtures/popup.fixture';

const test = staticTest;

test.describe('Popup - AI Provider Settings @ui', () => {
  test('AI Provider選択に従って対応するsettings panelが表示される (file)', async ({ popupPage: page }) => {
    await test.step('デフォルトはGemini panelが表示', async () => {
      await expect(page.locator('#geminiSettings')).toBeAttached();
    });
  });
});

testInteraction.describe('Popup - AI Provider Settings @interaction', () => {
  testInteraction('AI Provider選択に従って対応するsettings panelが表示される @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();

    await page.locator('#generalTab').click();
    await expect(page.locator('#generalPanel')).toBeVisible();

    await test.step('デフォルトはGemini panelが表示', async () => {
      await expect(page.locator('#geminiSettings')).toBeVisible();
    });

    await test.step('OpenAIに切替えるとGemini panelが非表示', async () => {
      await page.selectOption('#aiProvider', 'openai');
      await expect(page.locator('#geminiSettings')).toBeHidden();
    });

    await test.step('OpenAIに切替えるとOpenAI panelが表示', async () => {
      await expect(page.locator('#openaiSettings')).toBeVisible();
    });

    await test.step('Geminiに戻す', async () => {
      await page.selectOption('#aiProvider', 'gemini');
      await expect(page.locator('#openaiSettings')).toBeHidden();
      await expect(page.locator('#geminiSettings')).toBeVisible();
    });
  });

  testInteraction('AI Provider選択値は保持される @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();
    await page.locator('#generalTab').click();
    await expect(page.locator('#generalPanel')).toBeVisible();

    await test.step('OpenAI 2を選択', async () => {
      await page.selectOption('#aiProvider', 'openai2');
    });

    await test.step('値が選択されていることを確認', async () => {
      const selected = await page.locator('#aiProvider').evaluate(
        (el) => (el as HTMLSelectElement).value
      );
      expect(selected).toBe('openai2');
    });

    await test.step('保存ボタンをクリック', async () => {
      await page.locator('#save').click();
      // Wait for save to complete (connection test may take time, but we only care about storage)
      // The settings are saved quickly; we can wait for network idle or just a short delay
      await page.waitForTimeout(200);
    });

    await test.step('ポップアップをリロード', async () => {
      await page.reload();
      // After reload, wait for popup to be ready
      await expect(page.locator('#menuBtn')).toBeAttached();
    });

    await test.step('設定画面を再度開く', async () => {
      await page.locator('#menuBtn').click();
      await expect(page.locator('#settingsScreen')).toBeVisible();
      await page.locator('#generalTab').click();
      await expect(page.locator('#generalPanel')).toBeVisible();
    });

    await test.step('リロード後も選択値が保持されていることを確認', async () => {
      const selectedAfterReload = await page.locator('#aiProvider').evaluate(
        (el) => (el as HTMLSelectElement).value
      );
      expect(selectedAfterReload).toBe('openai2');
    });
  });

  testInteraction('port設定を保存后又正常読み込み @critical', async ({ popupPage: page }) => {
    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();
    await page.locator('#generalTab').click();
    await expect(page.locator('#generalPanel')).toBeVisible();

    await page.fill('#port', '9999');
    await page.click('#save');

    await page.reload();
    await expect(page.locator('#menuBtn')).toBeAttached();

    await page.locator('#menuBtn').click();
    await expect(page.locator('#settingsScreen')).toBeVisible();
    await page.locator('#generalTab').click();
    await expect(page.locator('#generalPanel')).toBeVisible();

    await expect(page.locator('#port')).toHaveValue('9999');
  });
});