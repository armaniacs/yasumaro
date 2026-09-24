# PBI: 『Summary not available.』フォールバックリテラルの中立層 SSOT 化

## ユーザーストーリー
保守担当者として、AI 要約のフォールバックリテラルが1箇所で定義されてほしい、なぜなら複製が1つでもドリフトすると AI 失敗行の検出が静的に壊れるから。

## 優先度
- 順位: 1 / 8（着手順 09）
- RICEスコア: 20.0（Reach=5 / Impact=1.0 / Confidence=100% / Effort=0.25pt）
- 根拠: pipelineText.ts が「one home」を自称しながら生成側4箇所（privacyPipeline.ts:101,168・processPrivacyPipelineStep.ts:70・markdownFormatter.ts:48）が再宣言し、golden pin は formatMarkdownStep のみで無防護。工数最小で drift バグクラスを排除。

## BDD受け入れシナリオ
Scenario: リテラルの単一ソース
  Given src/utils/summaryFallback.ts に SUMMARY_EMPTY_FALLBACK が定義されている
  When pipelineText / privacyPipeline / processPrivacyPipelineStep / markdownFormatter / wordClusterAdapter がフォールバックを参照する
  Then すべて import 経由であり、リテラルの文字列本体は1ファイルにのみ存在する

Scenario: リテラル変更の検出
  Given summaryFallback.ts の定数を変更する
  When テストを実行する
  Then pipelineText の golden pin（formatMarkdownStep のバイト等価テスト）が失敗し、変更が意図的だったと気づける

## 受け入れ基準
- [x] src/utils/summaryFallback.ts（Layer 0・`// @layer 0` コメント付き）に定数を新設
- [x] pipelineText.ts は re-export のみとし、自前の文字列本体を削除
- [x] privacyPipeline.ts（2箇所）・processPrivacyPipelineStep.ts・markdownFormatter.ts が import に置換される
- [x] wordClusterAdapter.ts は pipelineText 経由から直接 utils import に切り替わる
- [x] LAYERS.md の分類表（Layer 0）に新ファイルを追記し `npm run lint:layers-docs` が green
- [x] LAYERS.md 依存ルール節に「dashboard→background の純粋定数・型 import は許容」の規約を1行追記
- [x] 既存テスト（pipelineText.test の golden pin 含む）が無変更で green

## テスト戦略
- 単体: 既存 golden pin（formatMarkdownStep バイト等価）が SSOT を保護することを確認
- 統合: なし（リテラル置換のみ・挙動不変）
- 単体（追加）: summaryFallback.ts の値が 'Summary not available.' であることの pin テスト

## 実装メモ
- pipelineText.ts は `import type` のみで chrome API 非依存のため utils からの逆依存は発生しない
- markdownFormatter は Layer 2 で background import が禁止 → utils 配置が唯一の合法経路
- eslint/rules/utils-layer-boundary.mjs の LAYER0_FILES への追加と LAYERS.md 分類表を必ず揃える（lint:layers-docs が双方向検査）

## 見積もり
0.25 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（LAYERS.md・lint:layers-docs green）

## 実装記録（2026-09-24 arch-delivery-loop）
- 実装: src/utils/summaryFallback.ts 新設（Layer 0）・pipelineText は re-export 化・privacyPipeline（2箇所）/processPrivacyPipelineStep/markdownFormatter を import 化・wordClusterAdapter を utils 直参照に切替・eslint ルール LAYER0_FILES + LAYERS.md 分類表/依存ルール追記
- 検証: type-check PASS / lint:layers-docs green / 対象 174 tests green（golden pin 含む）
- 備考: GitHub PR レビューはユーザー作業として残置
