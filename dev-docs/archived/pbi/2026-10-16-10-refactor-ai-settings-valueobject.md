# PBI: AI設定解決の値オブジェクト化

## ユーザーストーリー
上限・timeout変更の実装者として、各Adapterを全部触りたくない。なぜならキー名・既定・ladderが全Adapterに漏れているから。

## 優先度
- 順位: 10 / 12
- RICEスコア: 6.7（Reach=20 / Impact=1 / Confidence=0.5 / Effort=1.5）
- 根拠: 将来の変更容易性が主で現状無害。PBI 05と同領域だが値解決層で独立。

## 背景
arch診断B3。modelキー・contentCharsKey中継・既定値・gateが分散。Adapterが生Settingsを読む。

## BDD受け入れシナリオ
Scenario: Adapterが解決済み値だけ読む
  Given ResolvedConfig
  When Adapterを構築する
  Then Settings blob参照が残らない

Scenario: 上限変更が窓口だけで済む
  Given 既定値の変更
  When 修正する
  Then resolver+catalogのみの編集で済む

## 受け入れ基準
- [x] 解決済み値オブジェクトが導入される
- [x] AdapterのSettings直読みが消える
- [x] ai系テスト全緑（fixture縮小つき）

## テスト戦略
- 単体: 値オブジェクトの解決テスト
- 既存: ai系テストで回帰確認

## 見積もり
3.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
