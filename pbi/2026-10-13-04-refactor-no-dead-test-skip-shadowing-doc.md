# PBI: no-dead-test-skip ルールのシャドーイング制限を Limitation 節に併記する

code-review（2026-10-13）の指摘5 から起票。

## ユーザーストーリー

lint ルールの誤検知を調べる保守担当者として、シャドーイングが既知の制限であることがルールコメントで分かることがほしい、なぜなら誤検知の原因切り分けに時間を使うから。

## 優先度

- 順位: 04 / 全候補数 7
- RICEスコア: **2.0**（Reach=2 / Impact=0.25 / Confidence=1.0 / Effort=0.25）
- 根拠: ルールを触る時のみ関与。同点候補の中でリスク軽減効果は NN03 に次ぐ（保護ツール自身のドキュメント）。時間的緊急性は NN05 と同等。

## 背景

- `eslint/rules/no-dead-test-skip.mjs` の Limitation 節はエイリアス import（`import { test as t }`）の制限のみを記す。
- 受信側はリテラル名（`it` / `test` / `describe`）で判定するため、シャドーイング（`for (const it of items) { it.skip('x', fn); }`）も同種の制限（誤報告/漏れ）になりうる。現行リポジトリでは発生しないが、エイリアスと同じ「リテラル名判定の限界」として併記するのが正確。

## BDD受け入れシナリオ

Scenario: 制限の併記
  Given no-dead-test-skip.mjs の Limitation 節
  When  読む
  Then  シャドーイング（`for (const it of items)` 形）がエイリアス import と同種のリテラル名判定の限界として併記されている

Scenario: ルール動作は変わらない
  Given 現行のルール実装
  When  `npx vitest run eslint/__tests__ --repeats=20` が走る
  Then  従来どおり green（コメントのみの変更）

## 受け入れ基準

- [ ] `eslint/rules/no-dead-test-skip.mjs` の Limitation 節にシャドーイングの制限が併記されている
- [ ] コードの動作は変わらない（`npx vitest run eslint/__tests__ --repeats=20` が green）
- [ ] `npm run validate` が green

## テスト戦略

- 単体: 既存ルールテスト（`createRepeatSafeRuleTester`）で動作不変を確認。新規テストは不要（コメントのみ）。

## 見積もり

0.25 SP

## Definition of Done

- [ ] 全BDDシナリオが検証されパスする（既存ルールテストで動作不変を確認）
- [ ] type-check / lint / test が通る（`npm run validate` green）
- [ ] 検証結果（コマンドと結果）を PBI に記録する
- [ ] コードレビュー完了
