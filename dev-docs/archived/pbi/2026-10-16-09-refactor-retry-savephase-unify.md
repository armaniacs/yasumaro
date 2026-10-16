# PBI: retry経路のSavePhase統一（3旗のRetryContext化）

## ユーザーストーリー
再試行の利用者として、通常保存と再試行でエラーポリシーが食い違ってほしくない。なぜなら迂回は重複追記か未保存を生むから。

## 優先度
- 順位: 09 / 12
- RICEスコア: 10（Reach=20 / Impact=1.5 / Confidence=0.5 / Effort=1.5）
- 根拠: 確信度低め（3旗合意の実害は未観測）。PBI 04と同領域だが別関数で独立。

## 背景
arch診断A3。retryがSavePhaseを迂回し成功判定が場当たり。replayWrite・markdown凍結・dedupeの3旗合意に依存。

## BDD受け入れシナリオ
Scenario: retryがReceiptで判定される
  Given 再試行
  When 実行する
  Then SaveReceipt/outcomesで成功が決まる

Scenario: 3旗が1型に束ねられる
  Given RetryContext
  When stepsが参照する
  Then 3旗の個別参照が残らない

## 受け入れ基準
- [x] retry subsetがSavePhase.save経由になる
- [x] 3旗がRetryContext型に束ねられる
- [x] pipeline retry系テスト全緑

## テスト戦略
- 単体: 公開interface経由の振舞いテスト
- 既存: savePhaseReplay/retry系で回帰確認

## 見積もり
3.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
