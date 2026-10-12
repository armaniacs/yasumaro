# PBI: wxt.config.ts の .ts import 逸脱理由をコメントに明記する

code-review（2026-10-13）の指摘6 から起票。

## ユーザーストーリー

規約チェックやコードレビューを実施する開発者として、`import wxtConfig from '../../wxt.config.ts'` の逸脱理由がコメントで分かることがほしい、なぜなら「全 import は .js 拡張子」という絶対表記の規約に対する正当な例外であることが、後続の機械的な指摘や手動レビューで再発見コストなく分かるから。

## 優先度

- 順位: 05 / 全候補数 7
- RICEスコア: **2.0**（Reach=2 / Impact=0.25 / Confidence=1.0 / Effort=0.25）
- 根拠: 同ファイルを触る時・規約チェックを導入する時のみ関与。同点候補の中で時間的緊急性は NN04 と同等。NN03（偽 fail の防止）をリスク軽減効果で上回るため 5 位。

## 背景

- `src/__tests__/manifest.test.ts:42` は `import wxtConfig from '../../wxt.config.ts'` とルート設定ファイルを明示 .ts 拡張子で import している。
- AGENTS.md / CLAUDE.local.md の TypeScript 規約は「All imports must use .js extensions (including .ts source files)」と絶対表記。本 import はルート設定ファイルがコンパイル対象モジュールでなく、vitest（vite）が .ts を解決するため不可避な例外（type-check も通る）。
- 逸脱理由がコメントに無いため、後続の機械的な規約チェック導入時や手動レビューで指摘される可能性が高い。

## BDD受け入れシナリオ

Scenario: 逸脱理由がコメントから分かる
  Given manifest.test.ts の wxtConfig import 行直上
  When  読む
  Then  「ルート設定ファイルはコンパイル対象モジュールではなく vitest が .ts を解決するため、.js 拡張子規約の適用対象外」の旨が書かれている

Scenario: 動作は変わらない
  Given 現行の import 実装
  When  `npm run type-check` が走る
  Then  従来どおり green（コメントのみの変更）

## 受け入れ基準

- [ ] `import wxtConfig from '../../wxt.config.ts'` の直上に逸脱理由のコメントが追記されている
- [ ] コードの動作は変わらない（`npm run type-check` が green）
- [ ] `npm run validate` が green

## テスト戦略

- 単体: 既存の type-check で動作不変を確認。新規テストは不要（コメントのみ）。

## 見積もり

0.25 SP

## Definition of Done

- [ ] 全BDDシナリオが検証されパスする（type-check で動作不変を確認）
- [ ] type-check / lint / test が通る（`npm run validate` green）
- [ ] 検証結果（コマンドと結果）を PBI に記録する
- [ ] コードレビュー完了
