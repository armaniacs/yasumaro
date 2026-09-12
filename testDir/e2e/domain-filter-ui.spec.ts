import { test, expect } from './fixtures/extension.fixture.js';

test.describe('domain filter UI @extension', () => {
  test('new tag UI is visible and old UI is not duplicated', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

    // ドメインフィルターパネルを開く（サイドバーまたは直接表示）
    // 新 UI のタブバーが可視であることを確認
    const tabBar = page.locator('#domainModeTabBar');
    // 初期は hidden だが、フィルター有効時に表示される。まずトグルを有効化
    const toggle = page.locator('#domainFilterToggle');
    if (await toggle.isVisible()) {
      const isChecked = await toggle.isChecked();
      if (!isChecked) await toggle.click();
    }
    await expect(tabBar).toBeVisible({ timeout: 5000 });

    // 新 UI の保存ボタンは1つのみ可視でテキストが空でない
    const saveBtn = page.locator('#domainSaveBtn');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).not.toBeEmpty();

    // 旧 UI の空ボタンは hidden のまま（CSS の [hidden] が勝つ）
    const oldSaveBtn = page.locator('#saveDomainSettings');
    await expect(oldSaveBtn).toBeHidden();

    // 旧 textarea セクションは表示されない（新タグ UI と二重にならない）
    const oldListSection = page.locator('#domainListSection');
    await expect(oldListSection).toBeHidden();

    // タグリストは表示される（15件の例では少なくとも1件）
    const tagList = page.locator('#domainTagList');
    await expect(tagList).toBeVisible();
  });

  test('no empty purple button is visible on the page', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');

    // 全ての .btn-primary のうち、hidden でなく空文字のものが存在しないこと
    const emptyPrimaryButtons = page.locator('button.btn-primary').filter({
      hasNot: page.locator('[hidden]'),
    });
    // 可視なプライマリボタンはテキストを持つ
    const count = await emptyPrimaryButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = emptyPrimaryButtons.nth(i);
      if (await btn.isVisible()) {
        const text = (await btn.textContent())?.trim() ?? '';
        expect(text.length, `button#${await btn.getAttribute('id')} should have text`).toBeGreaterThan(0);
      }
    }

    // 特に旧保存ボタンは hidden
    await expect(page.locator('#saveDomainSettings')).toBeHidden();
  });
});
