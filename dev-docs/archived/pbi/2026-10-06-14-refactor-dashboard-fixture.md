# PBI: dashboard 系 E2E fixture の起動骨格を統一する

## ユーザーストーリー

E2E を保守する開発者として、dashboard 起動を 1 つにしたい。同一骨格が 3 ファイルにコピーされ、起動手順の修正が 3 箇所に波及するから。

## 優先度

- 順位: 14/23
- RICE: 1.8（R4 / I1 / C0.9 / E2）
- 根拠: seed 定義だけ残して委譲。NN13 の先行（launcher SSOT の確定）
- 依存: なし（NN13 の先行）

## 背景（file:line 現状）

- `testDir/e2e/fixtures/dashboard.fixture.ts:15-58`（context `:16-33` / extensionId `:35-38` / dashboardPage `:40-57`）
- `testDir/e2e/fixtures/dashboard-locale.fixture.ts:23-59`（同型。locale 受け渡しのみ差分）
- `testDir/e2e/fixtures/dashboard-issue-report.fixture.ts:25-76`（同型＋`__createdTabUrls` スタブ `:60-69`）
- 第 4 の変種: `testDir/e2e/popup-fix09-25.spec.ts:26-46`（独自 popupContext）と `:52-78`（beforeAll 直起動＋手動 consent）
- 正規の launcher: `testDir/e2e/fixtures/launchExtensionContext.ts`（NN13 で単一 SSOT 化の前提）

## BDD受け入れシナリオ

```gherkin
Scenario: 起動骨格が共有される
  Given 3 fixture のいずれか
  When 起動する
  Then createDashboardFixture を経由し、seed 定義だけが各 fixture に残る

Scenario: popup 変種が正規に寄る
  Given popup-fix09-25 の 2 箇所
  When 整理する
  Then createPopupFixture と dashboard 系に寄り、振る舞いが同一である
```

## 受け入れ基準

- [x] `createDashboardFixture({ seedPolicy, locale?, initScript? })` が新設されている
- [x] 3 fixture が seed 定義だけ残して委譲している
- [x] `popup-fix09-25` の 2 箇所が正規に寄っている
- [x] 同一 seed・同一 goto・同一待ちで振る舞い不変。E2E 実行は CI 範囲
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- E2E 自体はブラウザ要のため CI 範囲。静的検証は validate で確認
- 実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: 新規 `dashboard-shared.fixture.ts`、3 fixture（seed 残し委譲）、`popup-fix09-25.spec.ts`（fresh-consent 契約の明示＋consent 解消の正規ヘルパー化。`createPopupFixture` は modal を dismiss するため意図的に不使用とコメント化）
- ゲート: eslint 5 ファイル PASS / type-check PASS（全体）/ lint 0 errors。E2E 実行は CI 範囲
