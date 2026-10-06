# PBI: E2E の poll 再定義を正規ヘルパーに寄せ、seed の非冪等を直す

## ユーザーストーリー

E2E を保守する開発者として、poll と seed を正規品に寄せたい。独自 poll が 2 spec に一字一句同一で残り、seed の `Date.now()` が正規 `seedRows` の固定値方針に反してリトライ毎に別行を挿入し得るから。

## 優先度

- 順位: 3/23
- RICE: 6.0（R3 / I2 / C1.0 / E1）
- 根拠: リトライ時の別行挿入は実害（INSERT OR IGNORE すり抜け）。2 ファイルのみの修正
- 依存: なし

## 背景（file:line 現状）

- `testDir/e2e/opfs-fts5-search.spec.ts:22-35` の独自 poll 定義、`:105` と `:219` の `created_at: Date.now()`
- `testDir/e2e/wasm-boundary-comprehensive.spec.ts:22-35` の独自 poll 定義（opfs-fts5 と一字一句同一、maxAttempts 6/8 のみ差）、`:116` と `:200-206` の `Date.now()` 系 seed
- 正規品: `testDir/e2e/fixtures/dashboardSqliteHelpers.ts:145-155`（`seedRows`）、`:186-199`（`poll`）、`:139-144` の docstring（リトライ安全のため固定値を使え）
- no-test-sleep の理由付き disable は正規品側に集約される形になる

## BDD受け入れシナリオ

```gherkin
Scenario: 独自 poll が消える
  Given 両 spec
  When poll 定義を探す
  Then 存在せず、`dashboardSqliteHelpers.js` からの import になっている

Scenario: リトライで別行が挿入されない
  Given 固定値 seed の両 spec
  When poll がリトライする
  Then 同一行への再試行になり、行が増えない
```

## 受け入れ基準

- [x] 両 spec の独自 `poll` が削除され import に置換されている
- [x] seed の `created_at` が `Date.UTC(...)` 固定値になり、一意性は URL 内の `Date.now()` トークンで担保されている
- [x] no-test-sleep の扱いが正規品側に集約されている
- [x] E2E の観測結果が無変更（実行は CI 範囲。静的検証まで）
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- E2E 自体はブラウザ要のため CI 範囲。単体・lint は validate で確認
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `testDir/e2e/opfs-fts5-search.spec.ts`、`testDir/e2e/wasm-boundary-comprehensive.spec.ts`（helper 無変更）
- ゲート: eslint 両ファイル PASS / type-check PASS（全体）/ lint 0 errors
