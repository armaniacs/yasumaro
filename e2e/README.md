# Playwright E2E Testing Guide / Playwright E2Eテストガイド

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

このプロジェクトでは、Playwrightを使用してエンドツーエンド（E2E）テストを実行します。E2Eテストは、拡張機能のポップアップUIやコンテンツスクリプトの統合テストに使用されます。

### 前提条件

- Node.js (LTS推奨)
- プロジェクトの依存関係がインストールされている (`npm install`)

### セットアップ

Playwrightブラウザは既にインストールされています。追加のセットアップは不要です。

### テストの実行

```bash
# E2Eテストを実行（ヘッドレスモード）
npm run test:e2e

# UIモードで実行（インタラクティブなテスト実行）
npm run test:e2e:ui

# デバッグモードで実行
npm run test:e2e:debug

# ヘッドフルモードで実行（ブラウザを表示）
npm run test:e2e:headed
```

### テストファイルの構造

```
e2e/
├── extension.spec.ts    # 拡張機能のメインE2Eテスト
└── ...                  # 追加のE2Eテストファイル
```

### テストの書き方

PlaywrightテストはTypeScriptで記述します。基本的なテストの例：

```typescript
import { test, expect } from '@playwright/test';

test.describe('Extension Popup UI', () => {
  test.beforeEach(async ({ page }) => {
    // 各テストの前に実行されるセットアップ
    await page.goto('file://' + __dirname + '/../dist/popup/popup.html');
  });

  test('should display the popup title', async ({ page }) => {
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('should switch between tabs', async ({ page }) => {
    const firstTab = page.locator('[data-testid="nav-tabs"] button').first();
    await firstTab.click();
    
    await expect(firstTab).toHaveClass(/active/);
  });
});
```

### テストのベストプラクティス

1. **データ属性を使用**: テスト対象の要素には `data-testid` 属性を付与してください
   ```html
   <button data-testid="submit-button">Submit</button>
   ```

2. **明確なテスト名**: テスト名は何をテストしているかを明確に記述してください

3. **待機を適切に使用**: Playwrightは自動的に待機しますが、必要に応じて `waitFor` を使用してください

4. **テストの独立性**: 各テストは独立して実行できるようにしてください

5. **再現性**: テストは毎回同じ結果を返すようにしてください

### Chrome拡張機能のテスト

Chrome拡張機能のE2Eテストには特別なセットアップが必要です。現在のテストはビルドされたHTMLファイルを直接読み込んでいますが、実際の拡張機能をテストするには：

1. 拡張機能をChromeにロード
2. 拡張機能のIDを取得
3. `chrome-extension://<extension-id>/popup/popup.html` にナビゲート

### トラブルシューティング

**テストが失敗する場合:**
1. ビルドが最新であることを確認: `npm run build`
2. ブラウザが正しくインストールされていることを確認: `npx playwright install chromium`
3. テストのタイムアウトを確認: `playwright.config.ts` の設定を確認

**UIモードが起動しない場合:**
1. Playwrightのバージョンを確認: `npx playwright --version`
2. 依存関係を再インストール: `npm install`

### リソース

- [Playwright公式ドキュメント](https://playwright.dev/)
- [Playwright TypeScriptサポート](https://playwright.dev/docs/test-typescript)
- [Playwrightベストプラクティス](https://playwright.dev/docs/best-practices)

---

## English

### Overview

This project uses Playwright for end-to-end (E2E) testing. E2E tests are used to test the extension's popup UI and content script integration.

### Prerequisites

- Node.js (LTS recommended)
- Project dependencies installed (`npm install`)

### Setup

Playwright browsers are already installed. No additional setup is required.

### Running Tests

```bash
# Run E2E tests (headless mode)
npm run test:e2e

# Run in UI mode (interactive test execution)
npm run test:e2e:ui

# Run in debug mode
npm run test:e2e:debug

# Run in headed mode (show browser)
npm run test:e2e:headed
```

### Test File Structure

```
e2e/
├── extension.spec.ts    # Main extension E2E tests
└── ...                  # Additional E2E test files
```

### Writing Tests

Playwright tests are written in TypeScript. Basic test example:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Extension Popup UI', () => {
  test.beforeEach(async ({ page }) => {
    // Setup before each test
    await page.goto('file://' + __dirname + '/../dist/popup/popup.html');
  });

  test('should display the popup title', async ({ page }) => {
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('should switch between tabs', async ({ page }) => {
    const firstTab = page.locator('[data-testid="nav-tabs"] button').first();
    await firstTab.click();
    
    await expect(firstTab).toHaveClass(/active/);
  });
});
```

### Testing Best Practices

1. **Use data attributes**: Add `data-testid` attributes to test elements
   ```html
   <button data-testid="submit-button">Submit</button>
   ```

2. **Clear test names**: Test names should clearly describe what is being tested

3. **Use waits appropriately**: Playwright auto-waits, but use `waitFor` when needed

4. **Test independence**: Each test should be able to run independently

5. **Reproducibility**: Tests should return the same results every time

### Testing Chrome Extensions

Testing Chrome extensions requires special setup. Current tests load built HTML files directly, but to test the actual extension:

1. Load the extension in Chrome
2. Get the extension ID
3. Navigate to `chrome-extension://<extension-id>/popup/popup.html`

### Troubleshooting

**If tests fail:**
1. Ensure build is up to date: `npm run build`
2. Verify browser is installed: `npx playwright install chromium`
3. Check test timeout: Review `playwright.config.ts` settings

**If UI mode doesn't start:**
1. Check Playwright version: `npx playwright --version`
2. Reinstall dependencies: `npm install`

### Resources

- [Playwright Official Documentation](https://playwright.dev/)
- [Playwright TypeScript Support](https://playwright.dev/docs/test-typescript)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)