# PBI: アーカイブ手動テスト 部分的に自動化できる項目（R5・R6・G6）

## ユーザーストーリー

yasumaro の開発者として、`docs/MANUAL_TEST_ARCHIVE.md` の R5・R6・G6 について、既に自動テストでカバーされている範囲を明文化し、実環境でしか確認できない上乗せ部分だけを最小コストで E2E 化してほしい。なぜなら、これらは「元の手順そのまま」だと E2E 化できない（OS 使用量取得・offscreen 寿命制御・プロセスキル）が、**検証したい本質のロジックは既に vitest でカバー済み**で、手動チェックリストに残す必要がほぼ無いから。

## 前提: 現状カバレッジの調査結果（重要）

着手前の調査で、R5・R6・G6 の**核心ロジックは既存 vitest テストでカバー済み**と判明した:

| # | 既存カバレッジ | ファイル:内容 |
|---|--------------|-------------|
| R5 VACUUM 領域解放 | ✅ freelist before/after のロジック | `src/offscreen/__tests__/archivePurgeHandlers.test.ts` — `makeMainEngine` が `PRAGMA freelist_count` のシーケンスをモックし、`handleArchiveDeleteByStaging` が VACUUM をトランザクション外で実行して freelist を報告することを検証。VACUUM 失敗時の `vacuumOk=false` も `it('keeps the main DB intact when VACUUM fails')` でカバー |
| R6 fail-closed | ✅ レジストリ消失・meta 不一致・incoming kind | 同ファイル — `it('fails closed when the staging is not registered (re-preview required)')`、`it('fails closed when the file meta disagrees with the registry')`、`it('fails closed on incoming staging')`。いずれも本体 DB 無傷を assert |
| R6 quota 不足 | ✅ | 同ファイル — `it('rejects before the DELETE when quota is insufficient')` |
| R6 single-flight | ✅ | 同ファイル — `it('blocks a second concurrent purge (single-flight)')` |
| G6 孤児掃除 | ✅ 孤児削除 + 除外セット保護 | `src/offscreen/__tests__/archiveStaging.test.ts:95` — `describe('sweepOrphanStagings')` / `it('removes orphan staging files but protects the excluded set')` |

**結論**: R5・R6・G6 は新規テストをほぼ必要としない。本PBIの作業は (1) 上記カバレッジを PBI 完了メモと手動テスト文書に明記する (2) 実 OPFS・実 SQLite での freelist 減少を **E2E 1本だけ**上乗せする (3) 手動チェックリストから R5・R6・G6 の大部分を削除、に絞る。

## スコープ

| # | 本PBIでやること | 手動に残す（削除しない）部分 |
|---|--------------|---------------------|
| R5 | 実 OPFS + 実 SQLite で Phase B を実行し、`archive_delete_by_staging` 応答の `freelistAfter < freelistBefore` と `vacuumOk:true` を E2E で1回だけ確認（モック済みロジックが実エンジンでも成立することの担保）。ファイルサイズ減少は**検証しない**（`@subframe7536/sqlite-wasm` の OPFS VFS が truncate コミットする保証がない） | `chrome://settings` のサイトデータ総量表示の目視のみ（🟢 に降格）。ブラウザ UI 表示は E2E から取得不可 |
| R6 | 既存 vitest カバレッジで十分。**新規テスト無し**。手動文書に「fail-closed ロジックは `archivePurgeHandlers.test.ts` でカバー」と明記 | 「実 offscreen が破棄されたときにインメモリレジストリが実際に揮発する」前提の確認のみ（offscreen 寿命は E2E から強制不可） |
| G6 | 既存 vitest カバレッジで十分。**新規テスト無し**。カバーされていないケース（複数孤児・incoming/outgoing 両方）があれば `archiveStaging.test.ts` に1〜2ケース追加 | 「実プロセスキル → 拡張再起動 → 起動時に `sweepOrphanStagings()` が呼ばれる」通しのみ（プロセスキルは E2E から再現困難） |

## BDD受け入れシナリオ

```gherkin
Feature: R5 の実エンジン上乗せ確認

Scenario: 実 OPFS SQLite で Phase B 後に freelist が減る
  Given 実拡張・実 OPFS 環境で、削除で freelist が生じる程度の件数を seed し Phase A を実行した
  When archive_delete_by_staging（confirmToken + staging scopeHash 付き）を実行する
  Then 応答の freelistAfter が freelistBefore より小さい
  And 応答に vacuumOk:true が含まれる
  And archive_preview の件数が削除件数分だけ減っている
```

R6・G6 は新規シナリオ無し（既存 vitest がカバー）。

## 受け入れ基準

- [x] `testDir/e2e/dashboard-archive.spec.ts`（既存ファイル）に R5 の1シナリオを**追記**する（新規 spec ファイルは作らない。既存の archive 往復テストの末尾に足すのが CI 実行時間・重複 seed の点で最適）
  - seed 件数は「実エンジンで `freelist_count` の減少が観測できる最小値」を実測して決め、コメントで根拠を残す
- [x] `src/offscreen/__tests__/archiveStaging.test.ts` の `sweepOrphanStagings` テストを確認し、複数孤児・incoming と outgoing の混在ケースが無ければ1〜2ケース追加（あればスキップ可）→ 1ケース追加
- [x] `docs/MANUAL_TEST_ARCHIVE.md` を更新:
  - R5 を 🔴必須 から削除し、「freelist 減少は自動テスト（vitest + E2E 1本）でカバー。`chrome://settings` の総量目視のみ 🟢 で残す」に置換
  - R6 を 🔴必須 から削除し、「fail-closed ロジックは `archivePurgeHandlers.test.ts` の4ケースでカバー。実 offscreen 揮発の前提確認のみ 🟢 で残す」に置換
  - G6 を「掃除ロジックは `archiveStaging.test.ts` でカバー。実プロセスキル通しのみ 🟢 で残す」に更新
- [x] PBI 完了メモに、R5/R6/G6 の既存カバレッジ（ファイル名 + `it()` 名）を一覧で記録

## テスト戦略（t_wadaスタイル）

### E2E（`dashboard-archive.spec.ts` に追記）
- R5: 実エンジンでの freelist 減少 + `vacuumOk:true` + preview 件数減少

### 既存 vitest（変更なし・カバレッジを明文化するのみ）
- R6: `archivePurgeHandlers.test.ts`（fail-closed 4ケース）
- R5 ロジック: `archivePurgeHandlers.test.ts`（freelist before/after・vacuumOk）
- G6: `archiveStaging.test.ts`（`sweepOrphanStagings`）

### 追加 vitest（不足時のみ）
- `archiveStaging.test.ts`: 複数孤児・kind 混在の sweep

## 実装コンテキスト（他エージェント向け・着手前に必読）

### なぜ subtype を新設しないか

`archive_delete_by_staging` を1つ足したとき touch されたファイルは **18ファイル**（`sqliteOperationSecurity.ts` の `ALL_DASHBOARD_SQLITE_SUBTYPES` + グループ + scope マップ、`sqliteMessages.ts`、`sqliteRpcClient.ts`、`dashboardSqliteProtocol.ts`、`archiveSubtypes.ts`、`archiveHandler.ts`、`deps.ts`、`offscreenGateway.ts`、`dbMaintenance.ts`、`OpfsWorkerBackend.ts`、`StorageBackend.ts`、`IdbVfsBackend.ts`、`FallbackStorageAdapter.ts`、`sqliteMessageHandlers.ts`、`opfsWorker.ts`、`opfsWorker/types.ts`、`inMemoryTransport.ts`、`validators.ts`）。さらに起動時パーティション assert（`src/background/handlers/dashboardSqlite/index.ts:12-30`）が「全 subtype が過不足なく1グループに属する」を検査するため、更新漏れは**起動エラー**になる。

R5 の E2E は既存の `archive_delete_by_staging` 応答（`{ ..., freelistBefore, freelistAfter, vacuumOk, deleted, remaining }`）をそのまま assert するだけなので、テスト専用 subtype は不要。

### R5 の E2E の書き方（`dashboard-archive.spec.ts` パターン）

既存の `dashboard-archive.spec.ts:40-191` が「seed → Phase A → restore → Phase A 再実行 → Phase B（purge）→ 件数0確認」を通している。**この末尾の Phase B（`archive_delete_by_staging`）の応答から `freelistBefore` / `freelistAfter` / `vacuumOk` を取り出して assert を足すだけ**でよい（`:160-169` あたり）。

現状の spec は `purgeRes.deleted` しか見ていない。追加:
```ts
expect(Number(purgeRes.freelistAfter)).toBeLessThan(Number(purgeRes.freelistBefore));
expect(purgeRes.vacuumOk).toBe(true);
```
seed 3件では freelist が動かない可能性があるため、**R5 用に seed 件数を増やした専用テストケースを1つ足す**（既存の3件テストは変更しない）。

### confirmToken / scopeHash

`archive_delete_by_staging` は `'staging'` scope（`sqliteOperationSecurity.ts:ARCHIVE_SCOPE_BY_SUBTYPE`、parts = `[stagingName]`）。既存 spec の `tokenFor('archive_delete_by_staging', [stagingName])` がそのまま使える（`dashboard-archive.spec.ts:160`）。

### `archivePurgeHandlers.test.ts` の既存 seam（G6 追加テスト用）

- `resetArchiveStagingForTesting()`（`beforeEach` で呼ぶ、`:138`）
- `setArchiveStagingDirProviderForTesting(async () => fakeDir)`（`:149`）で OPFS をフェイク
- `prepareOutgoing()` → `updateStagingRecord(name, { cutoffMs, includeDeleted, maxIdAtArchive, recordCount })` で staging を登録
- `makeMainEngine({ deleted, freelist: [before, after], remaining, vacuumError })` でメインエンジンをモック

`archiveStaging.test.ts` は `fakeDir.files`（`Map`）に直接エントリを置いて `sweepOrphanStagings` を呼ぶ（`:105-124` 参照）。

## 実装アプローチ

- **Outside-In**: R5 の E2E を Red で書き、既存 `archive_delete_by_staging` 応答に必要なフィールドが揃っているか確認してから assert を確定
- R6・G6 は既存カバレッジの確認 → 不足があれば vitest 追加 → 手動文書更新

## 見積もり

1pt（要チームでの見積もり）— R5 の E2E 1シナリオ追記 + 手動文書更新 + カバレッジ明文化。既存 vitest がほぼ全てをカバーしているため小さい

## 技術的考慮事項

- **依存関係**: 2026-09-07-01 の `archiveDbReader.ts` は使わない（R5 は応答フィールドの assert のみ）。2026-09-06-02/04 完了済み。**01 と並行着手可**
- **CI 実行時間**: `dashboard-archive.spec.ts` への追記1ケースのみ。新規 spec ファイルを作らないので影響は最小

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "freelistBefore\|freelistAfter\|vacuumOk\|deleted\|remaining" src/offscreen/opfsWorker/archivePurgeHandlers.ts
grep -n "it('fails closed\|it('rejects before\|it('keeps the main DB\|it('blocks a second" src/offscreen/__tests__/archivePurgeHandlers.test.ts
grep -n "describe('sweepOrphanStagings\|it(" src/offscreen/__tests__/archiveStaging.test.ts
sed -n '145,191p' testDir/e2e/dashboard-archive.spec.ts   # 既存 Phase B の呼び出し
```

### 実装手順
1. 既存 vitest（`archivePurgeHandlers.test.ts` / `archiveStaging.test.ts`）を読み、R5/R6/G6 のカバレッジを確認・一覧化
2. `dashboard-archive.spec.ts` に R5 用ケース（seed 件数増・freelist 減少 assert）を追記。Red 確認
3. G6 の不足ケース（複数孤児・kind 混在）があれば `archiveStaging.test.ts` に追加
4. Green → リファクタリング
5. `docs/MANUAL_TEST_ARCHIVE.md` の R5/R6/G6 を更新（大部分削除、実環境前提のみ 🟢 で残す）

### 落とし穴
- **R5 のファイルサイズは検証しない**: `@subframe7536/sqlite-wasm` の OPFS VFS が VACUUM 後にファイルを truncate コミットするとは限らない。`freelist_count` の減少のみを assert する
- **seed 件数**: 3件では freelist が動かない。実測で「freelist が確実に減る」件数を決める（数百件〜。E2E タイムアウト 60s 内に収める）
- **既存の3件テストを壊さない**: R5 用は別ケースとして追加する
- **subtype を足さない**: 18 ファイル改修 + 起動時パーティション assert 対応が必要（上記「なぜ subtype を新設しないか」）

## Definition of Done

- [x] R5 の E2E ケースが `dashboard-archive.spec.ts` に追記され `npm run test:e2e:ci` でグリーン
- [x] R6/G6 の既存カバレッジが PBI 完了メモに一覧化されている
- [x] G6 の不足ケースがあれば `archiveStaging.test.ts` に追加済み（incoming/outgoing 混在の複数孤児ケースを1ケース追加）
- [x] `npm run validate` が通る
- [x] コードレビュー完了
- [x] `docs/MANUAL_TEST_ARCHIVE.md` 更新済み（R5/R6/G6 の大部分を削除、実環境前提のみ 🟢 で残す、既存カバレッジのファイル名を明記）

## 完了メモ（2026-09-07）

### 既存カバレッジ一覧（ファイル名 + it() 名）

**R5（VACUUM 領域解放）— `src/offscreen/__tests__/archivePurgeHandlers.test.ts`**
- `deletes with the 3-condition predicate and runs VACUUM outside the transaction`（freelist before/after の報告）
- `keeps the main DB intact when VACUUM fails (vacuumOk=false)`

**R6 fail-closed（同ファイル・5ケース）**
- `fails closed when the staging is not registered (re-preview required)`
- `fails closed when the file meta disagrees with the registry`
- `fails closed on incoming staging (restore flow must not be purged)`
- `rejects before the DELETE when quota is insufficient`
- `blocks a second concurrent purge (single-flight)`

**G6 孤児掃除 — `src/offscreen/__tests__/archiveStaging.test.ts` `describe('sweepOrphanStagings')`**
- `removes orphan staging files but protects the excluded set`
- `protects staging files registered by the current session even without explicit exclude`
- `sweeps multiple orphans of both kinds (incoming + outgoing) in one pass`（本PBIで追加 — 複数孤児×両kindが未カバーだった）

### R5 の E2E 実測メモ

- seed 3件では `freelistBefore=0/freelistAfter=0`（実測。既存テストの PURGE-RES ログで確認）→ freelist 減少の観測には「VACUUM 前に空きページが存在する」ことが必要
- 採用した設計: 太い行（summary 1KB）×300件を seed → `clear_all`（VACUUM 無しの DELETE で freelist が確保される）→ 3件を再 seed → Phase A → Phase B。`freelistBefore > 0`・`freelistAfter < freelistBefore`・`vacuumOk:true` を実エンジンで確認
- なお VACUUM 後の OPFS エンジンは freelist を 0 に戻すことも実測済み（既存ログ `freelistBefore:0, freelistAfter:0`）

