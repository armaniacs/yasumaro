import { test as staticTest, testInteraction, expect } from './fixtures/popup.fixture.js';

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
  });
});