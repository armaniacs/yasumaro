# PBI: getURL 抽出ルールの二層同期を pin テストで保証する

code-review（2026-10-13）の指摘2 から起票。

## ユーザーストーリー

manifest 検証ゲートを保守する開発者として、ソース層（manifest.test.ts）と生成物層（check-manifest.mjs）の `getURL(...)` 抽出ルールが乖離しないことがほしい、なぜなら片方だけが拡張されると層の判定が食い違い、もう片方の検証穴が隠れるから。

## 優先度

- 順位: 06 / 全候補数 7
- RICEスコア: **1.6**（Reach=2 / Impact=0.5 / Confidence=0.8 / Effort=0.5）
- 根拠: 抽出ルールの変更は稀（Reach 2）。層の乖離は将来の検証穴のリスク（Impact 0.5）だが現時点で実害なし。Effort 0.5 は pin テストの設計（両ファイルの読み取りと比較方法）が必要なため。Confidence 0.8 は同期方式の設計判断が残るため。

## 背景

- `src/__tests__/manifest.test.ts:229` の `collectPageContextGetURLTargets()` と `scripts/release-checks/check-manifest.mjs`（WAR import chain チェック）は、同一の getURL 抽出正規表現 `/getURL\(\s*(['"`])((?:(?!\1).)*)\1\s*\)/g` を重複して持つ。
- ソース層（TS テスト・ビルド不要）と生成物層（node .mjs スクリプト・dist 依存）は言語ランタイムが異なり、共通モジュール化が素直でない。
- 片方だけが `getURL(変数)` や式付きテンプレートへの対応を拡張すると、もう片方の検証穴が隠れる（層の不一致が pass で隠れる）。

## なぜなぜ分析（設計疑問の解決）

なぜ乖離リスクがあるか → 正規表現が 2 箇所で重複している → なぜ重複しているか → ソース層と生成物層が別ランタイム（vitest/TS と node/.mjs）で共通モジュール化が素直でない → なぜ共通化しないか → scripts 層を src テストから import すると層の依存方向が曖昧になる → **解: 相互 pin テスト（`ci-paths-filter.test.ts` と同型。新規テストが両ファイルをテキストとして読み、抽出正規表現のリテラルが一致することを assert）**。共通ヘルパー化は層の依存を持ち込むため非推奨。既存の「CI 配線を pin するテスト」パターンと同じ型。

## BDD受け入れシナリオ

Scenario: 片方だけの変更で乖離が検出される
  Given 両層の getURL 抽出正規表現のうち片方だけを変更した状態
  When  pin テストが走る
  Then  fail する（乖離を検出）

Scenario: 両層が一致していれば green
  Given 両ファイルの抽出正規表現が一致している
  When  pin テストが走る
  Then  green

## 受け入れ基準

- [x] 両層の getURL 抽出正規表現の一致を pin するテストが新規ファイル（例: `src/__tests__/geturl-extraction-sync.test.ts`）に追加されている
- [x] 片方だけ変更すると fail することを Red 確認して記録する
- [x] pin テストが `npm run validate` / `npm test` に乗る（dist 依存なし — ファイル読み取りのみ）
- [x] `npm run validate` が green

## 検証結果（2026-10-13 実施）

- 実装: `src/__tests__/geturl-extraction-sync.test.ts` を新設。両層（`src/__tests__/manifest.test.ts:230` と `scripts/release-checks/check-manifest.mjs:352` — 実装時点の行番号）の `const getURLPattern = /getURL\(...\)/g;` リテラルをファイルテキストから抽出し一致を assert。リテラルが移動した場合は明示的なエラーメッセージで pin の更新を促す（`declared[1]` が取れない場合も別エラーで失敗 — `noUncheckedIndexedAccess` 下の `string | undefined` を暗黙 fallback で通さない）。
- pin テストの設計判断: 共通ヘルパー化（scripts 層を src テストから import）は層の依存方向を曖昧にするため非推奨とし、ci-paths-filter.test.ts と同型の「ファイルをテキストとして読んでリテラル比較」の pin テストを採用。dist 依存なしで `npm test` / validate に乗る。
- Red 確認: 生成物層の正規表現だけを 1 文字変更（`\)/g` → `\)\s*/g`）→ pin テスト FAILED（乖離を検出）→ Edit ツールで復元 → green 再確認。**片側だけの拡張が pin で検出されることの実証**。
- 検証: `npx vitest run src/__tests__/geturl-extraction-sync.test.ts` → green。`npm run validate` → exit 0（1062 files / 16032 tests）。
- コードレビュー: メインエージェントが実装と Red 確認の全差分をレビュー済み。

## テスト戦略

- 単体: pin テスト（ファイル読み取り + リテラル比較）。E2E/統合は不要。
- 注意: pin テストは新規ファイルに置く（manifest.test.ts への追加は本日別 PBI（NN01/NN03/NN05）とファイル重複するため）。

## 見積もり

0.5 SP（pin テストの設計 + Red 確認）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る（`npm run validate` green）
- [x] Red 確認の結果を PBI に記録する
- [x] コードレビュー完了
