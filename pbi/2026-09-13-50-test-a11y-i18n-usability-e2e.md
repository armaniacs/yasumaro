# PBI: アクセシビリティ・i18n表示崩れのユーザビリティE2Eテストを追加

## ユーザーストーリー
拡張機能の開発者として、キーボードのみで主要タスクを完了できること、およびja/en切り替え時にレイアウト崩れや文言欠落が起きないことを自動テストで保証したい。なぜなら、スクリーンリーダー利用者やキーボード操作ユーザー、英語UIを使う海外ユーザーが取り残されないようにしたいから。

## 優先度
- 順位: 05 / 8
- RICEスコア: 11.2（Reach=8 × Impact=2 × Confidence=0.7 / Effort=1.0人日）
- 根拠: PBI 49と同点。既存の`a11y.spec.ts`（axe-core）と`release-checks/check-i18n.mjs`という土台が既にあり、実装確信度が高い。依存関係がなく独立して着手できる。

## ステータス: 🔶 部分実装（残り作業は下記「未達分の実装ガイド」のみ）

コミット `8dc253b3` で大部分が実装済み。**残っているのは受け入れ基準1件だけ**:

> - [ ] 主要タスク（設定変更、**記録開始**、**検索**）がキーボードのみで完了できることを検証している

`testDir/e2e/usability/a11y-usability.spec.ts` には「設定変更」のキーボード操作テストのみが存在し（`'user can reach and activate a settings change using only the keyboard'`）、「記録開始」「検索」の2タスクが未実装。

---

## 未達分の実装ガイド（調査済み・そのまま着手可）

### 追加先ファイル

`testDir/e2e/usability/a11y-usability.spec.ts` の `test.describe('Dashboard accessibility @extension', ...)` ブロック内に2件追加する。既存の import（`testInteraction as test`、`expect`）がそのまま使える。

### タスク2: 「検索」のキーボード操作

検索UIは **dashboard 側**（`panel-sqlite-history`）にある。データのseedが必要なため、`dashboard-search-results.spec.ts` のパターンをそのまま流用する。

必要な追加 import（同ファイル冒頭に追記）:
```typescript
import { createDashboardSqliteClient, migrationSettled, seedRows } from '../fixtures/dashboardSqliteHelpers.js';
```

テスト本体:
```typescript
  test('user can run a search using only the keyboard', async ({ dashboardPage: page }) => {
    const client = createDashboardSqliteClient(page);
    await migrationSettled(page, client);
    const clearToken = await client.tokenFor('clear_all', []);
    await client.dashboardMsg({ subtype: 'clear_all', confirmToken: clearToken });
    await seedRows(client, [
      { url: 'https://example.com/a', title: '筑波大学の入試について', summary: '筑波大学の入試情報', tags: null, created_at: Date.UTC(2026, 8, 1), domain: 'example.com' },
      { url: 'https://example.com/b', title: 'プリンターレンタル比較', summary: 'プリンターの選び方', tags: null, created_at: Date.UTC(2026, 8, 1) + 1000, domain: 'example.com' },
    ]);

    // パネル遷移をキーボードで行う（クリックを使わない）
    const historyTab = page.locator('button[data-panel="panel-sqlite-history"]');
    await historyTab.focus();
    await page.keyboard.press('Enter');

    const searchInput = page.locator('#sqlite-search-input');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // 検索欄までキーボードで到達できることが本質。focus() で当てられること＋
    // keyboard.type で入力できることの両方を確認する。
    await searchInput.focus();
    await expect(searchInput).toBeFocused();
    await page.keyboard.type('筑波大学');

    await expect(page.locator('#sqlite-entry-list .sqlite-entry')).toHaveCount(1, { timeout: 15000 });
  });
```

**注意**: `fill()` ではなく `keyboard.type()` を使うこと。`fill()` はDOM値を直接設定するためキーボード操作の検証にならない。

### タスク3: 「記録開始」のキーボード操作

記録開始ボタン（`#recordBtn`）は **popup 側**にあり、dashboard fixture では到達できない。`popup-record-flow.spec.ts` が使っている `cleansing-preview.fixture.js` が必要。

**dashboard fixture と popup fixture は同一ファイル内で混在させられない**ため、別ファイルに切り出すのが最も素直:

新規ファイル `testDir/e2e/usability/popup-a11y-keyboard.spec.ts`:
```typescript
/**
 * popup-a11y-keyboard.spec.ts (PBI 2026-09-13-50 の残タスク)
 *
 * Keyboard-only completion of the "start recording" task. Lives apart from
 * a11y-usability.spec.ts because the record button is in the popup, which
 * needs the cleansing-preview fixture rather than the dashboard fixture.
 */
import { test, MASKED_CONTENT } from '../fixtures/cleansing-preview.fixture.js';
import { expect } from '@playwright/test';

if (!process.env.CI && !process.env.DISPLAY) {
  test.skip(true, 'requires headed Chrome with display');
}

test.describe('Popup keyboard-only recording @extension', () => {
  test('user can start recording using only the keyboard', async ({ previewPage: page }) => {
    const recordBtn = page.locator('#recordBtn');
    await recordBtn.focus();
    await expect(recordBtn).toBeFocused();
    await page.keyboard.press('Enter');

    const modal = page.locator('#confirmationModal');
    await expect(modal).toHaveJSProperty('open', true, { timeout: 15000 });
  });
});
```

`MASKED_CONTENT` を使わないなら import から外すこと（lint が未使用 import を警告する）。モーダル到達後の確定操作まで検証したい場合は `popup-record-flow.spec.ts:20-40` の続きを参照する。

**headless スキップガードは必須**。`popup-record-flow.spec.ts:10-12` と同じ形（`!process.env.CI && !process.env.DISPLAY`）にすること。これがないとローカルのheadless実行で落ちる。

### 検証コマンド

```bash
npm run build                 # dist/chromium-mv3 が無いと extensionId 取得でタイムアウトする
npx playwright test --config testDir/playwright.config.ts --project=usability testDir/e2e/usability/a11y-usability.spec.ts
npx playwright test --config testDir/playwright.config.ts --project=usability testDir/e2e/usability/popup-a11y-keyboard.spec.ts
npm run test:e2e:usability    # 全体（他specとの干渉がないことの確認）
```

**重要**: E2Eを並列のworktreeで同時実行するとChrome for Testingのリソース競合で `browserContext.waitForEvent: Target page, context or browser has been closed` が出る（PBI 48 で実際に発生した）。単独実行で検証すること。

### 既に実装済み（触らなくてよい）

- `a11y-usability.spec.ts` の axe-core WCAG AAスキャン3パネル分
- `a11y-usability.spec.ts` の `'sidebar tabs are keyboard-focusable in document order'`
- `a11y-usability.spec.ts` の「設定変更」キーボード操作テスト
- `i18n-layout.spec.ts` 全体（オーバーフロー検知・i18nキー露出検知）

---

## BDD受け入れシナリオ

```gherkin
Scenario: 主要タスクをキーボードのみで完了できる
  Given ダッシュボードを開いている
  When ユーザーがTab/Enter/Escapeのみを使って「設定変更→保存」のタスクを実行する
  Then マウス操作なしでタスクが完了する
  And 各操作ステップでフォーカスが視覚的に識別可能な要素に当たっている

Scenario: 検索タスクをキーボードのみで完了できる
  Given ダッシュボードに検索対象のレコードがseedされている
  When ユーザーがキーボードのみで履歴パネルへ遷移し検索語を入力する
  Then 一致する結果が表示される

Scenario: 記録開始タスクをキーボードのみで完了できる
  Given ポップアップを開いている
  When ユーザーが記録ボタンにフォーカスしEnterを押す
  Then 確認モーダルが開く

Scenario: 各パネルがWCAG AA基準に違反しない
  Given ダッシュボードの16パネルのいずれかを開いている
  When axe-coreによるアクセシビリティスキャンを実行する
  Then WCAG AA違反が0件である

Scenario: 日本語/英語切り替え時にレイアウトが崩れない
  Given chrome.i18nをjaまたはenに切り替えた状態でダッシュボードの各パネルを開く
  When 各要素の描画幅を計測する
  Then どの要素も scrollWidth が clientWidth を超えない（オーバーフローしない）

Scenario: 日本語/英語切り替え時に文言欠落がない
  Given chrome.i18nをjaまたはenに切り替えた状態でダッシュボードとポップアップを開く
  When 画面上のテキストを走査する
  Then i18nキー名がそのまま表示されている箇所が存在しない
```

## 受け入れ基準
- [x] `testDir/e2e/usability/a11y-usability.spec.ts` が新規作成されている
- [x] `testDir/e2e/usability/i18n-layout.spec.ts` が新規作成されている
- [ ] 主要タスク（設定変更、記録開始、検索）がキーボードのみで完了できることを検証している
      （設定変更のみ実装済み。**記録開始・検索が残タスク** — 上記「未達分の実装ガイド」参照）
- [x] 各パネルでaxe-coreスキャンを実行しWCAG AA違反ゼロを確認している
- [x] ja/en切り替え時のオーバーフロー検知が実装されている
- [x] i18nキーがそのまま表示される文言欠落の検知が実装されている

## テスト戦略
- E2E: `testDir/e2e/usability/a11y-usability.spec.ts`（検索タスク追加）、`popup-a11y-keyboard.spec.ts`（記録開始タスク・新規）、`i18n-layout.spec.ts`（実装済み）
- 統合: なし（i18nキー網羅性自体は既存`release-checks/check-i18n.mjs`が担当。本PBIは見た目のレイアウト崩れ側を新規に担当）
- 単体: なし

## 見積もり
2pt（うち残タスクは0.5pt相当。既存specへの2テスト追加のみ）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run test:e2e:usability` で全ファイルがPASSする（**単独実行で検証すること** — worktree並列実行はリソース競合で誤検知する）
- [ ] コードレビュー完了
