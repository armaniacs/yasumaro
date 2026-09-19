# PBI: Coverageジョブのタイミング耐性テスト失敗を解消する

## ユーザーストーリー
開発者として、Coverage CIジョブが緑になりカバレッジ数値が取得できることがほしい。なぜなら、テストされていない領域の可視化が回復し、品質判断の材料が戻るから

## 優先度
- 順位: 3 / 全3候補（台帳: `pbi/2026-09-19-00-backlog-post-v699.md`）
- RICEスコア: 24（Reach=6 / Impact=1 / Confidence=1.0 / Effort=0.25人週）
- 根拠: 原因が特定済み（下記）で小工数。ただしカバレッジはvalidate/testジョブに次ぐ補助シグナルで、本体ゲートは既に緑のため緊急性は低い

## 状況
- 失敗原因（PR #150マージ時のCoverage実行35431757220で特定済み）: `src/utils/crypto/__tests__/crypto.test.ts > constantTimeCompare > timing-attack resistance: keeps execution time stable across lengths` の1件がカバレッジ計測（インストゥルメンテーション）下でのみ失敗。計測オーバーヘッドが実行時間分布を変え、時間安定性のアサーションが崩れる
- validate / test ジョブ（カバレッジなし）では常時パス → カバレッジ実行固有
- 失敗ステップ: 「Run tests with coverage」と後続の「Report coverage」

## BDD受け入れシナリオ
Scenario: カバレッジ計測下でもタイミング耐性テストが安定してパスする
  Given カバレッジ計測が有効なvitest実行環境がある
  When  constantTimeCompareのタイミング耐性テストが実行される
  Then  計測オーバーヘッドに左右されずパスする（Coverageジョブが緑になる）

Scenario: テストの検出力は維持される
  Given constantTimeCompareに早期return等の文字列長依存の短絡が混入した
  When  タイミング耐性テストが実行される
  Then  その差異は依然として検出されテストが失敗する（緩和により検証力が失われていない）

## 受け入れ基準
- [ ] Coverageジョブが緑になる（3連続実行で安定）
- [ ] 修正方式（サンプル数・ウォームアップ・中央値比較・計測検出時の緩和等）と、それがタイミング攻撃耐性の検出力を損なわない理由をテストコメントに記録する
- [ ] validate / test ジョブが引き続きパスする

## テスト戦略
- 単体: 当該テストの再設計（統計的比較への変更、サンプル数・ウォームアップ追加、またはカバレッジ実行検出時の緩和）。絶対時間アサーションの緩和だけで意味を失わないことを、意図的に遅延させる文字列長依存短絡を混入させる否定テストで確認する

## 見積もり
1pt

## Definition of Done
- [ ] 全BDDシナリオが検証されパスする
- [ ] コードレビュー完了
- [ ] 必要に応じてCHANGELOG更新
