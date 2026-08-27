# PBI: Mutex デッドロックとID衝突の解消

## ユーザーストーリー
開発者として、Mutex の `maxQueueSize=50` 到達時の `throw` 後の `locked` 残留と `nextTaskId` 衝突を解消したい、なぜなら攻撃者やバグったループで 50回積むと正規保存が恒久拒否され、ロック保持者が `release` を忘れると永久デッドロックになるから。

## 優先度
- 順位: 7 / 7
- RICEスコア: 140（Reach=20 / Impact=1.5 / Confidence=80% / Effort=0.15）
- 根拠: DoS は稀だが一旦発生すると復旧不能。`nextTaskId` は長期運用で衝突。

## なぜなぜ分析
- なぜデッドロックするか: `acquire` が `throw` しても `locked=true` が残り、`release` しない限り解除されない
- なぜID衝突するか: `nextTaskId` が `MAX_SAFE_INTEGER` で精度喪失し `Map` キー衝突
- 解: `maxQueueSize` 到達時は `locked` を維持せず `throw` 前に `locked=false` に戻すか、キュー満杯時は `clearTimeout` で待機を解除し、`allocateTaskId` で `MAX_SAFE_INTEGER` 到達時にラップアラウンド

## BDD受け入れシナリオ
Scenario: ハッピーパス — 50回 acquire 後の 51回目は拒否されるがロックは維持される
  Given `maxQueueSize=50` で 50回 `acquire` した
  When 51回目を呼ぶ
  Then `throw` されるが `locked` は `true` のまま

Scenario: エッジケース — タイムアウトした待機が二重resolveしない
  Given `acquire` がタイムアウトで `reject` した
  When `release` が呼ばれる
  Then 次の待機タスクへ正しく転送されデッドロックしない

## 受け入れ基準
- [x] `Mutex.ts` の `acquire` が `maxQueueSize` 超過時に `locked` を適切に管理する
- [x] `allocateTaskId` が `MAX_SAFE_INTEGER` でラップアラウンドする
- [x] `release` が例外時も `locked` を正しく管理する

## テスト戦略
- 単体: 50回 `acquire` 後の 51回目が `throw` することと `locked` 状態を検証
- 単体: `nextTaskId` が `MAX_SAFE_INTEGER` での挙動を検証
- 統合: 並行 100回の `acquire`/`release` でデッドロックしないことを検証
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
