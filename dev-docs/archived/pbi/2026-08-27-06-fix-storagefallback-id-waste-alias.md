# PBI: FallbackStorage の ID 浪費とクエリ alias drift 解消

## ユーザーストーリー
開発者として、FallbackStorage の重複 insert で ID が欠番にならず、クエリの旧 alias (`isStarred`/`since`) が単一真実に統一される状態にしたい、なぜなら欠番は ID 空間を浪費し alias の二重定義は将来の削除時にフィルタ無視バグを隠すから。

## 優先度
- 順位: 6 / 8
- RICEスコア: 157.5（Reach=30 / Impact=1.5 / Confidence=70% / Effort=0.2）
- 根拠: Fallback は OPFS 不可環境の全ユーザに影響 (Reach=30)。ID 浪費は長期運用で可視化 (Impact=1.5)。alias の影響範囲が広く確信度やや低。

## なぜなぜ分析
- なぜ ID が浪費されるか: `allocateIds`/`getNextId` を重複チェック前に呼ぶため
- なぜ alias が残るか: `StorageQuery` (新型) と旧 `isStarred/since` の互換シムが `storageFallback.ts:155` と `sqliteMessageHandlers.ts` で二重実装された
- なぜ気づかないか: テストが `count` のみ検証し ID 連続性を検証しない、旧 alias テストと新型テストが並存しどちらも緑
- 解: ID 確保を存在チェック後に移動し、alias は `sqliteQueryBuilder` の StorageQuery に一本化して非推奨化

## BDD受け入れシナリオ
Scenario: ハッピーパス — 重複時は ID を消費しない
  Given `url=https://a.com, created_at=100` が既存
  When 同じレコードを `insert` する
  Then `id === -1` でカウンタは進まず次の正常 insert は連番である

Scenario: エッジケース — 旧 alias は非推奨だが動作し新 alias が優先される
  Given クエリ `isStarred:true, since:100` を渡す
  When `query` を実行する
  Then 新型 `starred/dateFrom` と同結果を返し、将来的な削除時にテストが失敗して気づける

## 受け入れ基準
- [x] `src/offscreen/storageFallback.ts:62-112` で ID 確保が `exists` チェック後に行われる
- [x] `isStarred`/`since`/`until` の互換分岐が 1 箇所に集約または `@deprecated` 明記され、`sqliteQueryBuilder` の StorageQuery が SSOT として文書化されている
- [x] `StorageBackend InsertBatchResult` (`inserted/skipped`) と Fallback の `count` の乖離が型またはコメントで解消されている
- [x] `storageFallback-comprehensive` の ID 連続性テストが追加されパスする

## テスト戦略
- 単体: `insert`/`insertBatch` の重複時の ID 欠番検証、`query` の alias 互換テスト
- 統合: `allocateIds` → `insertBatch` → `query` の一連で ID 連続性とフィルタが正しく動くことを確認
- E2E: 不要

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
