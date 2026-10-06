# PBI: confirmToken のレガシー検証経路が本番未使用なのに、弱い比較を含めて残存している

## ユーザーストーリー

dashboard sqlite 契約の保守担当者として、confirmToken のレガシー経路を段階的に除去したい。本番 wiring が使わない経路に現行ポリシーから外れた弱い検証が残り、依存の追加を 1 箇所と勘違いしやすいから。

## 優先度

- 順位: 19/32
- RICE: 3.2（R4 / I2 / C0.8 / E2）
- 根拠: セキュリティ構造。同点ではリスク軽減効果を優先。NN26 の先行（manifest / wiring の同一ファイル）
- 依存: なし（NN26 の先行）

## 背景（file:line 現状）

- 弱い分岐: `src/background/handlers/dashboardSqlite/index.ts:104-111` の `:107-110` に `providedToken === valid`（定数時間比較なし・single-use 消費なし・scopeHash 無視）。正しい実装は `src/background/confirmTokenManager.ts:138-166`（TTL / single-use / scopeHash）
- レガシー正規化: `src/background/handlers/dashboardSqlite/deps.ts:164-175` で `getConfirmToken` があれば create/verify へ変換（`:171` は `token === await legacyFn()` という同種の弱い比較）。`:55` は optional 宣言
- 死蔵関数: `src/background/confirmTokenManager.ts:188-197` の `ensureConfirmToken` と `ensureConfirmTokenLegacy` が**完全に同一実装**（どちらも `createConfirmToken('__legacy__')`）
- 未使用依存: `src/background/dashboardSqliteWiring.ts:16` の `ensureConfirmToken` は宣言のみ。`src/background/compositionManifest.ts:38, :157` から渡されているが本番で参照なし
- 本番 wiring（比較対象）: `compositionManifest.ts:155-160` は `getConfirmToken` を渡していない
- テスト側利用: `src/background/handlers/__tests__/dashboardSqliteTestHarness.ts:43-54`、`src/background/handlers/dashboardSqlite/__tests__/dispatch-seams.test.ts:27-29`

## BDD受け入れシナリオ

```gherkin
Scenario: verifier 無しは fail-closed になる
  Given verifyConfirmToken も getConfirmToken も無い deps
  When リクエストトークンを検証する
  Then 弱い比較に落ちず false が返る

Scenario: テストハーネスは自前で変換する
  Given legacy getConfirmToken を使うテスト
  When normalizer 削除後に実行する
  Then ハーネス側の変換で従来どおり green になる

Scenario: 未使用依存と死蔵関数が消える
  Given 整理後の wiring と confirmTokenManager
  When 未使用を数える
  Then ensureConfirmToken 依存と ensureConfirmTokenLegacy が残らない
```

## 受け入れ基準

- [x] (1) `verifyRequestToken` の `:107-110` が落ち、verifier 無しは `return false`（fail-closed）。既存の try/catch は `index.ts:60-79` に残る
- [x] (2) `deps.ts:164-175` の normalizer が削除され、変換はテストハーネス側だけで継続する
- [x] (3) `dashboardSqliteWiring.ts:16` の必須依存が削除され（`compositionManifest.ts:157` も不要に）、本番 wiring が create/verify のみになる
- [x] (4) `ensureConfirmTokenLegacy` が削除されている。`ensureConfirmToken` は参照が無ければ削除
- [x] 手順 1 の前提として `confirmTokenConstantTime.test.ts` / `dashboardSqliteHandlers-extra.test.ts` の `getConfirmToken` モック群が create/verify モックへ書き換えられている
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: fail-closed のテスト、create/verify モックへの書き換え後の既存テスト green
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/background/handlers/dashboardSqlite/index.ts`（fail-closed 化）、`src/background/handlers/dashboardSqlite/deps.ts`（normalizer 削除）、`src/background/dashboardSqliteWiring.ts` と `src/background/compositionManifest.ts`（未使用依存の削除）、`src/background/confirmTokenManager.ts`（両 legacy 関数を削除）、テスト 3 ファイル（create/verify モック化 + legacy fallback の fail-closed 置換）、`testDir/e2e/opfs-fts5-search.spec.ts`（陳腐化した seeding コメントの更新。統合側）
- ゲート: 対象 66 tests green / type-check PASS / lint 0 errors
