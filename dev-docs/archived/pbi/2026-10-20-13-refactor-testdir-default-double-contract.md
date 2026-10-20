# PBI 13: testDir 既定ダブルの契約整備（i18n モック・import.meta 死スタブ・initWasmForNode）

## ユーザーストーリー
メンテナーとして、テストダブルが実 Chrome・本番契約と忠実な状態がほしい、なぜなら既定ダブルが本番と乖離すると、翻訳欠落時のフォールバック経路が約 900 テストで実行されず、実ブラウザとの差が隠れるから。

## 変更点の概要
testDir/vitest.setup.ts の既定 chrome.i18n.getMessage モックと import.meta 死スタブ、wasm/testing/initWasmForNode.ts の契約乖離を本番契約に寄せる。

## 現状と問題
- testDir/vitest.setup.ts:71 ― 既定 getMessage モックが未知キーで `return key`（実 Chrome は '' を返す。src/utils/i18n.ts:38 が !message を処理）→ getMessageOr（i18n.ts:100）・tOrKey のフォールバック分岐に既定ダブル下では到達しない。setupFiles 全テスト（約 900 ファイル）に波及
- testDir/vitest.setup.ts:162-168 ― `vi.stubGlobal('import.meta', {...})` は globalThis への代入で、モジュール構文の import.meta（src/utils/logger/core.ts:147 が直接読む）に届かない。core-branch.test.ts:185-192 が「vitest では import.meta.env.DEV は true のまま」と明言（効果ゼロの傍証）。コメントは「logger.ts isDevelopment で使用」と虚偽
- src/wasm/testing/initWasmForNode.ts:51-57 ― createNodeWasmInit が失敗 Promise を永久キャッシュ。本番契約 initWasm.ts:61-68 は失敗で singleton をリセットして再試行可能 → 「再試行可能」契約を Node 側ダブルでは検証できない

## 変更の理由
[テスト容易性/保守性] ダブルの契約乖離は本番でしか発見できないバグを隠す。import.meta 死スタブは誤解を残す。

## 提案コード（骨子）
- getMessage モックの未知キーを `return ''` に変更し、破れるテストは本番契約に寄せて修正
- import.meta スタブを削除（効果ゼロ）し、コメントを修正
- createNodeWasmInit に reset-on-failure を付与（本番 initWasm.ts と同一契約）

## BDD受け入れシナリオ
Scenario: 未知キーで本番と同じ挙動
  Given 実 Chrome は未知キーで '' を返す
  When 既定ダブルで未知キーを getMessage する
  Then '' が返り、getMessageOr のフォールバック分岐が実行される

Scenario: initWasmForNode の再試行可能契約
  Given 失敗する WASM 初期化
  When createNodeWasmInit を 2 回呼ぶ
  Then 2 回目は再試行される（失敗 Promise の永久キャッシュではない）

## 見積もり
2 pt（RICE: 20 = Reach 20 × Impact 2 × Confidence 1.0 ÷ Effort 2.0 人日）

## DoD
- [x] モック変更後の破れるテストを本番契約側へ修正し全テスト通過
- [x] import.meta 死スタブの削除とコメント修正
- [x] npm run validate 通過

## 実装記録（2026-10-20）
- testDir/vitest.setup.ts: 既定 getMessage モックの未知キーを '' に変更（契約をコメントに明文化）、import.meta 死スタブと虚偽コメントを削除
- src/wasm/testing/initWasmForNode.ts: createNodeWasmInit に reset-on-failure を付与（本番 initWasm.ts と同一契約）。新規単体テスト src/wasm/testing/__tests__/initWasmForNode.test.ts（4 tests）
- 破れて修正したテスト: src/dashboard/components/__tests__/periodFilter.test.ts（key-echo 期待を本番契約側に修正 + vi.spyOn で注入 pin を強化）
- 検証: npx vitest run 全体 1105 files / 16588 tests 全通過、type-check pass、type-check:test:baseline 453 = 453、eslint pass、validate:fast green
