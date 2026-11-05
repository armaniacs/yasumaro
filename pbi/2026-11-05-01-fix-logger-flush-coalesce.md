# PBI: logger persistPending の同時完了時flush抜けの合流

## ユーザーストーリー

記録パイプラインの利用者として、同時刻に終わった別記録のログもアラーム待ちなしに永続化されてほしい。現行の `persistPending` は `isFlushing` ガードで二重実行を捨てるため、同時に完了した側の新規ログは次の1分アラームまで残り、SW終了時には失われることがあるから。

## 優先度

- 順位: 低（フォロー、急ぎなし）
- RICEスコア: 1.5（Reach=0.5 / Impact=1 / Confidence=60% / Effort=0.2人週）
- 根拠: 同時完了は稀で、1分アラームが上限を保証する。E2E側は完了時flush（RecordingOrchestrator）で既に緑。確信度を下げたのは再現が同時実行頼みのため。

## BDD受け入れシナリオ

Scenario: 同時完了した2記録のログがどちらも残る
  Given never-flush の scheduler 配線
  When 2件の record() を並行に完了させる
  Then 両方の traceId のログが adapter に入り、アラーム待ちが残らない

Scenario: 片方の flush が失敗しても他方は残る
  Given append が1回だけ失敗する adapter
  When 2件の record() を並行に完了させる
  Then 失敗側は console に報告され、成功側のログは残る

## 受け入れ基準

- [ ] `persistPending` の二重実行ガードを「捨てる」から「合流させる」に変える（dirty フラグの再実行か直列キューかは実装時に選ぶ）
- [ ] 完了時 flush（RecordingOrchestrator）の契約は変えない（本 PBI は合流だけ）
- [ ] onSuspend の3秒タイムアウト競合の扱いを変えない（別件として記録のみ）

## テスト戦略

- 単体: never-flush 配線＋並行 record() 2件で両 traceId が残る（recordingCompletionFlush.test.ts の拡張）
- 単体: append 失敗注入で片側喪失なし
- 回帰: logger／pipeline 帯の既存全緑

## 見積もり

0.2人週

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (本 PBI 範囲のみ)
