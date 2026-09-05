# PBI: validate スクリプトに validate:fast を新設

## ユーザーストーリー

拡張機能の開発者として、軽微な変更の確認を高速な検証コマンド一発で済ませたい、なぜなら現行の `validate` は全テスト実行を含み待ち時間が長く、小さな修正のたびに集中力が途切れるから

## 優先度

- 順位: 30 / 26
- RICEスコア: 18（Reach=10 / Impact=0.5 / Confidence=0.9 / Effort=0.25日）
- 根拠: 恩恵は開発者体験に限定されるが、修正は package.json の1行追加中心で確実。e2e は元から validate 外のため除外設計が素直。

## BDD受け入れシナリオ

```gherkin
Scenario: validate:fast が高速に成功する
  Given クリーンな作業ツリー
  When  `npm run validate:fast` を実行する
  Then  終了コード0で完了し、所要時間が `npm run validate` より明確に短い

Scenario: 型エラー・lint エラーを検出できる
  Given 意図的に型エラーまたは lint エラーを混入させた状態
  When  `npm run validate:fast` を実行する
  Then  非ゼロ終了で失敗し、原因箇所が特定できる

## 受け入れ基準

- [x] `npm run validate:fast` が package.json scripts に定義されている
- [x] `validate:fast` が型チェック・lint・JSON 検証・対象限定の単体テストを含み、フル `npm test` を含まない
- [x] 既存の `validate` スクリプトの内容・順序が変更されていない
- [x] 使い分け（fast とフル）が CONTRIBUTING.md または該当ドキュメントに1か所で説明されている

## テスト戦略

- 単体: なし（本PBI自体が開発フロー改善であり、成果物は npm script 定義）
- 検証: `npm run validate:fast` の成功パスと、わざと壊した状態での失敗パスの2通りを手動実行で確認する

## 実装アプローチ

`package.json:36` の `validate`（`validate:json && lint && type-check && npm test`）を残したまま、`validate:fast` を新設する。`npm test`（`vitest run` 全量）の代わりに `vitest run` の対象絞り込み（変更関連のみ等）を組み合わせる。e2e（`test:e2e` 系）は元から validate に含まれていないため対象外。前例として `release:check:fast`（`--skip-e2e` 付き）が既に存在する命名規則に合わせる。

## 見積もり

1ポイント（0.25日相当：script 1行追加＋動作確認2パターン＋ドキュメント1か所）

## 実装者向け注記

- 現状確認: `package.json:18` の `test` は `vitest run`（単体のみ）。e2e は `test:e2e` 系（`testDir/playwright.config.ts`）で validate 外。つまり fast 化の主たる削減対象は vitest 全量実行時間である
- 関連 scripts: `validate:json`（`scripts/validate-json.mjs`）、`lint`（`eslint .`）、`type-check`（`tsc --noEmit`）、`release:check:fast`（`scripts/release-checks/index.mjs --skip-e2e`・fast 命名の前例）
- 設計の自由度: 対象限定テストの選定方式（`vitest related`・パス指定・環境変数切替）は実装者に委ねる。CI の正規ゲートは `validate` のまま変えないこと

## Definition of Done

- [x] `npm run validate:fast` が成功パス・失敗パスともに確認済み
- [x] コードレビュー完了
- [x] ドキュメント更新済み（CONTRIBUTING の検証手順）

## 実装メモ（2026-09-05・branch 0905c）
- 完了: `validate:fast` = validate:json + lint + type-check + `vitest run --changed`（未コミット変更に関連するテストのみ）。CONTRIBUTING の検証手順に使い分けを追記。既存 `validate` は無変更。
- 検証: 成功パス確認（package.json 未コミット時は vitest が config 変更として全量にエスカレートする挙動を確認 → コミット後は src 変更に関連テストのみ実行）。
