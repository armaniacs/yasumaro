# PBI: SEARCH_COLUMNS を実 SELECT 幅に一致させ IDB search の cell 誤配置を塞ぐ

## ユーザーストーリー

dashboard の検索保守担当者として、IDB フォールバック経路の FTS search 行が正しくデコードされてほしい。位置 zip がズレて rank 値が nav_source_url に流れ込み rank=0 になるから。

## 優先度

- 順位: 1/17
- RICE: 12.0（R4 / I3 / C1.0 / E1）
- 根拠: 実データ破壊（IDB 経路の wire 上の garbage）＋ codec の列境界一意所有化
- 依存: なし（NN05/NN10 がこの境界を先行前提とする）

## 背景（file:line 現状）

- `src/offscreen/rowCodec.ts:23-46` — SEARCH_COLUMNS は 13 列（`nav_source_url`:41 / `search_query`:42 含む）、`SEARCH_COLUMNS_WITH_RANK`（:46）は 14 名
- `src/offscreen/queryPlan.ts:500` — FTS rows SQL は 12 セル（`rank` は index 11）。`:535` — LIKE rows SQL は 11 セル
- `src/offscreen/IdbVfsBackend.ts:76` — `mapPositional(row, SEARCH_COLUMNS_WITH_RANK)` が 12 セル行を 14 名と zip
- 影響: IDB FTS 経路で `nav_source_url` = String(rank)、`search_query` = null、`rank` = 0
- pin テストの隙間: `sqliteBackendParity.realEngine.test.ts:95-98` の SHARED_FIELDS が rank/nav_source_url/search_query を除外、`rowCodec.test.ts:106-108` は codec 順の 14 セル手作り fixture

## BDD受け入れシナリオ

```gherkin
Scenario: IDB 経路の FTS search で rank が正しく入る
  Given OPFS Worker が利用できない状態で FTS search を実行する
  When 行をデコードする
  Then rank が SQL の rank 値と一致し nav_source_url は null である

Scenario: plain listing の 33 列投影は変わらない
  Given plain listing を実行する
  When 行をデコードする
  Then nav_source_url / search_query / is_deleted / obsidian_synced / gist_synced が従来通り入る
```

## 受け入れ基準

- [x] `nav_source_url` / `search_query` を SEARCH_COLUMNS から外し、BROWSING_LOG_COLUMNS 側に置く（plain 投影は 33 列のまま）
- [x] SEARCH_COLUMNS_WITH_RANK が FTS SELECT 幅（12）と一致する
- [x] LIKE 既定 `rank=0` の pin は維持
- [x] rowCodec テストの期待値を実 SELECT 順に更新し、pin テストの古いコメントを直す
- [x] 実エンジン parity テストに `rows[0].rank !== 0`（FTS 経路）の pin を追加
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: `src/offscreen/__tests__/rowCodec.test.ts`（codec 順 → SQL 順に修正）+ parity 実エンジン pin
- fixture 先行: 12 セル実 SQL 順 fixture で現バグを再現してから直す
- 配置: `src/**/__tests__/`、fixture は `testDir/storageMock.ts` を再利用、実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [x] 手動確認: 実ブラウザで IDB フォールバックは通常発生しないため自動 pin のみで DoD とする

## 実装記録

- 変更ファイル: `src/offscreen/rowCodec.ts`（SEARCH_COLUMNS を実 SELECT 幅 11 列に再構成）/ `src/offscreen/__tests__/rowCodec.test.ts`（実 SELECT 順 fixture）/ `src/offscreen/__tests__/sqliteBackendParity.realEngine.test.ts`（FTS rank pin）/ `src/offscreen/__tests__/opfs-search-skeleton-pin.test.ts`
- ゲート: 対象 59 tests green / type-check PASS / lint PASS / validate PASS（15785 tests）
