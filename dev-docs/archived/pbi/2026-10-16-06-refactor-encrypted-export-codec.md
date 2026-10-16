# PBI: 暗号exportコーデックの別module化

## ユーザーストーリー
暗号バックアップの利用者として、iteration変更時の同期漏れで復号不能になってほしくない。なぜなら漏れはAPIキー喪失かKDF偽装再発に直結するから。

## 優先度
- 順位: 06 / 12
- RICEスコア: 18.7（Reach=20 / Impact=2 / Confidence=0.7 / Effort=1.5）
- 根拠: 影響大だが発火はformat変更時のみ。PBI 01と同領域だが別moduleで独立。

## 背景
arch診断D2。HMAC payload builder・署名者・iteration交渉・定数が4箇所。`envelope.ts`と二重発明。

## BDD受け入れシナリオ
Scenario: codec表テストが通る
  Given v2受入・v3偽装・legacy rehashの入力
  When codecで処理する
  Then chromeなしで正誤判定できる

Scenario: settings側に数字が残らない
  Given codec移行後
  When settings側を読む
  Then version分岐・iterationsの数字が存在しない

## 受け入れ基準
- [x] payload構築→署名→検証→復号が1moduleに集約される
- [x] settings側がパスワードとJSONの受渡しだけになる
- [x] 既存の暗号import/exportテスト全緑

## テスト戦略
- 単体: codec表テスト（Red→Green）
- 既存: 暗号系テストで回帰確認

## 見積もり
3.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
