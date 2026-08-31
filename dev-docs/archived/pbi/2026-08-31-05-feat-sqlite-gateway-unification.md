# PBI: SQLite Gateway 統一 — 二重 RPC と 3-Backend extraWhereSql 同期負債の解消

## ユーザーストーリー
開発者として、SQLite への全アクセスを単一の深い Module `SqliteGateway`（`query / mutate / maintain / status`）に統一したい。なぜなら現在 `SqliteClient.callInternal` と `dashboardSqliteService.callDashboard` が同じ RPC を二重実装し Result 型が乖離（`SqliteRpcResult vs ServiceResult`）、3 backends（IdbVfs / OpfsWorker / storageFallback）が `extraWhereSql` を各自で再実装しコメント `keep in sync` が人手同期を要求、しかも dashboard → SW → offscreen → engine → backend の 5 hops を追わないと一つの query を理解できないから。

## 優先度
- 順位: 05 / 06
- RICEスコア: **113**（Reach=250 / Impact=1.5 / Confidence=0.6 / Effort=2）
  - Reach 250: SQLite を使うユーザー（browsing/search）と dashboard 全体。頻度は中
  - Impact 1.5: 中。WHERE 句不整合（FTS vs LIKE）の再発防止と Result 型統一。既存 bug の顕在度は低め
  - Confidence 0.6: 3 backends の差異と offscreen transport の非同期性で工数不確実
  - Effort 2: 2 人週（Gateway 統一 + queryPlan 集約 + Backend seam 分割 + transport Adapter 化）
- 根拠: RICE 5 位。01-04 より Reach/Impact が低く、Worth exploring。ただし FTS/LIKE 不一致の再発リスクは中長期で Locality が効く。
- 依存: なし（独立）。ただし 01 Settings の `sqliteHealthCheck` 注入が Gateway 経由に整理されるとより綺麗。

## 背景 / なぜなぜ分析
- 表層: `IdbVfsBackend.ts:60 keep extraWhereSql in sync` コメントが残る
- なぜ1: 3 backends が `buildWhereClause` を各自で実装し、`created_at>=?` / `domain=?` / `ids IN` + FTS suffix `b.domain` の差分が手動で同期される
- なぜ2: `StorageBackend` Interface が 14 methods で肥大し、caller は 2-3 method しか使わないのに全体を学ぶ（shallow）
- なぜ3: `SqliteClient` と `dashboardSqliteService` が `categorizeError` を共有しつつ wording が乖離し、`isServiceError` guard が dashboard 側だけにある
- なぜ4: Transport（`msgOffscreen` / `chrome.runtime.sendMessage DASHBOARD_SQLITE`）が Gateway と密結合し、テストで offscreen まで立ち上げる必要がある
- 解: `SqliteGateway` 4 methods + 統一 `SqliteResult<T>`。`extraWhereSql / clampLimit / buildQuerySpec` を `queryPlan` に集約。Backend は `Queryable` と `Mutable` の小さな Seam に分割。Transport は Adapter として外出し。

## BDD受け入れシナリオ

Scenario: 単一 Gateway で query が成功する
  Given 初期化済みの `SqliteGateway`（Idb または OPFS のいずれか）
  When  `gateway.query({ domain: 'example.com', limit: 10 })` を呼ぶ
  Then  `queryPlan.buildQuerySpec` で WHERE 句が生成され、選択された backend で実行される
  And   Result は `{ ok: true, data: rows }` の統一型で返る（`SqliteRpcResult` / `ServiceResult` の乖離なし）

Scenario: FTS と LIKE の WHERE 句が同一 source から生成される
  Given `queryPlan.buildQuerySpec({ q: 'テスト', fts: true })` と `fts: false` の 2 パターン
  When  それぞれを Idb / OPFS / fallback の 3 backends で実行する
  Then  `extraWhereSql` の差分は `queryPlan` の 1 箇所で定義され、3 backends の差異による検索結果の不一致が起きない

Scenario: エラー時に統一 Result で categorize される
  Given `gateway.mutate({ type: 'insert', record: oversized })` が `MAX_AI_RESPONSE_BYTES` 超で失敗する
  When  エラーが返る
  Then  `{ ok: false, error: { kind: 'PayloadTooLarge', retryable: false } }` が統一 `SqliteError` で返り、dashboard と SW で同じ文言が表示される

Scenario: 境界 — limit clamp が gateway で一元化される
  Given `gateway.query({ limit: NaN })` / `limit: -5` / `limit: 999999`
  When  query を実行する
  Then  `clampLimit` が `queryPlan` で 1 回だけ適用され、backend 側の再 clamp は不要になる
  And   fts: 100000 / plain: 1000 の cap が守られる

Scenario: Transport が Adapter として差し替え可能
  Given テストで `InMemoryTransport` を注入した `SqliteGateway`
  When  `gateway.status()` を呼ぶ
  Then  offscreen や chrome.runtime を起動せずに `status` が返る
  And   本番は `OffscreenTransport` Adapter が同じ Seam で動作する

## 受け入れ基準
- [x] `SqliteGateway` が `query / mutate / maintain / status` の 4 methods と統一 `SqliteResult<T> = {success:true,data} | {success:false,error:SqliteError}` を公開する（実装上のキーは `ok` ではなく `success`）
- [x] `SqliteClient` と `dashboardSqliteService` の二重 RPC 実装が Gateway に統合され、呼び出し元が Gateway（`SqliteGateway` / `DashboardSqliteGateway`）に委譲する shim に縮小
- [x] `buildExtraWhereSql` / `clampLimit` / `buildQuerySpec` が `queryPlan.ts` 1 ファイルに集約され、`IdbVfsBackend` / `opfsWorker/searchHandlers` の個別実装が削除される
- [x] `StorageBackend` が `Queryable` と `Mutable` の 2 facet に分割される
- [x] `categorizeError` が Gateway 経由で一元化され、dashboard/SW の 2 hop が同一分類（dashboard 失敗レスポンスの二重 categorize を修正）。live な `isServiceError` は `dashboardSqliteService.ts` の 1 箇所。`BrowsingLogRepository.ts` の同名定義は PR #87 由来の未接続コード（consumer / test なし）で、本 PBI の対象外 → 別途「dead code 整理」として扱う
- [x] Transport は `OffscreenTransport` interface として抽出済み。adapter は `ChromeOffscreenTransport`（本番）と `InMemoryTransport`（`src/background/inMemoryTransport.ts` — stateful な in-memory store。offscreen / chrome.* を起動せず insert→query→count→status が round-trip する）の 2 実装
- [x] `sqliteClient` / `dashboardSqliteService` / `IdbVfsBackend` のテストが Gateway 経由で green

## テスト戦略
- E2E: dashboard で browsing log の search / query / status が成功し、offscreen の OPFS/IDB/fallback のいずれでも同一結果
- 統合: 3 backends × FTS/LIKE の組合せで同一 WHERE 句、limit clamp の一元化、統一 Result の categorize、Transport Adapter 差し替え
- 単体: `queryPlan.buildQuerySpec` の WHERE 生成、clampLimit 境界（NaN/0/負/上限超）、`SqliteError` の retryable 判定

## 見積もり
5 pt（要チームでの見積もり）— Gateway 統一 2pt + queryPlan 集約 1pt + Backend seam 分割 1pt + Transport Adapter 化 1pt

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（offscreen / dashboard / background の影響確認 — 2026-09-01）
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md §5.4 に Unified gateway / Query plan / Backend facets を追記。ADR 2026-06-17 opfs-fts5-coexistence は VFS/FTS5 エンジン選定の ADR で RPC 層は対象外のため追記せず）
- [x] `npm run validate` が green

## フォローアップ（本 PBI 対象外）
- `src/dashboard/BrowsingLogRepository.ts`（PR #87 由来、consumer / test なし、296 行）を wire-up するか削除するかの判断。`ServiceResult` / `isServiceError` の重複はこの dead code に由来する

## 実装メモ（任意）
- `SqliteClient` は互換 shim として一時残し、内部で Gateway に委譲。`getSharedSqliteClient()` は Gateway の singleton を返す形に段階移行
- `storageFallback` は `Queryable` + `Mutable` の両方を満たすが、テストでは `InMemoryTransport` で代替可能にする
- `dashboardSqliteService` の `withConfirmToken` / `tokenExempt` は Gateway の前段 middleware として残し、Gateway 自体は token を知らない
