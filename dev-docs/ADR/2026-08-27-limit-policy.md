# ADR: LIMIT 政策 — fts:100000 / plain:1000 の2種温存

## ステータス
採用

## 日付
2026-08-27

## コンテキスト
PBI-12 の `QueryPlanner` 統一で `LIMIT` cap が3種混在していることが判明した。

- `IdbVfsBackend.query:88` は `text` 検索で `Math.min(q.limit ?? 100, 100000)` (`fts:100000`)
- `IdbVfsBackend.query:169` で plain `query` は `Math.min(q.limit ?? 100, 1000)` (`plain:1000`)
- `crudHandlers:25` は `limit=20` と固定
- `FallbackStorage:251` は cap なしで `slice` のみ

`100000` は FTS5 の `trigram` 検索で必要な cap だが、plain `query` で `100000` を許すと `Fallback` の `Array.filter` で10万件を JS でソートしメモリと UI スレッドをブロックする。

## 決定
- `LIMIT` は `fts:100000 / plain:1000` の2種を温存する。
- `QuerySpec` は `cap: { fts: 100000, plain: 1000 }` の形で両者を明示的に保持する。
- `QueryPlanner.buildQuerySpec` は `shouldUseFts5(fts5Available, bareText)` の結果で `limit = Math.min(q.limit ?? 100, fts ? cap.fts : cap.plain)` を選択する。
- `MAX_QUERY_LIMIT = 100000` は `src/offscreen/queryPlan.ts` の `QUERY_CAPS` として SSOT 化するが、`plain` の `1000` は別名 `QUERY_PLAIN_LIMIT` として併記する。

## 結果
- `Idb`/`OPFS`/`Fallback` の3者で同じ `limit` 意味を保証できる。
- `Fallback` の DoS リスクを回避しつつ、FTS の `trigram` 検索で必要な `100000` を維持できる。
- `QueryPlanner` は純粋関数 `buildQuerySpec(query, {caps, fts5Available})` としてテスト可能。

## 参照
- `src/offscreen/IdbVfsBackend.ts:88,169`
- `src/offscreen/opfsWorker/searchHandlers.ts:12-21`
- `src/offscreen/storageFallback.ts:251`
- PBI-12: `pbi/2026-08-27-12-feat-unify-sqlite-storage-backend.md`
