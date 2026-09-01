import { test, expect } from '@playwright/test';
import { testInteraction, expect as expectExt } from './fixtures/dashboard.fixture.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPTIONS_PATH = path.join(__dirname, '../../dist/chromium-mv3/options.html');

/**
 * Built-in AI Provider UI テスト (PBI-32 / PBI-06c)
 *
 * 対象: dist/chromium-mv3/options.html
 * プロトコル: file:// (静的HTML)
 *
 * PBI-06c 以降、provider の <option> リストと per-provider 設定ブロックは
 * catalog から panel mount 時に JS で構築される（静的 HTML には
 * <select> シェルと #providerSettingsMount のみ）。file:// では拡張機能
 * ランタイムが無く panel が mount されないため、@ui では構築先の存在だけを
 * 確認し、実際の option/panel は @interaction（拡張機能コンテキスト）で検証する。
 */
test.describe('Dashboard - Built-in AI Provider Option @ui', () => {
  test('provider select shells and settings mount point exist', async ({ page }) => {
    await page.goto(`file://${OPTIONS_PATH}`);

    await expect(page.locator('#aiProvider')).toBeAttached();
    await expect(page.locator('#aiProviderPriority2')).toBeAttached();
    await expect(page.locator('#aiProviderPriority3')).toBeAttached();
    await expect(page.locator('#providerSettingsMount')).toBeAttached();
  });
});

/**
 * 実際の拡張機能コンテキストでの動作確認 (PBI-32 受け入れ基準)
 *
 * - Built-in AI 選択時、API キー入力欄が非表示になる (BDD シナリオ1)
 * - ダッシュボードから Built-in AI が選択可能 (BDD シナリオ1)
 *
 * NOTE: Manifest V3 service worker はヘッドレス Chromium で起動しないため、
 * この describe ブロックは headed mode でのみ実行される。ヘッドレス環境
 * (CI 等) では Playwright がタイムアウトしフィクスチャがエラーになるため、
 * ローカルの headed 実行または実機確認手順（本ファイル冒頭のコメント参照）
 * で検証すること。
 */
test.describe('Dashboard - Built-in AI Provider Selection @interaction', () => {
  testInteraction('selecting built-in-ai hides Gemini API key input and shows built-in-ai panel', async ({ dashboardPage: page }) => {
    const aiProviderSelect = page.locator('#aiProvider');
    await aiProviderSelect.selectOption('built-in-ai');

    await expectExt(page.locator('#geminiSettings')).toBeHidden();
    await expectExt(page.locator('#built-in-aiSettings')).toBeVisible();
  });

  testInteraction('built-in-ai panel does not request an API key', async ({ dashboardPage: page }) => {
    const aiProviderSelect = page.locator('#aiProvider');
    await aiProviderSelect.selectOption('built-in-ai');

    const apiKeyInputsInPanel = page.locator('#built-in-aiSettings input[type="password"]');
    await expectExt(apiKeyInputsInPanel).toHaveCount(0);
  });

  testInteraction('switching back to gemini restores the API key input', async ({ dashboardPage: page }) => {
    const aiProviderSelect = page.locator('#aiProvider');
    await aiProviderSelect.selectOption('built-in-ai');
    await expectExt(page.locator('#built-in-aiSettings')).toBeVisible();

    await aiProviderSelect.selectOption('gemini');
    await expectExt(page.locator('#geminiSettings')).toBeVisible();
    await expectExt(page.locator('#built-in-aiSettings')).toBeHidden();
  });
});
