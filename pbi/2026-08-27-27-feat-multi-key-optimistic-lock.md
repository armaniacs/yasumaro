# PBI: MultiKeyOptimisticLock の抽出

## ユーザーストーリー
開発者として、`optimisticLock:119` と `Mutex:37` と `savedUrlRepository:141` の二重並行制御を `MultiKeyOptimisticLock` に統一したい、なぜなら `optimisticLock` は単一key CAS のみで `savedUrlRepository:withAtomicSavedUrls:141` は二重key原子性のため `withOptimisticLock` を再発明し `JSON.stringify` 比較で行順序に脆く、`Mutex` はメモリ queue で `perUrlMutex` は `Map<string,Mutex>` の static 共有でライフタイムが繊細だから。

## 優先度
- 順位: 6 / 7
- RICEスコア: 160（Reach=40 / Impact=1.5 / Confidence=60% / Effort=0.30）
- 根拠: 並行制御の二重実装は `RecordingPipeline` の per-URL Mutex と `addSavedUrl/removeSavedUrl` の直叩きで横断競合を生む。

## なぜなぜ分析
- なぜ二重か: `optimisticLock` は単一key CAS のみ、`savedUrlRepository` は二重key原子性のため再発明
- なぜ気づかないか: 単体テストでは行順序の脆さが再現しない
- 解: `optimisticLock.ts` に `withAtomicKeys(keys, updater)` を追加し `withAtomicSavedUrls` の複製を削除。`JSON.stringify` 比較を `structuredClone`+正準化に

## BDD受け入れシナリオ
Scenario: ハッピーパス — 二重key が原子的に更新される
  Given `savedUrls` と `savedUrlsWithTimestamps` の2キーを同時に更新する
  When `withAtomicKeys` を呼ぶ
  Then 両キーが単一トランザクションで更新され、行順序に依存しない

Scenario: エッジケース — 並行更新が正しく競合検出される
  Given 2並行で同じ2キーを更新する
  When 両方が完了する
  Then 片方が `ConflictError` でリトライされ、最終的に整合する

## 受け入れ基準
- [ ] `optimisticLock.ts` に `withAtomicKeys(keys, updater)` が追加されている
- [ ] `savedUrlRepository:withAtomicSavedUrls` の複製が削除されている
- [ ] `JSON.stringify` 比較が `structuredClone`+正準化に置換されている

## テスト戦略
- 単体: `withAtomicKeys` の二重key原子性テスト
- 単体: `JSON.stringify` 行順序の脆さ再現テスト
- 統合: 実 `chrome.storage` での並行更新テスト
- E2E: 不要

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
