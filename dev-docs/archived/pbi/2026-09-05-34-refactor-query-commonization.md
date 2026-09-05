# PBI: IdbVfsBackend / opfsWorker ハンドラのクエリ共通化（クエリ実装の単一化）

優先度: スパイク推奨 PBI-C2（M・1 週間前後） / RICE: 保守性のみのため参考値なし
backlog: [dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md](../dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md)（重複候補 1・最大の重複、PBI-C2 切り出し案）
依存: **PBI 33（VfsStrategy 整合）の着地後**に着手すること（C1 → C2 の順）

## ユーザーストーリー
SQLite 永続化層を保守する開発者として、IDB 直 exec（`IdbVfsBackend`）と OPFS Worker ハンドラ（`opfsWorker/searchHandlers` + `crudHandlers`）の SQL 組み立てを共通ビルダーに寄せてほしい、なぜなら同一操作の別実装が並存すると検索ソート・purge 条件の drift が静かに発生し、バックエンドごとに検索結果が変わるから。

## 現状（スパイク調査済み）
- 最大の重複: `src/offscreen/IdbVfsBackend.ts`（434 行・直 exec）と `src/offscreen/opfsWorker/*Handlers`（CRUD + search + audit + purge）が同一操作を別実装
- テストも対応ごとに分離: `IdbVfsBackend-search-sort` / `opfsWorker-search-sort` / `storageFallback-search-sort`（3 系統）
- 共通基盤の先行例: `src/offscreen/queryPlan.ts`（`buildQuerySpec` / `QUERY_CAPS` / `matchesExtraWhere`）が既に 3 系統で共有されている — 本 PBI はこれを拡張して SQL 組み立て全体を寄せる
- 注意（スパイク発見）: FTS evoke 条件と LIKE フォールバック境界、purge 条件、`DELETE` のセマンティクス（InMemoryTransport はソフトデリート・製品 fallback はハードデリート）の差分を取り違えると検索結果が変わる

## BDD受け入れシナリオ
```gherkin
Scenario: 同一クエリ仕様がどのバックエンドでも同じ行集合を返す
  Given 同一のレコード集合を各バックエンドに投入する
  When  同一の QuerySpec（search/sort/purge）を発行する
  Then  opfs / idb / fallback / InMemoryTransport の全系統が同一の結果順序を返す

Scenario: 既存の検索挙動は不変である
  Given 既存の 3 系統 search-sort テストスイート
  When  共通ビルダー導入後に実行する
  Then  全テストが green である（振る舞い変更なし）
```

## 受け入れ基準
- [x] `IdbVfsBackend` と `opfsWorker` ハンドラの WHERE/ORDER/LIMIT 組み立てが `queryPlan.ts` 拡張の共通ビルダーに寄せられている
- [x] 3 系統の search-sort テストが共通のパラメトリックテストに統合されている（重複定義の解消）
- [x] FTS evoke 条件・LIKE フォールバック境界の差分が意図的である場合、コメントまたはテストで明示されている
- [x] 全テスト green（振る舞い変更なし）

## テスト戦略
- 3 系統を 1 つのパラメトリックテスト（バックエンドをパラメータ化）に統合し、差分を先に可視化してから共通化する
- 回帰: 全 suite green + bench:micro（検索系の計測変化がないこと）

## 見積もり
1 週間前後（M）

## 実装者向け注記
- 調査: スパイク `dev-docs/dig-findings-2026-09-05-sqlite-backend-consolidation.md`（重複候補 1）
- 確認コマンド: `rg -n "buildQuerySpec|matchesExtraWhere" src/offscreen/`、3 系統 search-sort テストの所在確認
- 注意: `InMemoryTransport` はテスト専用（ソフトデリート乖離あり）。統合の対象にするか乖離を明示するかは実装時に判断して記録すること
- 後続: Option B（IDB 層廃止）は fallback-only 到達率の測定が前提（判断保留・本 PBI とは独立）

## Definition of Done
- [x] 全BDDシナリオがパスする
- [x] コードレビュー完了
- [x] ドキュメント更新（スパイクレポートの重複候補 1 に完了印）

## 実装メモ（2026-09-05・branch 0905c）
- 完了（commit `a331dc80`、SDD サブエージェント実装・タスクレビュー Approved）。差分可視化テスト（query-backends-parametric）が初回 3 件 RED を検出したが、レビューの裁定で全て parity（COUNT alias・rank AS・テスト文言由来）と確認 — 製品振る舞いの drift は無し。`queryPlan.ts` に `buildFtsSearchStatements` / `buildLikeSearchStatements` / `buildPlainListStatements` / `buildPurgeOldRecordsStatements` / `buildContentPurgeStatements` / `buildAuditLogStatements` 等を新設し、IdbVfsBackend と opfsWorker ハンドラを slimmer 化。FTS evoke / LIKE 境界 / `#tag` ギャップ / audit cap の意図的差分は INTENTIONAL テストで固定。3 系統 search-sort テストをパラメトリック統合（旧ファイル削除）。bench:micro PASS。全 suite 11,668 tests green。
- 残置（Minor・意図的）: `handleGetCount` の COUNT 文面重複（用途別のため共有見送り）。
