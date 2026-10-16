# PBI: op列挙の表導出化（5層手書きの畳み込み）

## ユーザーストーリー
検索・保存op追加の実装者として、5層の手書き列挙を同期させたくない。なぜなら綴りミス・漏れがテスト同期頼みだから。

## 優先度
- 順位: 08 / 12
- RICEスコア: 11.7（Reach=25 / Impact=1 / Confidence=0.7 / Effort=1.5）
- 根拠: 波及広いが現状動いている。worker-switch畳み込みは段階化。

## 背景
arch診断C2。dashboard二度分岐・offscreen 14行lambda・worker 30分岐switch・Backend 14 proxy。ARCHIVE_DISPATCHは導出済み資産あり。

## BDD受け入れシナリオ
Scenario: op追加が2点で済む
  Given 新規op
  When 追加する
  Then wire行＋runner実装だけで全層に効く

Scenario: 表駆動テストが全opを被覆する
  Given op表
  When テストする
  Then 数え上げテストなしに全opが検証される

## 受け入れ基準
- [x] archive 14行がBY_MESSAGE由来ループに畳まれる
- [x] Backend proxyがdescriptorループに畳まれる
- [x] worker-switch畳み込みの方針が決定する（実施は段階可）

## テスト戦略
- 単体: 表駆動被覆テスト（Red→Green）
- 既存: sqlite系テストで回帰確認

## 見積もり
3.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
