/**
 * E2E: 設定パネル分類 UI (PBI 2026-10-31-08) @extension
 *
 * Real extension round-trip through the dashboard sidebar:
 *   select a category → only that category's tabs stay visible →
 *   click the target tab → its panel becomes active (BDD ハッピーパス).
 *
 * 境界値:
 * - 分類未割り当てパネル (panel-diagnostics) は「その他」分類で辿り着ける
 * - 分類名は chrome.i18n (data-i18n-opt) 経由でロケールどおりに解決される
 *
 * 可視化の待ちは expect の自動リトライ (expect.poll 相当) のみで、
 * 固定時間待ち (waitForTimeout) は挟まない。
 */
import { test, expect } from './fixtures/extension.fixture.js';
import { openOptionsPage } from './fixtures/dashboardSqliteHelpers.js';

test.describe('Panel category filter @extension', () => {
  // Pin the locale so chrome.i18n wording (data-i18n-opt options) is
  // deterministic (BDD 境界値: en ロケールでの分類名表示).
  test.use({ locale: 'en-US' });

  test('narrows the sidebar to the selected category and reaches the target panel', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);

    const filter = page.locator('#panelCategoryFilter');
    await expect(filter).toBeVisible();

    // Recording カテゴリを選ぶ: その分類のタブのみが残る。
    await filter.selectOption('recording');
    const visibleTabs = page.locator('#sidebar .sidebar-nav-btn[data-panel]:visible');
    await expect(visibleTabs).toHaveCount(4);
    await expect(page.locator('[data-panel="panel-recording-conditions"]')).toBeVisible();
    await expect(page.locator('[data-panel="panel-general"]')).toBeHidden();

    // 目的のパネルへ迷わず辿り着ける: タブを押すとパネルが表示される。
    await page.locator('[data-panel="panel-recording-conditions"]').click();
    await expect(page.locator('#panel-recording-conditions')).toHaveClass(/active/);
  });

  test('lands unassigned panels in Other (boundary)', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);

    const filter = page.locator('#panelCategoryFilter');
    await expect(filter).toBeVisible();

    await filter.selectOption('other');
    // 分類未割り当ての diagnostics のみが残る。
    const visibleTabs = page.locator('#sidebar .sidebar-nav-btn[data-panel]:visible');
    await expect(visibleTabs).toHaveCount(1);
    await expect(page.locator('[data-panel="panel-diagnostics"]')).toBeVisible();
  });

  test('resolves every category name via _locales/en (boundary)', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);

    const filter = page.locator('#panelCategoryFilter');
    await expect(filter).toBeVisible();

    // すべての option ラベルが生キー名ではなくロケールメッセージとして解決される。
    const labels = await filter.locator('option').allTextContents();
    expect(labels.length).toBeGreaterThanOrEqual(8);
    for (const label of labels) {
      expect(label.trim()).not.toBe('');
      expect(label.trim()).not.toMatch(/^panelCategory/);
    }
    // 代表分類の en 表示。
    await expect(filter.locator('option[value="recording"]')).toHaveText('Recording');
    await expect(filter.locator('option[value="other"]')).toHaveText('Other');
  });

  test('restores every tab when the filter returns to All', async ({ context, extensionId }) => {
    const page = await openOptionsPage(context, extensionId);

    const filter = page.locator('#panelCategoryFilter');
    await expect(filter).toBeVisible();

    const totalTabs = await page.locator('#sidebar .sidebar-nav-btn[data-panel]').count();
    await filter.selectOption('analysis');
    // フィルタ自身の責務は hidden 属性の付け外し (settings 子の既定の
    // 折りたたみはトグル規約が所有するため :visible ではなく :not([hidden])
    // で pin する)。
    const unhiddenTabs = page.locator('#sidebar .sidebar-nav-btn[data-panel]:not([hidden])');
    await expect(unhiddenTabs).toHaveCount(14);

    await filter.selectOption('all');
    await expect(unhiddenTabs).toHaveCount(totalTabs);
  });
});
