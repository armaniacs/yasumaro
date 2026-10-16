# PBI: recordingDecision shimの整理（表か現場への一本化）

## ユーザーストーリー
ゲート仕様変更の実装者として、step・table・shimの3層を往復したくない。なぜなら往復は変更漏れを生むから。

## 優先度
- 順位: 07 / 12
- RICEスコア: 12（Reach=15 / Impact=0.5 / Confidence=0.8 / Effort=0.5）
- 根拠: 現状無害な薄さで影響小。Effortも小。

## 背景
arch診断A2。deletion test不合格の再export層。順序pinがソース文字列照合になっている。

## BDD受け入れシナリオ
Scenario: 判定が1箇所にある
  Given ゲート仕様の変更
  When 修正する
  Then step+tableの2箇所ではなく1箇所で済む

Scenario: 順序pinが表駆動になる
  Given gate順序
  When テストする
  Then ソース文字列照合でなく表の順序が検証される

## 受け入れ基準
- [x] shimが撤去され表か現場のどちらかに集約される
- [x] 順序pinが表駆動テストになる
- [x] pipeline系テスト全緑

## テスト戦略
- 単体: gateTable真理表テスト
- 既存: pipeline系で回帰確認

## 見積もり
1.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
