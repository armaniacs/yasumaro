# PBI: 型ベースラインゲートの部分出力検出

## ユーザーストーリー
開発者として、型ベースラインゲートの既知の穴（クラッシュ時の部分出力を見逃す）を塞ぎたい。なぜなら、exit 1 で部分的エラーリストが出た場合に完全実行と区別できず、誤ったベースライン判定で赤・緑を見誤るおそれがあるから

## ビジネス価値
- `type-check:test:baseline` の fail-closed 性を完成させ、誤判定による無駄な調査・見逃しをなくす
- 現行スクリプトの residual hole コメントを解消する

## BDD受け入れシナリオ

```gherkin
Scenario: 部分出力のクラッシュは評価拒否になる
  Given tsc が exit 1 で不完全なエラーリストを出した（クラッシュの模擬）
  When   ベースラインゲートを実行する
  Then   「完了した型検査ではない」として拒否され、カウント比較に入らない

Scenario: 完全な実行は従来どおり評価される
  Given tsc が完走し、エラー数と exit コードが TS7 規約に一致する
  When   ベースラインゲートを実行する
  Then   従来どおり pinned 値と比較して合否を出す
```

## 受け入れ基準
- [x] 部分出力の検出方式を確定した（--pretty 固定＋ANSI strip 後の「集約行の存在＋counted === N」照合。tsgo 実測で非 pretty に集約行が出ないこと・pretty strip 後に集約行が出ることを確認。/tmp/whywhy-baseline-partial.md に記録）
- [x] `scripts/check-type-test-baseline.mjs` に検出を実装し、現行の exit-code 規約（TS7: 型エラー→1、config break→2、clean→0）を維持した（clean 時は集約照合を skip）
- [x] `testDir/__tests__/type-test-baseline.test.ts` のスタブ行列に部分出力（集約なし）・不一致ケースを追加し、全11件パスする
- [x] `npm run type-check:test`（実 tsc、pretty 化後も 439 件で一致）が pinned 439 で緑である

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし（ゲートスクリプト単体）

### 統合テスト
- 実 tsc 出力に対するゲート実行（現行どおり緑）

### 単体テスト
- スタブ tsc 出力の行列拡張（部分出力・空出力・spawn 失敗・config break・正常の全組合せ）

比率: E2E:統合:単体 = 0:1:10

## 実装アプローチ
- **Outside-In**: スタブ行列に部分出力ケースを先に赤で追加 → ゲート実装 → グリーン
- **Red-Green-Refactor**: TDD サイクルを適用

## 見積もり
2 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（`scripts/` のみ。tsgo の exit 規約に依存）
- テスタビリティ: 現行の `TYPE_TEST_BASELINE_TSC_EXIT` スタブ方式を拡張する
- 非機能要件: なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 既知の穴の記述を確認
grep -n "Residual hole" scripts/check-type-test-baseline.mjs
# 現行スタブ行列の確認
grep -n "runChecker\|tscExit" testDir/__tests__/type-test-baseline.test.ts | head
```

確認済み（2026-11-22）: residual hole はコメントに文書化済み。スタブ行列は9件で全緑（exit 0/1/2/spawn を網羅）。

### 実装手順
1. 部分出力の検出方式を確定する（集計行照合が第一候補。tsc の出力形式依存のため tsgo での実測が必要）
2. スタブ行列に部分出力ケースを追加（赤確認）→ ゲートに検出実装 → グリーン
3. 実 tsc での緑（pinned 439）を確認する

### 落とし穴
- tsc の出力形式はバージョン・pretty 設定で変わる。検出方式は tsgo 7.0.2 の実測に基づける
- 過剰な厳格化で正常実行を拒否しないこと（fail-closed と誤検出のバランス）
- exit コード規約の変更は `testDir/__tests__/type-test-baseline.test.ts` とセットで行う

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（スタブ行列11件。部分出力・不一致の拒否を確認）
- [x] テストカバレッジが基準を満たす（新規分岐は全 stub でカバー）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後。ゲート追加のみで既存挙動は不変）
- [x] ロールバック手段の検討（ゲート追加のみのため切り戻しは revert のみで足りる）
- [x] ドキュメント更新済み（スクリプトのヘッダ仕様を更新。公開 API・仕様の変更なし）
