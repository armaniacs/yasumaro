# PBI: savedUrlRepository 非原子更新の解消

## ユーザーストーリー
開発者として、`savedUrlRepository` の 2回 `withOptimisticLock` 呼び出しを単一トランザクションにしたい、なぜなら並行で片方成功後のリトライがもう片方を重複更新し LRU とサイズが乖離するから。

## 優先度
- 順位: 5 / 7
- RICEスコア: 180（Reach=30 / Impact=1.5 / Confidence=80% / Effort=0.20）
- 根拠: 履歴保存の整合性に直結。並行は稀だが一旦乖離すると修復不能。

## なぜなぜ分析
- なぜ非原子か: `savedUrls` と `savedUrlWithTimestamps` を別々の CAS で更新
- なぜ気づかなかったか: 単体テストでは並行を再現せず、実機のタブ並行で初めて乖離
- 解: 1回の `withOptimisticLock` で両キーを同時更新するトランザクション化

## BDD受け入れシナリオ
Scenario: ハッピーパス — 単一更新で両キーが整合する
  Given 並行で同じ URL のタイムスタンプ更新を 2回呼ぶ
  When 両方が完了する
  Then `savedUrls` と `savedUrlWithTimestamps` のサイズと内容が一致する

Scenario: エッジケース — 片方失敗時は両方ロールバック
  Given 2回目の CAS が競合で失敗する
  When リトライする
  Then 1回目の更新が重複適用されない

## 受け入れ基準
- [x] `savedUrlRepository.ts` の更新が単一 `withOptimisticLock` に統合されている
- [x] 並行 100回の更新で乖離が発生しないことをテストで検証

## テスト戦略
- 単体: 2並行の `updateUrlTimestamp` で `savedUrls`/`WithTimestamps` の整合を検証
- 統合: 実 `chrome.storage` mock で並行更新の整合を検証
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
