# PBI: E2Eテストへのアクセシビリティ（axe-core）チェック導入

## ユーザーストーリー
アクセシビリティエンジニアとして、CI パイプラインで自動アクセシビリティチェックを実行したい、なぜなら WCAG 違反の回帰をリリース前に検出し、すべてのユーザーが拡張機能を利用できることを保証したいから。

## ビジネス価値
- WCAG 2.1 Level AA 準拠の継続的保証
- アクセシビリティ回帰の早期発見による修正コスト削減
- インクルーシブデザインの文化醸成
- ユーザー層の拡大（障害を持つユーザーも安心して利用可能）

## 現状
- 現在の E2E テスト（`tests.yml`）は `@extension` タグで機能テストのみ実行
- アクセシビリティ検証は一切行われていない
- `@axe-core/playwright` パッケージは未導入

## BDD 受け入れシナリオ

```gherkin
Scenario: CI でアクセシビリティチェックが実行される
  Given `@axe-core/playwright` がインストールされている
  And   E2E テストに `@a11y` タグが追加されている
  When  CI で `npx playwright test --grep @a11y` が実行される
  Then  全ポップアップ画面とオプション画面で axe-core チェックが行われる
  And   WCAG 違反が0件であることが確認される

Scenario: アクセシビリティ違反が検出された場合
  Given ある画面に WCAG 違反が存在する
  When  CI でアクセシビリティテストが実行される
  Then  テストが失敗する
  And   違反の詳細（影響する要素、ガイドライン、修正方法）がレポートに出力される
  And   Playwright レポートのアーティファクトに違反情報が含まれる

Scenario: テストが並列実行される
  Given `@extension` テストと `@a11y` テストの両方が存在する
  When  CI が起動する
  Then  両方のテストが並行して実行される
  And   どちらかのテストが失敗してももう一方の結果が保存される
```

## 受け入れ基準
- [ ] `@axe-core/playwright` が devDependencies に追加されている
- [ ] ポップアップ画面の主要ビューに対する axe-core テストが実装されている
- [ ] `@a11y` タグでフィルタリング可能である
- [ ] CI の `tests.yml` に `--grep @a11y` のジョブが追加されている
- [ ]  axe-core 違反が検出された場合、CI が失敗する
- [ ] Playwright レポートにアクセシビリティ違反の詳細が含まれる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- `e2e/a11y.spec.ts` - axe-core を使ったアクセシビリティテスト
- テスト対象画面: ポップアップ（デフォルト状態、設定状態）、ダッシュボード
- 各画面で `await injectAxe()` + `await checkA11y()` を実行

### 統合テスト
- axe-core のルール設定の検証（どの WCAG レベルをチェックするか）

### 単体テスト
- N/A（E2E テストフレームワークの拡張）

## 実装アプローチ
- **Outside-In**: アクセシビリティテストを作成 → CI で実行 → 既存の違反を修正するサイクル
- 最初は `wcag2a` + `wcag2aa` ルールセットから開始し、段階的にルールを追加

## 見積もり
5〜8ストーリーポイント（新規パッケージ導入 + テストコード + 既存違反の修正）

## 技術的考慮事項
- 依存関係: `@axe-core/playwright`（npm パッケージ）
- テスタビリティ: axe-core は主要ブラウザ（Chromium）でサポート済み
- リスク: 既存のアクセシビリティ違反がどの程度あるか未調査。初回実行で大量の違反が検出される可能性があり、その場合は段階的な修正計画（別 PBI）に切り出す必要がある

## 実装者向け注記

### 現状コードの確認
```bash
# 既存の E2E テスト構造を確認
ls e2e/
# テスト設定を確認
cat playwright.config.ts
```

### 実装手順
1. `@axe-core/playwright` をインストール
   ```bash
   npm install --save-dev @axe-core/playwright
   ```
2. `e2e/a11y.spec.ts` を作成
   ```typescript
   import { test, expect } from '@playwright/test';
   import { injectAxe, checkA11y } from 'axe-playwright';

   test.describe('Accessibility checks', () => {
     test('popup should have no WCAG violations', async ({ page }) => {
       await page.goto('chrome-extension://<extension-id>/popup/popup.html');
       await injectAxe(page);
       await checkA11y(page, null, {
         detailedReport: true,
         detailedReportOptions: { html: true },
       });
     });
   });
   ```
3. `playwright.config.ts` のプロジェクト設定に `@a11y` タグを追加
4. CI の `tests.yml` に `@a11y` ジョブを追加
5. テストを実行し、既存の違反を特定
6. 特定された違反を修正（または別 PBI として起票）

### テストコードの配置
```
e2e/
  extension.spec.ts    # 既存の機能 E2E テスト
  a11y.spec.ts         # アクセシビリティテスト（新規）
```

### CI ジョブ追加例
```yaml
  a11y:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '24', cache: 'npm' }
      - run: npm ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - name: Accessibility checks
        run: npx playwright test --grep @a11y
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-a11y-report
          path: playwright-report/
          retention-days: 7
```

### 落とし穴
- 拡張機能のページ（`chrome-extension://` URL）へのアクセスはテスト環境によって制限される。`playwright.config.ts` で適切な権限設定が必要
- 初回実行時に想定以上の違反が検出された場合、**この PBI のスコープは axe-core 導入とテスト実装まで**とし、違反修正は別 PBI に切り出す判断をしてよい

## Definition of Done
- [ ] `@axe-core/playwright` がインストールされている
- [ ] ポップアップ画面のアクセシビリティテストが実装されている
- [ ] テストが `@a11y` タグでフィルタリング可能である
- [ ] CI でアクセシビリティテストが実行される
- [ ] アクセシビリティ違反が検出された場合 CI が失敗する
- [ ] npm test がパスする
- [ ] コードレビュー完了
