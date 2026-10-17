# PBI: purge/search計画の一本化とテスト入口化

## ユーザーストーリー
保持期限・上限変更の実装者として、層ごとの双子実装を同期させたくない。なぜなら片側修正漏れが保存・検索の乖離になるから。

## 優先度
- 順位: 11 / 12
- RICEスコア: 6.7（Reach=20 / Impact=1 / Confidence=0.5 / Effort=1.5）
- 根拠: B3と同点。search既定の移動は小刻みに。PBI 08と同領域だがplanner層で独立。

## 背景
arch診断C3。purge 3断片・search双子。テスト半分がhandle直叩き。

## BDD受け入れシナリオ
Scenario: 計画がplannerに集まる
  Given 保持期限・上限の変更
  When 修正する
  Then planner＋spec表だけで済む

Scenario: テストが入口経由になる
  Given spec変更
  When テストする
  Then 振舞いで乖離を検出できる

## 受け入れ基準
- [x] 計画がqueryPlannerに一本化される（小刻み移行可）
- [x] 直叩きテストが入口経由に上がる（純粋部品を除く）
- [x] offscreen系テスト全緑

## テスト戦略
- 単体: plannerテスト
- 結合: 入口経由テスト

## 見積もり
3.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
