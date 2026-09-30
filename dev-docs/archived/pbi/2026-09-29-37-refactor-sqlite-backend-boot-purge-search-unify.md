# PBI: SQLite 2 バックエンドの統合（DB_FILENAME SSOT・boot 共通化・purge 計数一致・searchExecution の IDB 適用）

種別: refactor
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ4）。OPFS worker 版と IDB VFS 版が同一ライブラリ `@subframe7536/sqlite-wasm` の VFS 差のみで並走しており、ファイル名・boot 手順・CRUD・検索骨格・purge 計数・transaction カバレッジが 6 項目で 2 実装に分裂している。

## ユーザーストーリー

SQLite 永続化 layer を 1 人で保守する開発者として、スキーマ・検索式・purge ロジックの修正を 1 箇所の変更で行い、バックエンドをまたいで片方だけが古いまま残る状態を持たないようにする。加えて、purge 結果を UI に表示する運用者として、どちらのバックエンドでも「実際に消えた行数」が返る状態を目指す。

## 優先度

- 順位: 7 / 10
- RICE スコア: 2.4（Reach=4 / Impact=1.5 / Confidence=80% / Effort=2.0）
- 根拠: PBI 38 と同点 2.4 だが、本件は purge 計数の意味乖離により「実際に消えた行数」の報告がバックエンドによって真偽が異なるという正確性の欠陥を含み、リスク軽減効果で先行させる。用户可視挙動の大半は不変の refactor なので Impact は 1.5 に留める。Confidence 80% は parity テストの既存 `dashboardSqliteMock` 規約があるためだが、`searchExecution` を IDB 側へ適用する段階では位置づけの不整合が出る可能性があるため。

## 現状と問題（file:line 証拠付き）

### 1. DB ファイル名の 5 重宣言

- `DB_FILENAME` の宣言が 5 箇所: `src/offscreen/sqliteEngineContext/idbEngineLifecycle.ts:16` / `src/offscreen/opfsWorker.ts:98` / `src/offscreen/opfsWorker/backupHandlers.ts:11` / `src/offscreen/opfsWorker/statusHandlers.ts:9` / `src/messaging/sqliteMessages.ts:159`（`LEGACY_OPFS_DB_FILENAME`）
- 同じリテラル `'yasumaro.db'` を別々に持っており、ファイル名を変更するときに 5 箇所の追随が必要

### 2. boot 手順の乖離

- `idbEngineLifecycle.ts:31-69` と `opfsWorker.ts:139-167` が同一の手順（WAL → schema → migrations → compile options）を別実装で持つ
- `PRAGMA wal_autocheckpoint=1000;` は IDB 側のみ（`idbEngineLifecycle.ts:37`、worker 側に欠落）
- migration engine アダプタの null 合体も異なる: `opfsWorker.ts:152` は `v !== undefined` 判定、`idbEngineLifecycle.ts:49` は `value != null` 判定で、`null` 入力時の結果が揃わない

### 3. CRUD の 2 実装

- `IdbVfsBackend.ts:42-50` / `:182-227` / `:407-413` と `opfsWorker/crudHandlers.ts:17-103` に同等の処理が重複
- `crudHandlers.ts:65` がコメント「Whitelist validation — same as IdbVfsBackend.update()」と自認しており、正本は片側だと認識されている

### 4. 検索骨格の 2 実装

- `IdbVfsBackend.ts:71-180` と `src/offscreen/searchExecution.ts:75-114` に検索の骨格が二重に存在する
- `searchExecution.ts:13-18` は「IdbVfsBackend is intentionally NOT migrated」と明記しており、統一意思はあるが未着手

### 5. purge 計数の意味乖離

- IDB 側は実行行数（`IdbVfsBackend.ts:288` の `SELECT changes()` 後に `totalPurged += changes2`）
- worker 側は算出超過（`opfsWorker/purgeHandlers.ts:88` の `totalPurged += excess`、`:85-87` に自認コメントあり）。`purgeHandlers.ts:41` / `:50` は `SELECT changes()` を使っているのに対し、超過パスのみ算出値

### 6. transaction カバレッジの不統一

- `purgeHandlers.ts:37` は `withTransaction` で wrap、`purgeHandlers.ts:61-93`（`handleContentPurge`）は未 wrap
- `IdbVfsBackend.ts:58`（`insertBatch`）は wrap、`IdbVfsBackend.ts:263-294`（`purgeContent`）は未 wrap

### 良い先例

- `withTransaction` は中立実装 1 本（`src/offscreen/sqliteTransaction.ts:23`）+ 2 行アダプタ（`IdbVfsBackend.ts:58` / `opfsWorker/handlers.ts:38-40`）。本件 6 項目はすべて同型で落とせる

## 改善方針（方向性）

1. `DB_FILENAME` を 1 モジュールに集約する。legacy 名は別定義として明示して許容する
2. boot 共通関数を `sqliteEngine.ts` 側に新設する（`withTransaction` と同型の中立実装 + 各側アダプタ）。`wal_autocheckpoint` の実行差と null 合体の判定差をここで吸収する
3. `searchExecution` を IDB 側にも適用し、`searchExecution.ts:13-18` の注記を更新する
4. purge 計数を実行行数（`SELECT changes()`）に統一する
5. transaction の wrap / 非 wrap の対応を purge 全体で揃える
6. スコープの境界: wa-sqlite サンセット（`pbi/2026-09-05-32-refactor-wasqlite-sunset.md`）は別スコープ。2 エンジンは同ライブラリ `@subframe7536/sqlite-wasm` の VFS 差のみで、統合の前提は既に整っている

## BDD 受け入れシナリオ

```gherkin
Scenario: purge 計数が両 backend で一致する
  Given 同一データに対して purgeOldRecords を実行する
  When opfs と IDB それぞれの結果を比較する
  Then purged 数が一致する

Scenario: DB ファイル名の単一宣言
  Given リポジトリ全体を検索する
  When DB_FILENAME 相当リテラルを探す
  Then 定義は 1 箇所のみ（legacy 名は別定義として許容）

Scenario: boot 手順が共通化されている
  Given IDB バックエンドと OPFS バックエンドをそれぞれ初期化する
  When 実行された PRAGMA と migration 呼び出しを観測する
  Then 初期化直後の schema と migrations の到達点が同じである
```

## 受け入れ基準

- [x] `DB_FILENAME` の宣言が 1 箇所に集約され、`LEGACY_OPFS_DB_FILENAME` が別定義として明示されている
- [x] `PRAGMA wal_autocheckpoint=1000;` が両バックエンドの boot で実行される
- [x] migration engine アダプタの null 合体判定が単一実装に揃っている
- [x] `searchExecution` が IDB 側にも適用され、`searchExecution.ts:13-18` の未移行注記が更新または削除されている
- [x] purge の purged 数が両バックエンドで実行行数として一致する
- [x] purge 全体（`purgeHandlers.ts` / `IdbVfsBackend.ts`）で transaction の wrap 方針が統一されている
- [x] 検索・CRUD のユーザー可視挙動が変わっていないことを parity テストで示している
- [x] wa-sqlite サンセット PBI（`pbi/2026-09-05-32-refactor-wasqlite-sunset.md`）とスコープが重複していない

## テスト戦略

- 統合: opfs / IDB 両経路の parity テスト（既存 `dashboardSqliteMock` 規約）+ purge 計数の parity
- 単体: boot 共通関数の pragma 差分 pin（両バックエンドで同じ PRAGMA が実行されることの固定）
- E2E: 不要（バックエンド内部構造の整理のみでユーザー可視挙動は不変）

## 実装記録（2026-09-29）

### 追加したモジュール

- `src/offscreen/dbFilename.ts` — `DB_FILENAME` の単一宣言。`LEGACY_OPFS_DB_FILENAME` は `src/messaging/sqliteMessages.ts` に残し、名前を変えない旨をコメントで固定。
- `src/offscreen/sqliteBoot.ts` — 両 VFS 共通の boot 手順。`BOOT_PRAGMAS`（`journal_mode=WAL` → `wal_autocheckpoint=1000`）、`BOOT_SCHEMA_SQL`、`createMigrationEngine()`（null 合体）、`bootSqliteEngine()`（pragma → schema → migration → compile options）。各バックエンド固有の後処理（IDB の migration backup/restore、worker の runMigrationV2）とエラー方針は呼び出し側に残した。

### 変更したファイル

- `src/offscreen/sqliteEngineContext/idbEngineLifecycle.ts` — `DB_FILENAME` を import し `sqliteEngineHost` / `migrationBackup` 互換のため re-export のみ維持。boot 本体を `bootSqliteEngine()` に委譲。compile options の `String(Object.values(row)[0] ?? '')` も同じ実装に揃えた（`?? ''` 側へ統一。空値は発生しないが 2 実装を残す理由がない）。
- `src/offscreen/opfsWorker.ts` — 同上。boot を `bootSqliteEngine()` に委譲し、migration engine アダプタを削除。
- `src/offscreen/opfsWorker/backupHandlers.ts` / `statusHandlers.ts` — `DB_FILENAME` を import。
- `src/offscreen/searchExecution.ts` — `runOpfsSearch(ctx, ...)` をバックエンド中立の `runSearch({ reader, input, query, limit, offset, orderBy, orderDir, onInvalid, extraQualification, fts5Available })` に置換。`opfsWorker/handlers.js` への import をやめたので、`IdbVfsBackend` から中性モジュールとして参照できる。旧ヘッダの「IdbVfsBackend is intentionally NOT migrated」注記は、未統一として残した 3 点（行形状 / invalid-order 方針 / 別名投影の要否）を明記する形に更新。
- `src/offscreen/opfsWorker/searchHandlers.ts` — worker 側の `SearchRowSource`（named row / `row.c` / `mapNamed`）と `runOpfsSearch` を担うようにした。生成 SQL は不変。
- `src/offscreen/IdbVfsBackend.ts` — FTS / LIKE 両パスを `runSearch()` に委譲（`searchRowSource` = positional row / `row[0]` / `mapPositional`、`extraQualification: 'per-path'`）。purge 3 種を `withTransaction(this.transaction, ...)` で wrap。`clearAll` は wrap しない（理由下記）。
- `src/offscreen/opfsWorker/purgeHandlers.ts` — `handleContentPurge` の cap パスを `SELECT changes()` 計数に変更（算出超過の加算をやめる）、`handleContentPurge` / `handleAuditLogPurge` を transaction wrap。ファイル冒頭に transaction 方針と計数規則の WHY を記載。
- `src/offscreen/queryPlan.ts` — `buildExtraWhereSql` の引数型を `ExtraWhereQuery` として切り出し（`searchExecution` から再利用）。`buildContentPurgeStatements` の計数注記を「両バックエンドとも changes()」へ更新。

### transaction 方針の決定

**「purge は 1 操作 = 1 transaction。唯一の例外は `clearAll`」** を両バックエンドで採用した。

- 理由: purge は必ず「書き込みの合間に読む」— `SELECT changes()` が報告値を決め、cap 経路の `COUNT(*)` が次の文の LIMIT を決める。記録が 2 文の間に入り込めば、報告した件数と実際に消した集合が別のスナップショットを，也就は嘘になる。wrap しないとその窓が開く。
- 例外 `clearAll`: 読み書きが絡まない無条件 DELETE の列で、transaction で得られる一貫性がない。IDB 側は末尾の `PRAGMA wal_checkpoint(TRUNCATE)` が transaction 内で失敗するため、wrap すると片側だけ別の挙動になる。
- 適用先: `purgeOldRecords` / `purgeContent` / `purgeAuditLog` を両バックエンドで wrap。`insertBatch` は元から両側 wrap 済みで据え置き。

### 決定，并未統一として固定したもの

- **FTS の別名投影**: FTS 文は `browsing_logs AS b` と JOIN するので、フィルタ列には `b.` が必要。IDB は per-path で付与し、worker は付けない（従来どおりの SQL）。1 つの projection を両パスに流すと LIKE 側で `no such column: b.is_deleted` になる。shared skeleton には `extraQualification: 'per-path' | 'none'` という方針引数として明示し、生成 SQL が一致しないことは parity テストで pin した。
- **invalid-order 方針**: worker は `coerce`、IDB は `error` のまま。`buildSearchOrderClause` の `onInvalid` 引数で受け渡すようにした。
- **plain listing の投影幅**: IDB 33 列 / worker 13 列は response shape として意図的に違う（rowCodec.ts の記載どおり）。parity テストは共有列だけ比較する。

### テスト

- `src/offscreen/__tests__/sqliteBackendUnification.test.ts`（16 tests, 新規）— スタブエンジン。ファイル名の単一宣言を `src/**/*.ts` の grep で固定、boot 手順の逐語一致（STATUS の行数取得は boot 外なので `PRAGMA compile_options` までを比較）、`createMigrationEngine` の null / undefined → null、purge 計数（`changes()` を算出超過とは異なる値で返し、両側がエンジン値をそのまま報告することを要求）、purge 3 種の transaction wrap と `clearAll` の非 wrap、search の文・バインド・行一致。
- `src/offscreen/__tests__/sqliteBackendParity.realEngine.test.ts`（15 tests, 新規）— better-sqlite3 の実エンジンで両バックエンドを production boot 経路から駆動。検索 6 ケース + FTS 経路の同定 + plain listing、CRUD（insert / batch 重複 / update / star / delete / count）、purge（content cap / content age / record cap / age+cap / starred 保護 / clear_all）。BDD の「purged 数が一致する」シナリオを実データで担保。
- 既存の byte 単位 SQL スナップショット（`opfs-search-skeleton-pin.test.ts`）は無改変で green のまま = 検索のユーザー可視挙動と SQL 文字列は変わっていない。

### コマンドと結果

```
npx vitest run src/offscreen src/messaging   # 122 files / 1596 tests passed
npx vitest run src/__tests__                  # 6 files / 121 tests passed (11 skipped)
npx vitest run src/offscreen/__tests__/sqliteBackendUnification.test.ts \
                src/offscreen/__tests__/sqliteBackendParity.realEngine.test.ts --repeats=20
                                               # 31 tests passed（20 回反復）
npx tsc --noEmit                              # エラーなし
npx eslint src/offscreen/                     # エラーなし（既存の warning 10 件のみ、変更ファイル由来ではない）
```

差分確認のため `purgeHandlers.ts` の 2 修正（算出超過加算・transaction 化）を一時的に戻して再実行し、新規テストの該当 3 件が落ちることを確認してから戻した（RED 確認）。

### 逸脱

- `queryPlan.ts` の `buildExtraWhereSql` の引数型をインライン `Pick<...>` から `ExtraWhereQuery` として切り出した。shared skeleton からの参照に必要なためで、runtime の挙動は同じ。
- 受け入れ基準 3 の null 合体統一に伴い、compile options の `String(...)` も `?? ''` 側に寄せた（3 節）。
- 受け入れ基準 5 の parity は、実エンジン上では計数差が発生しない（cap の副クエリが `content IS NOT NULL` で絞るため excess と changes() が一致する）。判定力を持つのはスタブ版（`changes()` を excess と異なる値で返す）なので、これを回帰 pin とし、実エンジン版は BDD シナリオの担保として并存させている。
- `npm run validate` とコードレビューは Definition of Done 上未実施（指示に従い未実行）。

## 見積もり

2.0 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了
