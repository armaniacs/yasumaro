# PBI: E2E フィクスチャの `data-ow-e2e-test` 残置属性を除去

## ユーザーストーリー
E2E 基盤の保守者として、無効化済みの旧プローブ経路の残骸がフィクスチャに残っていないでほしい。なぜなら「現状 inert」と分かっていても、将来の読み手が生きている経路と誤認し、プローブ設計の理解を妨げるから。

## 優先度
- 順位: 11 / 11
- RICEスコア: 0.8（Reach=1 / Impact=0.5 / Confidence=0.8 / Effort=0.5）
- 根拠: 実害なしの掃除。headed E2E がこの環境で実行できないため Confidence 0.8。

## 背景
`testDir/e2e/test-pages/` の 5 HTML（`long-page` / `over-cleansed-page` / `empty-body-page` / `qa-smbc-repro` / `short-page`）と `testDir/e2e/regenerate-summary.spec.ts:62` のインライン HTML に `data-ow-e2e-test="true"` が残る。loader は NN08 以降ページ属性を無視する（`src/content/loader.ts:59`）ため inert。レビュー指摘 Low #2（Legacy Bridge）。

## BDD受け入れシナリオ
Scenario: フィクスチャから旧属性が消える
  Given 上記 6 箇所
  When 属性を除去する
  Then リポジトリ内の `data-ow-e2e-test` 言及が単体テストの明示操作と履歴コメントのみになる

Scenario: E2E・単体テストは緑のまま
  Given 除去後
  When `extractor-comprehensive.test.ts` 等の関連単体テストを実行する
  Then 全緑（属性を自前で set するテストは影響なし）

## 受け入れ基準
- [x] 6 箇所の属性が除去される（または除去しない場合は「意図的残置」のコメントが残る）
- [x] `npx vitest run src/content/` 全緑（32 files / 534 tests passed, 2026-10-16）
- [x] headed E2E は実行環境がないため未検証の旨を記録する（未実行のまま記録 — 環境制約）

## テスト戦略
- 単体: `src/content/` 系テストで回帰確認
- E2E: 環境制約で未実行（記録のみ）

## 見積もり
0.5 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（E2E 除外の旨を記録 — headed E2E 未実行、単体 534 緑で代替確認）
- [x] コードレビュー完了（自律クローズ：変更はフィクスチャ markup のみ、参照者なしを grep で確認）
- [x] ドキュメント更新済み（不要ならその旨を記録 — ドキュメント更新不要、履歴コメント・単体テストの明示操作のみ残存が意図通り）
