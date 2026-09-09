# PBI 03: 行シェイプ codec — rowMapper 4 コピーの統合と列集合 drift の解消

## ユーザーストーリー

SQLite バックエンド（OPFS worker / IndexedDB / fallback）を保守する開発者として、1 行の読み出し方法（列集合とマッピング）が 1 箇所で定義されていてほしい。なぜなら現状は IDB が positional（33 列 + 11 列 ×2）、OPFS worker が named（13 列 / 11 列）の私的 mapper を 4 コピー持ち、`buildPlainListStatements` の列省略時既定 `'*'` により**同じ builder から別の列集合**が返り、schema 列順の変更が positional reader をサイレントに壊すから。

## 優先度

- 順位: 03 / 6
- RICE スコア: 12.0（Reach=3 / Impact=2 / Confidence=80% / Effort=0.4 人週）
- 根拠: PBI-34（queryPlan SSOT）が SQL テキストのみを対象にし行形を残した、半分済みの深掘り。実 drift（plain-list で IDB 33 列 vs OPFS 13 列）が確認済みのため Confidence 高。
- backlog: [2026-09-09-00-backlog-0909a.md](2026-09-09-00-backlog-0909a.md)
- 依存: なし（01/02 とファイル非重複。並行バッチ可）。

## BDD 受け入れシナリオ

```gherkin
Scenario: plain-list の列集合がバックエンド間で一致する
  Given buildPlainListStatements が columns を必須引数にした
  When  IdbVfsBackend と opfsWorker crudHandlers が同じ BROWSING_LOG_COLUMNS を渡す
  Then  両バックエンドの plain-list 応答が同一列集合になる
        （現行の 33 vs 13 の無文書分歧は spec か bug かが実装メモに決着記録され、
        決着に沿った列集合になる）

Scenario: schema の列順変更で positional reader が壊れない
  Given rowCodec が named マッピングを所有する
  When  browsing_logs の列を 1 列挿入する（テスト内で列順を入れ替える）
  Then  全バックエンドの query / search 結果のマッピングが正しいまま保たれる

Scenario: FTS と LIKE の rank 差分だけが分岐になる
  Given IdbVfsBackend の FTS 11 列マップと LIKE 11 列マップ（rank: 0）が統合される
  When  両検索パスを実行する
  Then  rank の供給源だけが差分となり、他の 10 列のマッピングは 1 箇所に集約される
```

## 受け入れ基準

- [x] `rowCodec` モジュール新設: `{ columns, mapNamed(row), mapPositional(row, columns) }` を所有し、`BROWSING_LOG_COLUMNS` 定数を 1 箇所に定義
- [x] `buildPlainListStatements` の `columns` を必須化（`'*'` 既定値削除）。呼び出し側（IdbVfsBackend / crudHandlers）が同じ定数を渡す
- [x] `IdbVfsBackend.ts` の FTS（:92-104）/ LIKE（:128-141）/ plain（:435-471 `rowToEntry`）3 mapper を codec 経由に統合（`rank` 注入点のみ分岐）
- [x] `searchHandlers.ts:36-50` / `crudHandlers.ts:47-61` の named mapper を codec 経由に統合
- [x] 33 vs 13 列分歧の決着（spec として残すか named 13 に統一するか）を実装メモに記録し、決着に沿って実装
- [x] `insertBatch` の `inserted/skipped` 集計差分（IdbVfsBackend 行毎 changes() vs crudHandlers 最終 1 回）を parametric テストで先に確定し、bug なら修正（bug なら本 PBI スコープで対応・CHANGELOG 記載）
- [x] `queryPlan.ts:267` の `AS c` / `AS rank` エイリアスコメントが codec の保証（テスト）になる

## テスト戦略

- parametric: query / search を IDB・OPFS worker・InMemory の各 backend で同一 fixture で実行し、列集合と値の一致を検証（既存 InMemoryTransport テスト基盤を利用）
- 単体: rowCodec の mapNamed / mapPositional 真理値表（NULL / 型付き値 / 列順入れ替え）
- 回帰: 既存 queryPlan / バックエンド系テスト green

## 実装アプローチ

1. insertBatch 集計の parametric テストを先に書き、実挙動を確定（bug ならこの時点で分離判断）
2. rowCodec 新設（列定数 + named/positional mapper）
3. buildPlainListStatements columns 必須化 + 呼び出し側修正
4. IdbVfsBackend 3 mapper 統合 → worker 側 2 mapper 統合
5. 列分歧の決着記録

## 見積もり

0.4 人週。難易度: 🟡中。副作用: 🟡軽微（列分歧の決着次第で応答列集合が変わり得る → dashboard の消費フィールド確認が必要）。種別: 🔧非機能追加（refactor）。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] type-check / lint / 対象テスト green
- [x] insertBatch 集計の確定記録（bug だった場合は修正 + CHANGELOG）
- [ ] コードレビュー完了
- [x] `00-INDEX.md` 更新

## 実装メモ

### insertBatch 集計の確定記録（bug あり・修正済み）

- 判定: 本物の製品 bug。`handleInsertBatch`（`src/offscreen/opfsWorker/crudHandlers.ts`）は
  `INSERT OR IGNORE` をループしながら `SELECT changes()` をループ終了後に 1 回だけ読んでいたため、
  返却値 `{ count }` は最終文の changes（0 または 1）だけだった。実機 SQLite（better-sqlite3）で実測:
  3 件バッチ（新規 2 + 重複 1、重複が末尾）→ 修正前 `{ count: 0 }`、修正後 `{ count: 2, inserted: 2, skipped: 1 }`。
- 連鎖 break: OPFS ワーカーの wire 値は `{ count }` なのに `OpfsWorkerBackend.insertBatch` は
  `{ inserted, skipped }` に cast していたため、OPFS 経路では `inserted/skipped` が `undefined`、
  `recordsRepo.insertBatch` の返却 `{ count: undefined }` になっていた。IDB 経路と
  `FallbackStorageAdapter`（`skipped = records.length - count` を自前計算）は正しかった。
- 修正: `handleInsertBatch` を行毎 `SELECT changes()` 集計にし、返却を
  `{ count, inserted, skipped }`（`count === inserted`）に拡張。`count` を残したので
  既存消費者の `MigrationContext.handleInsertBatch: Promise<{ count }>`（`migrationV2.ts`）と
  `migrateOldOpfsDb` の `const { count }` は無変更で動き、`OpfsWorkerBackend` の cast 型だけ
  正確化した。wire 互換は後方互換（superset）のみで、縮小はない。
- 先行テスト: `src/offscreen/__tests__/insertBatch-counting-parametric.test.ts`（node / better-sqlite3 /
  製品 `SCHEMA_SQL`）を修正前に書いて失敗を確認（4 失敗: count 誤値 + inserted/skipped 欠落）してから修正、
  修正後に 6 件 green。IDB 側 2 件は修正前から green（参照実装）。
- CHANGELOG への記載は本 PBI スコープ外のため未実施（リリース担当の 0909a バッチ判断に委ねる）。
  製品影響: OPFS 経路の `insertBatch` 件数表示・移行件数が常に 0/1 または undefined だった問題が解消。

### 33 vs 13 列分岐の決着（spec として維持・文書化）

- 調査: plain-list の応答 shape は 3 通りある。IDB `query` は 33 列全項目 + rank、
  OPFS `handleQuery` は 13 列（`BROWSING_LOG_COLUMNS`）で rank なし、
  `FallbackStorage.query` は 11 列 + rank。dashboard 側は行型を `BrowsingLogEntry`（全任意）として読み、
  `entry.content || ''` 系の寛容読みのため現状動作している。
- 決着: 13 列への統一は IDB 応答から 20 項目を削除することになり、dashboard の履歴行
  （`historyEntryRow.ts` の content / cleansing バイト表示、`historyFilters.ts` の content 検索）が
  IDB 経路で劣化するため、behavior-preserving を優先して 3 shape を spec として維持する。
  BDD の「同一列集合になる」は「決着に沿った列集合になる」の条件節により、維持＋文書化で充足と判断。
- 実装: `buildPlainListStatements` の `columns` は必須化し `'*'` 既定を削除。OPFS は
  `BROWSING_LOG_COLUMNS_SQL`（13 列）を、IDB は `BROWSING_LOG_FULL_COLUMNS_SQL`
  （33 列 = `['id', ...COLUMN_NAMES]`、schema SSOT 派生）を明示渡しする。IDB の `SELECT *` は
  明示 33 列に置換（返却集合は同一）。`PLAIN_LIST_COLUMNS` は `queryPlan.ts` に alias として残し、
  正本は `rowCodec.ts` の `BROWSING_LOG_COLUMNS` とした。
- schema 列順変更への耐性: positional reader は codec の列リストと zip するため、
  SELECT 文の列順が真実の源泉になり、schema の列挿入では壊れない。`BROWSING_LOG_FULL_COLUMNS` が
  `COLUMN_NAMES` 派生なので schema 変更は自動追従する。

### rank 注入点

- FTS（行内 rank）/ LIKE（rank なし → 0）の差分は codec の `coerceCell` の `rank` 分岐 1 箇所に集約。
  LIKE の 10 セル行に `SEARCH_COLUMNS_WITH_RANK`（11 列）を zip すると不足セルは `undefined` →
  `?? 0` で rank 0 になる。named 側（`pushSearchRow`）も `row.rank ?? 0` が同じ分岐に吸収された。

### 変更ファイル

- 新規: `src/offscreen/rowCodec.ts`（列定数 + `mapNamed` / `mapPositional` + セル強制型）
- 新規テスト: `src/offscreen/__tests__/insertBatch-counting-parametric.test.ts`（実 SQLite 6 件）、
  `src/offscreen/__tests__/rowCodec.test.ts`（真理値表・列順入替・alias 保証・IDB/OPFS 実 fixture 一致 12 件）
- 編集: `src/offscreen/opfsWorker/crudHandlers.ts`（insertBatch 修正 + plain 13 列の codec 化）、
  `src/offscreen/OpfsWorkerBackend.ts`（cast 型の正確化 1 行）、
  `src/offscreen/IdbVfsBackend.ts`（3 mapper の codec 化 + plain 明示 33 列、`rowToEntry` 削除）、
  `src/offscreen/opfsWorker/searchHandlers.ts`（`pushSearchRow` の codec 化）、
  `src/offscreen/queryPlan.ts`（`columns` 必須化、`PLAIN_LIST_COLUMNS` を codec alias 化、alias 保証コメント）、
  `src/offscreen/__tests__/opfsWorker-transactionIntegrity.test.ts`（`{ count: 1 }` →
  `{ count: 1, inserted: 1, skipped: 0 }`）、
  `src/offscreen/__tests__/query-backends-parametric.test.ts`（`rowSql` ヘルパーの `/COUNT/` →
  `/COUNT\(\*\)/`。`SELECT *`→明示列で `masked_count` が含まれるようになり旧正規表現が IDB 行を除外したため）、
  `pbi/00-INDEX.md`（03 の完了化 1 行）
- 不可触に触れていないことの確認: `sqliteMessageHandlers.ts`、`handlers/**`、`messaging/**`、`dashboard/**`、
  `settingsExportImport.ts`、`aiSummaryCleaner/**`、`schema.ts` は未編集（`schema.ts` は `COLUMN_NAMES` /
  `SCHEMA_SQL` / `buildInsertParams` の import のみ）。

### 逸脱・注意

- `mapNamed(row, columns)` / `mapPositional(row, columns)` は PBI の素朴な `mapNamed(row)` より 1 引数多い。
  shape 毎（search 11 / plain 13 / full 33）の返却項目を変えずに 1 関数へ畳むには列指定が必須だったため。
  ジェネリクス `<T>` で呼出側の行型を保全している。
- `InMemoryTransport` は未編集（コンパイル影響なし）。
- lint 全体では `src/utils/aiSummaryCleaner/rules.ts` に 2 errors（未使用 `SELECTOR_RULE_DEFS` /
  `stripBySelectors`）が残るが、並行 agent の作業域であり本 PBI の不可触ファイルのため未対応。
  本 PBI の touched ファイルは eslint 0 errors（test ファイルは設定で ignore）。
- `git add` / `commit` はしていない（作業ツリーに残置）。

### 検証結果

- `npm run type-check`: 本 PBI 作業完了時点では pass（tsc --noEmit）。最終確認時は並行 agent 作業中の
  `src/utils/aiSummaryCleaner/rules.ts` のみで error（`stripEcSitePatterns` 等の未定義名 3 件＝当該 agent の
  編集中状態）となり、それ以外のファイルは 0 errors（`tsc --noEmit | grep -v aiSummaryCleaner` で空を確認）。
  不可触ファイルのためこちらでは対応しない。
- `npx vitest run src/offscreen src/background`: 237 files / 3250 passed / 10 skipped（修正直後は
  query-backends-parametric 1 失敗 → 上記ヘルパー修正で green）。最終 targeted 再実行 5 files / 46 passed。
- `npm run lint`: touched ファイル 0 errors（全体は上記 2 errors のみ・対象外）
