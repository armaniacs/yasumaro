# PBI: アーカイブからメインDBへの復元（マージ再取り込み）

## ユーザーストーリー

yasumaroのユーザーとして、アーカイブ.db の内容をメインDBへ再取り込み（復元）したい。なぜなら、アーカイブした過去データを再び日常的に参照する必要が生じたとき、「退避してもいつでも戻せる」という保証が完成して初めて、アーカイブ（＝本体からの削除）を安心して実行できるから。

## ビジネス価値

- **データ非喪失の保証**: 「アーカイブ → 必要なら復元」の往復が成立し、アーカイブ実行の心理的ハードルが下がる
- **測定方法**: 復元後の `get_count` 増分 = 復元件数。重複レコードはスキップされ、二重取り込みが発生しないこと

## BDD受け入れシナリオ

```gherkin
Feature: アーカイブからの復元

Scenario: アーカイブの全レコードをメインDBへ復元する
  Given アーカイブ.db に100件のレコードがある
  And メインDBにアーカイブと重複しないレコードがある
  When 復元を実行して確認トークンを渡す
  Then メインDBのレコード数は100件増える
  And 結果に「復元 100 件・スキップ 0 件」が表示される
  And 復元されたレコードがメインDBの検索でヒットする

Scenario: メインDBに既に存在するレコードは重複取り込みしない
  Given アーカイブ.db の一部のレコードがメインDBにも存在する（同じ url + created_at）
  When 復元を実行する
  Then 既存のレコードはスキップされ、存在しないものだけが追加される
  And 結果に「復元 N 件・スキップ M 件」が表示される

Scenario: 無効なファイルでは復元しない
  Given ユーザーが browsing_logs を含まないSQLiteファイルを選んだ
  When 復元を実行する
  Then エラーが表示される
  And メインDBは1件も変更されない

Scenario: 確認トークンなしでは実行できない
  Given 有効なアーカイブ.db が選択されている
  When 有効な確認トークンなしで復元操作が送信される
  Then 操作は拒否され、メインDBは変更されない
```

## 受け入れ基準

- [x] ファイル選択 → プレビュー（`yasumaro_archive_meta` の表示: レコード件数・対象期間・アーカイブ作成日時・**削除済み行を含むか（include_deleted）**）→ 確認トークン付き実行 → 結果表示（復元件数 / スキップ件数、is_deleted を含む場合はアクティブ・削除済みの内訳）のUIがある
- [x] 重複判定は `UNIQUE(url, created_at)` に基づく（`INSERT OR IGNORE` 相当）
- [x] 復元レコードは**新しい id で追加される**（アーカイブ内の元 id を引き継がない）
- [x] 復元されたレコードの FTS 索引が更新される（メインDBの INSERT トリガーに依存）
- [x] obsidian_synced / gist_synced などフラグ列はアーカイブ時点の値を保持する（再同期によるObsidian重複書き込みを起こさない）
- [x] 大きなアーカイブでも転送できるよう、dashboard は選択ファイルを OPFS ステージング（`archive_incoming_<nonce>.db`）へ書き込み、メッセージは**ファイル名のみ**を運ぶ（バイト列のbase64転送は10MB上限に触れるため使わない — deep-dig 2026-09-06 決定）
- [x] 実行前にアーカイブのバリデーションを完了させ、失敗時はメインDBを一切変更しない。バリデーションには**トリガーを含まないこと**を含める（ユーザー指定ファイルは信頼できない入力。`restore_db` の検証と同一の fail-closed 方針）
- [x] i18n（en/ja）がすべての新規UI文言に適用されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- アーカイブ作成 → 復元の往復で件数が元に戻ることを画面越しに確認（PBI-02のE2Eと組み合わせ）

### 統合テスト
- 重複スキップ（url + created_at が完全一致する既存行は更新されず保持される）
- 復元後の FTS 検索ヒット
- 大容量アーカイブ（例: 10万件）での復元が長時間トランザクションでもタイムアウト・部分更新なしに完結すること
- 無効ファイル・トリガー含有ファイル・トークンなしの拒否
- ステージングファイル（`archive_incoming_*.db`）が実行後・失敗後に残らないこと

### 単体テスト
- id 再採番（元 id を復元時に含めないことの検証）
- meta 検証・表示用整形
- 結果集計（restored / skipped カウント）
- 例外ハンドリング: 復元の途中失敗でメインDBが部分更新されないこと

## 実装アプローチ

- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり

3pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: PBI-02 が定義するアーカイブファイル形式に依存。**PBI-05（一時オープン・編集）には依存しない** — 編集されていないアーカイブの復元は本PBI単独で完結する。PBI-05で編集されたアーカイブも同様に復元できる
- **テスタビリティ**: 復元ハンドラは `sqliteTestApi.js` パターンで実SQLiteテスト。ステージング経由のため行・バイト列ともメッセージに載らず転送上限は不要。JSON import のバリデータ（`src/messaging/validators.ts` の `MAX_IMPORT_ROWS` / `MAX_IMPORT_BYTES`）は設計参照
- **非機能要件**: 大容量アーカイブの転送時間とメインDB書き込み時間（進捗表示）。破壊的操作ではないがメインDBを変化させるため、confirmToken 必須。CSP遵守・MV3遵守・`async/await`

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# JSONインポート（マージ取り込み）の既存経路 — チャンクとバリデータの流用元
grep -rn "importLogs\|'import'" src/background/ src/dashboard/ src/messaging/ | grep -v test
# INSERT OR IGNORE（重複判定の基盤）
grep -rn "INSERT_IGNORE_SQL\|INSERT OR IGNORE" src/offscreen/
# メッセージサイズ上限
grep -rn "MAX_IMPORT_ROWS\|MAX_IMPORT_BYTES" src/messaging/
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。
（2026-09-06 作成時点の調査結果: SQLiteファイルからの復元（マージ）は未実装。既存の import は HMAC 署名付き JSON 限定。`restoreDb` は全体上書きで用途が異なる）

### 実装手順
1. E2EテストをRedで書く（ファイル選択→プレビュー→実行→件数確認）
2. 統合テストをRedで書く（重複スキップ・FTSヒット・大容量完結・無効ファイル拒否・トークン拒否・ステージング掃除）
3. offscreen/opfsWorker に `RESTORE_ARCHIVE`（仮称）ハンドラを追加:
   - dashboard が選択ファイルを OPFS ステージング（`archive_incoming_<nonce>.db`）へ書き込み、メッセージは**ファイル名のみ** → `createEngine` → バリデーション（PBI-05の手順3と同一パターン: `browsing_logs` + `yasumaro_archive_meta` 存在 + **トリガー数 0**。`createEngine` はDDLフリー（sqliteEngine.ts:47-51）でメイン初期化ヘルパー（opfsWorker.ts:116-120）は流用しない。共通化を検討）
   - 一時エンジンから `SELECT`（id を除く全カラム + `buildInsertParams` 相当のマッピング）→ メインエンジンへ `INSERT OR IGNORE`（INSERT_IGNORE_SQL 流用。id は含めない）
   - 結果集計（changes から restored / skipped を算出）→ 一時ファイル削除（finally）
4. メッセージ経路の追加: `sqliteMessages.ts` / `sqliteRpcClient.ts`（MaintainOp）/ `dashboardSqliteProtocol.ts`（subtype）/ `sqliteOperationSecurity.ts`（`ALL_DASHBOARD_SQLITE_SUBTYPES` に追加・tokenExempt には入れない＝デフォルトで**トークン必須**）/ `validators.ts`（転送上限の設計参照）/ `dashboardSqlite/maintenanceBatchHandler.ts`（**`MAINTENANCE_BATCH_SUBTYPES` への追加が必須 — router はこの Set から dispatch を導出する**）
5. ダッシュボードUI: アーカイブセクションに「メインDBへ復元」。プレビュー（meta表示）→ confirmToken（`create_confirm_token`）→ 実行 → 結果表示
6. i18n（en/ja）
7. Green → リファクタリング（PBI-05と一時エンジン生成・バリデーションの共通化）

### 落とし穴
- **元 id の引き継ぎ禁止**: アーカイブの id をそのまま INSERT すると、メインDBの PRIMARY KEY 衝突で「url も created_at も異なる別レコード」が誤ってスキップされる。id は必ず再採番（AUTOINCREMENT）に任せる
- **FTS トリガーはメインDB側で自動発火**: `browsing_logs_ai` トリガーが INSERT 時に FTS を更新する。復元側で FTS を手動更新しない（二重索引になる）
- **同期フラグの扱い**: obsidian_synced=1 のまま復元するため Obsidian への再書き込みは起きない。再同期したいユーザーには既存の `resync_legacy` を案内する
- **編集済みレコードの扱い**: PBI-05で url を変更したレコードは、復元時に「新しい記録」として追加される（元の記録との重複判定が成立しない。なお `created_at` は既存 `UPDATABLE_FIELDS` に含まれないためアーカイブ編集では変更不可）。仕様としてドキュメントに明記する
- **削除済み行の復元**: PBI-02で「削除済み行を含める」をチェックしたアーカイブは is_deleted=1 の行を持つ。フラグ保持のまま復元するため表示には出ないが本体容量を占める。結果表示に内訳（アクティブ / 削除済み）を出してユーザーが把握できるようにする
- **転送されるのはファイル名のみ**: 行の SELECT（一時エンジン）と INSERT（メインエンジン）はどちらも offscreen 内で完結する。アーカイブ.db も OPFS ステージング経由で渡すため、バイト列・行ともメッセージに載らない（deep-dig 2026-09-06 決定）。JSON import の rows-per-request（`MAX_IMPORT_ROWS` / `MAX_IMPORT_BYTES`）は設計参照であり流用先ではない
- **外部由来のアーカイブは信頼できない入力**: メインDBの CHECK 制約（is_starred / scroll_ratio / visit_duration）は INSERT 時に発火するが、url スキームの検証は CHECK にない。既存メッセージバリデータ（http/https 以外を拒否）と同等の検証を INSERT 前に適用する
- **部分更新の禁止**: 検証（バリデーション）→ 取り込みの順序を厳守し、取り込みは1トランザクションにする（ステージング方式のため行転送のチャンクは存在しない）。途中失敗でメインDBが部分更新されないことを統合テストで担保

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate`（型チェック + テスト + lint）が通る
- [x] テストカバレッジが基準を満たす（E2E / 統合 / 単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み: `docs/SETUP_GUIDE.md`（復元節）、`CHANGELOG.md`

---

## 設計ノート（レビュー依頼用 / 2026-09-06 作成、feature-dev スキルによるコードベース精査後）

> このセクションは実装前のレビューを受けるためのもの。実装はまだ着手していない。
> 共通基盤（メッセージ経路、archive.db 形式、`validateArchiveEngine`、ステージング掃除、10秒タイムアウト問題、第2エンジンのスパイク）は **PBI-02 §A〜§F および PBI-05 §F2 を参照**。ここでは PBI-03 固有の設計を書く。

### A. PBI-03 固有の精査結果

| # | 事実 | 出典 | 影響 |
|---|------|------|------|
| A3-1 | **`INSERT_IGNORE_SQL` は既存**。`INSERT OR IGNORE INTO browsing_logs (${INSERT_COLS}) ...`。`INSERT_COLS` は `COLUMN_NAMES`（**id を含まない**）。`UNIQUE(url, created_at)` に基づき重複を無視 | `src/offscreen/schema.ts:130-131`、`SCHEMA_SQL:43` | 復元は `INSERT_IGNORE_SQL` + `buildInsertParams`（id 除外）をそのまま流用。**id 再採番は「INSERT 文に id 列を含めない」だけで自動的に達成される**（`id INTEGER PRIMARY KEY AUTOINCREMENT`）。archive.db 側の SELECT で id 列を取得しても、INSERT 側に渡さなければよい |
| A3-2 | **`SELECT changes()` で挿入件数が取れる**。`insertBatch` は `INSERT OR IGNORE` をループ後に `SELECT changes() AS c` で「最後の 1 文の変更行数」を見ている（これは正しくない — ループ内の合計ではない）。IdbVfsBackend は各 INSERT 直後に `SELECT changes()` | `src/offscreen/opfsWorker/crudHandlers.ts:113-141`、`IdbVfsBackend.ts:50-52` | **復元件数の集計は 1 件ずつ `SELECT changes()` を見る**か、`SELECT COUNT(*) FROM browsing_logs` の前後差分を取る。`crudHandlers.ts:134` の `changes()` パターンは**バグ的**なので流用しない。restored / skipped は「INSERT 試行数 = archive の SELECT 件数」「restored = 前後の COUNT 差分」「skipped = 試行数 − restored」で算出 |
| A3-3 | **URL スキーム検証は CHECK 制約にない**。`SCHEMA_SQL` の CHECK は `visit_duration >= 0` / `scroll_ratio 0..1` / `is_starred/is_deleted IN (0,1)` のみ。`url` は `TEXT NOT NULL` だけ。http/https 制限はメッセージバリデータ（`validators.ts:257-259`）が担当 | `src/offscreen/schema.ts:9-44`、`src/messaging/validators.ts:254-263` | **外部由来のアーカイブは信頼できない入力**（PBI 落とし穴）。復元前に各行の `url` を `new URL(url)` + `['http:','https:'].includes(protocol)` で検証。`javascript:` / `data:` スキームを弾く。`validators.ts` の `ManualRecordValidator` と同等ロジックを `archiveHandlers` 側で適用 |
| A3-4 | **FTS トリガー `browsing_logs_ai` はメインDB の INSERT で自動発火**。復元で `INSERT OR IGNORE` すると FTS 索引が自動更新される | `src/offscreen/schema.ts:331-334` | 復元側で FTS を手動更新しない（二重索引になる、PBI 落とし穴）。IGNORE された行はトリガーも発火しないので整合が取れる |
| A3-5 | **同期フラグ列は `buildInsertParams` でそのまま渡る**。`obsidian_synced` / `gist_synced` は `record.obsidian_synced ?? 0` | `src/offscreen/schema.ts:210-211` | archive.db が持つ `obsidian_synced=1` はそのまま復元される → Obsidian への再書き込みは起きない（PBI 受け入れ基準・落とし穴）。archive.db 側の SELECT で `obsidian_synced` / `gist_synced` を取得して `buildInsertParams` に渡す |
| A3-6 | **`is_deleted` も `buildInsertParams` で渡る**（`record.is_deleted ?? 0`）。PBI-02 で「削除済み行を含める」にチェックしたアーカイブは `is_deleted=1` の行を持つ | 同上 | フラグ保持のまま復元。表示には出ないが本体容量を占める。結果表示に「アクティブ N 件 / 削除済み M 件」の内訳（PBI 受け入れ基準・落とし穴） |
| A3-7 | **転送はステージング経由（PBI-02 §A-1, A-2）**。dashboard が選択ファイルを `archive_incoming_<nonce>.db` へ書き、メッセージはファイル名のみ。行の SELECT（第2エンジン）も INSERT（メインエンジン）も offscreen 内で完結 → バイト列・行ともメッセージに載らない | deep-dig 2026-09-06 | `MAX_IMPORT_ROWS` / `MAX_IMPORT_BYTES`（`validators.ts:49,51`）は**設計参照であり流用先ではない**（PBI 落とし穴）。行のチャンク転送は存在しない |
| A3-8 | **`confirmToken` は破壊的操作ではないが必須**。メインDB を変化させる（件数が増える）ため。送信側自動添付（PBI-02 §A-5） | PBI 技術的考慮事項 | `archive_restore` を `TOKEN_EXEMPT_OPS` に入れない。BDD「確認トークンなしでは実行できない」は `sqlite-security-integrity.test.ts` のマトリクスに 1 行追加 |

### B. PBI-03 のアーキテクチャ

```
┌─ dashboard ─────────────────────────────────────────────────────┐
│  archivePanel.ts に「メインDBへ復元」セクション追加               │
│    ├─ <input type="file" accept=".db"> でファイル選択            │
│    │    → file.size チェック（PBI-05 §C2-5 と同じ上限）          │
│    │    → file.arrayBuffer() → archiveStagingService が          │
│    │       OPFS の archive_incoming_<nonce>.db へ書き込み        │
│    ├─ プレビュー: archive_restore_preview { stagingName }        │
│    │    → validateArchiveEngine() + meta 読み取り                │
│    │    → { recordCount, cutoffDate, archivedAt, includeDeleted }│
│    ├─ 確認: archive_restore { stagingName }（トークン自動添付）   │
│    │    → 結果 { restored, skipped, restoredActive, restoredDeleted }│
│    └─ 結果表示                                                   │
└─────────────────────────────────────────────────────────────────┘
             │ 経路は PBI-02 §B と同じ
             ▼ opfsWorker/archiveRestoreHandlers.ts
    ARCHIVE_RESTORE_PREVIEW:
      createEngine(archive_incoming_<nonce>.db) → validateArchiveEngine()
      → yasumaro_archive_meta 読み取り → close → 結果返す
    ARCHIVE_RESTORE:
      1. createEngine(archive_incoming_<nonce>.db)  ← 第2エンジン
      2. validateArchiveEngine()  ← browsing_logs + yasumaro_archive_meta + トリガー0
      3. メインエンジンで SELECT COUNT(*) → countBefore
      4. 1 トランザクション内で:
         第2エンジンから SELECT (COLUMN_NAMES 相当、id 除外) FROM browsing_logs ORDER BY id
         各行: url を http/https 検証（A3-3）→ 不正なら skip カウント
              → メインエンジンへ INSERT_IGNORE_SQL + buildInsertParams(row, domain)
      5. メインエンジンで SELECT COUNT(*) → countAfter
      6. restored = countAfter - countBefore
         restoredDeleted = 復元行のうち is_deleted=1 だった数
         restoredActive = restored - restoredDeleted
         skipped = SELECT件数 - restored（重複 + url不正の合計）
      7. 第2エンジン close → archive_incoming_<nonce>.db 削除（finally）
      8. wal_checkpoint 不要（メイン INSERT のみ、既存トリガーが FTS 更新）
```

**新規ファイル**: `src/offscreen/opfsWorker/archiveRestoreHandlers.ts` に `handleArchiveRestorePreview` / `handleArchiveRestore` を追加（PBI-01（基盤）/02/05 で作った基盤に追加）。

**subtype 追加**: `archive_restore_preview`（read-only + exempt）`archive_restore`（トークン必須）。

### C. PBI-03 の主要な設計判断（なぜなぜ分析の結論）

#### C3-1. id 再採番 — 「INSERT 文に id 列を含めない」だけ

なぜなぜ:
- PBI 落とし穴「アーカイブの id をそのまま INSERT すると、メインDB の PRIMARY KEY 衝突で『url も created_at も異なる別レコード』が誤ってスキップされる」。
- 既存の `INSERT_IGNORE_SQL` は `INSERT_COLS`（`COLUMN_NAMES`、id 含まない）を使う。
- PBI-02 では archive.db に id を保持するため専用の `ARCHIVE_INSERT_SQL`（id 含む）を追加した（PBI-02 §C-3）。

→ **復元は既存の `INSERT_IGNORE_SQL` + `buildInsertParams`（id 除外）をそのまま使う**。archive.db 側の SELECT では id を取得**しない**（`SELECT ${COLUMN_NAMES.join(', ')} FROM browsing_logs`、`ARCHIVE_SELECT_COLUMNS` は使わない）。id 再採番は SQLite の AUTOINCREMENT に完全に委任。追加コード不要。

単体テスト: 復元後の行の id が archive の元 id と異なる（AUTOINCREMENT で採番）。

#### C3-2. 重複判定 — `INSERT OR IGNORE` + `UNIQUE(url, created_at)` に委任

なぜなぜ:
- BDD「メインDB に既に存在するレコード（同じ url + created_at）は重複取り込みしない」。
- `SCHEMA_SQL` に `UNIQUE(url, created_at)` が既にある。
- `INSERT OR IGNORE` は UNIQUE 違反時に静かにスキップ。

→ 重複判定ロジックを**書かない**。`INSERT_IGNORE_SQL` に委任。「既存行は更新されず保持される」（BDD、統合テスト）も IGNORE の挙動そのもの。

#### C3-3. 復元件数の集計 — COUNT 前後差分（`changes()` は使わない）

なぜなぜ（A3-2 の深掘り）:
- `crudHandlers.ts:134` の `handleInsertBatch` は `INSERT OR IGNORE` ループ後に `SELECT changes() AS c` を見ているが、これは**最後の 1 文の変更行数**であり合計ではない（潜在バグ）。
- IdbVfsBackend は各 INSERT 直後に `changes()` を見て加算しているが、行数分の往復が発生。
- ステージング方式では offscreen 内で完結するので往復コストは問題にならないが、シンプルさを優先。

→ **トランザクション前後で `SELECT COUNT(*) FROM browsing_logs` を取り、差分 = restored**。`skipped = SELECT件数 - restored`。これは重複スキップ + url 不正スキップの合計。内訳が必要なら url 不正を別カウント。

単体テスト: restored / skipped カウントが「重複 3 件 + 不正 URL 1 件 + 新規 6 件のアーカイブ」で `restored=6, skipped=4`。

#### C3-4. url スキーム検証 — 行ごとに `new URL()` + protocol チェック

なぜなぜ（A3-3）:
- 外部由来アーカイブは信頼できない入力。`javascript:` / `data:` スキームが `url` に入っていると、後で dashboard が `<a href>` でレンダリングした際に XSS リスク。
- メッセージバリデータ（`validators.ts`）は archive_restore の payload（ファイル名のみ）は検証するが、**ファイル内の行**は検証しない。
- CHECK 制約に url スキーム検証はない（A3-3）。

→ `handleArchiveRestore` 内で各行の `url` を検証:
```ts
function isHttpUrl(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol); }
  catch { return false; }
}
```
不正な行は INSERT せず skip カウント。`validators.ts:257-259` と同じロジックを共通ヘルパーに切り出して両方から使うことを検討（下記 G3-2）。

#### C3-5. 部分更新の禁止 — 1 トランザクション

なぜなぜ:
- BDD「復元の途中失敗でメインDB が部分更新されない」。
- ステージング方式なので行のチャンク転送はない（A3-7）→ 全行を 1 トランザクションで処理できる。
- 10万件を 1 トランザクションで INSERT すると時間がかかる（PBI-02 §C-6 の 10 秒問題と同じ）。

→ `withTransaction(ctx, async () => { for (row of rows) { ... } })`（`handlers.ts:41` の `BEGIN IMMEDIATE` / `COMMIT` / best-effort `ROLLBACK`）。途中失敗で全ロールバック。**10万件の場合の時間は PBI-02 §C-6 と同じくスパイク（F3）で実測し、超過するならポーリング方式**（`archive_restore` が開始応答を返し、`archive_restore_status` でポーリング）。

#### C3-6. 編集済みレコードの扱い（PBI-05 連携）

PBI 落とし穴「PBI-05 で url を変更したレコードは、復元時に『新しい記録』として追加される（元の記録との重複判定が成立しない）」。`created_at` は `UPDATABLE_FIELDS` に含まれない（PBI-05 §A2-7）ためアーカイブ編集で変更不可 → url を変えなければ重複判定は成立する。この仕様をドキュメントに明記。**PBI-03 は PBI-05 に依存しない**（編集されていないアーカイブの復元は単独で完結）。

### D. テスト戦略の具体化

- **E2E**（`opfs-fts5-search.spec.ts` パターン、PBI-02 の E2E と組み合わせ）: アーカイブ作成（PBI-02）→ 復元の往復で `get_count` が元に戻る。復元されたレコードがメインDB の検索でヒット。
- **統合**（`sqliteTestApi.ts` パターン）:
  - 重複スキップ（`url + created_at` 完全一致の既存行は更新されず保持）
  - 復元後の FTS 検索ヒット（`browsing_logs_ai` トリガー経由）
  - id 再採番（元 id を引き継がない）
  - 大容量アーカイブ（10万件相当）が長時間トランザクションでもタイムアウト・部分更新なしに完結（F3 の実測を反映）
  - 無効ファイル（`browsing_logs` なし）/ **トリガー含有ファイル → 拒否** / トークンなし → 拒否
  - ステージングファイル（`archive_incoming_*`）が実行後・失敗後に残らない
  - url 不正行（`javascript:` スキーム）がスキップされ skip カウントに入る
  - 部分更新の禁止: 途中で例外 → メインDB が変化しない
- **単体**: id 再採番の検証 / meta 検証・表示用整形 / 結果集計（restored / skipped / restoredActive / restoredDeleted）/ `isHttpUrl` の境界 / 例外ハンドリング。

### E. ドキュメント追記事項

- 「編集済みレコードの扱い」（C3-6）— url を変えたレコードは新記録として追加される旨。
- 「同期フラグの扱い」— `obsidian_synced=1` のまま復元 → Obsidian 再書き込みなし。再同期したいユーザーには既存の `resync_legacy` を案内。
- 「削除済み行の復元」— `is_deleted=1` 行はフラグ保持で復元、表示に出ないが容量を占める。結果表示の内訳。

### F3. PBI-03 の実機検証項目

PBI-05 §F2 のスパイクを共有（第2エンジン）。追加で:

| 検証内容 | 合格基準 | 不合格時 |
|---------|---------|---------|
| 10万件を 1 トランザクションで `INSERT OR IGNORE` する実測時間（第2エンジン SELECT → メインエンジン INSERT、offscreen 内完結） | 10 秒以内（SW→offscreen タイムアウト、PBI-02 §A-3） | `archive_restore` が開始応答を返し `archive_restore_status` でポーリング（PBI-02 §C-6 と共通の非同期パターン） |
| 10万件トランザクション中のメモリ | 実用範囲 | バッチコミット（例: 5000 件ごとに COMMIT → 部分更新のリスクとのトレードオフ。BDD「部分更新の禁止」と矛盾するので慎重に） |

結果は `dev-docs/plans/2026-09-06-archive-spike.md` に記録。

### G3. レビューで意見が欲しい点

1. **G3-1: 10万件の 1 トランザクション**（C3-5, F3）— 部分更新禁止（BDD）と、長時間トランザクション・メモリ・タイムアウトのトレードオフ。ポーリング方式で「1 トランザクション + 進捗表示」を維持するのが妥当か、バッチコミットを許容して BDD を緩めるべきか。
2. **G3-2: url 検証ロジックの共通化**（C3-4）— `validators.ts` の http/https チェックを共通ヘルパーに切り出して `archiveHandlers` と共有するか、独立実装にするか。
3. **G3-3: skipped の内訳**（C3-3）— 「重複」と「url 不正」を分けて結果表示するか、合算で十分か。
4. **G3-4: プレビューの検証コスト**（B）— `archive_restore_preview` で `validateArchiveEngine()`（トリガー数チェック等）まで走らせると、大きなファイルで時間がかかる。プレビューは meta 読み取りのみにして、完全検証は `archive_restore` の冒頭に寄せるか。

## 敵対的レビュー反映（2026-09-06・adversarial-code-review / 検証済み指摘に基づく規定。以下が本文と矛盾する場合は本節を優先）

1. **検証への突合せ継承（必須）**: PBI-05 の allowlist 構造検証＋`yasumaro_archive_meta.record_count` と `SELECT COUNT(*)` の突合せ（不一致は**拒否**）を適用。列互換は `PRAGMA table_xinfo` 照合で担保（将来のスキーマ列追加にも追従）
2. **行単位のエラー処理（必須）**: 行投入は行単位 try/catch（既存 crudHandlers の慣行）とし、CHECK/型違反行は `skipped` と別分類の `skipped_invalid` として集計・表示（違反1行で全ROLLBACKになる経路と、違反行が restored/skipped に紛れる経路の両方を封じる）
3. **domain は復元時再計算**: `extractDomain(url)` で再計算し、アーカイブ保存値は信頼しない（既存 insert の `record.domain || extractDomain` 慣行と整合）
4. **QueryCache 無効化（必須）**: 復元成功後、dashboard 側で History の QueryCache を無効化する手順を実装手順に追加（既存 star/delete と同じ mutation 無効化経路。復元分が一覧に即時出ない鮮度バグを防ぐ）
5. **restoredDeleted の定義**: 「実挿入に成功した行のうち is_deleted=1」に限定（INSERT試行の成否を行単位で集計。`changes()` や COUNT 差分には依存しない）。内訳合計が restored と一致することを受け入れ基準に追加
6. **上限の明確化**: 復元対象ファイルは PBI-05 と共通のサイズ上限。dashboard 側の `file.size` チェックに加え、**worker 側でも staging ファイルサイズを再検証**（二重化）。実行中は PBI-02 と同じ single-flight ガードで再実行を拒否。件数上限は設けない（サイズ上限で有界）
7. **PREVIEW の staging は意図的保持**: プレビュー→実行で同一stagingを再利用するため保持し、RESTORE実行・閉じる・ページ離脱のいずれかで削除（孤児掃除でも回収）。意図的保持である旨と掃除タイミングを仕様として明記
8. **synced=0 の大量投入**: Obsidian/Gist への再書き込みは既存の limit 付きバッチ同期（SyncBatchRunner）が段階処理する旨を仕様に明記（洪水はバッチ上限で有界）

## Checking Team レビュー反映（2026-09-06・High/Medium 対応。本文と矛盾する場合は本節を優先）

1. **バッチ分割＋再実行収束（High/Tuning調整）**: 復元 INSERT はバッチ分割（5000件/COMMIT）。INSERT OR IGNORE により再実行で収束するため、受け入れ基準「部分更新禁止」を「失敗時も冪等再実行で完結できる（本体は常に整合状態・途中例外はバッチ単位で ROLLBACK）」に修正。テスト: archiveRestore.test.ts 新規（G-1）
2. **staging レジストリ連携（High/Blue Team）**: incoming は `archive_prepare_incoming`（新op）で offscreen 発行名を取得してから書き込む。RESTORE は offscreen レジストリ値を INSERT 述語に使い、ファイル内 meta との不一致は fail-closed（PBI-02 敵対的反映§3 を継承）
3. **QueryCache 無効化（Medium）**: 復元成功後、dashboard 側で History の QueryCache を無効化する手順を実装手順に追加（既存 star/delete と同じ mutation 無効化経路。復元分が一覧に即時表示されること）。テスト: dashboardSqliteService.test.ts マージ（H-1）
4. **集計の行単位化（Medium/Data Integrity・Test）**: 集計は INSERT 試行ごとの成否で行単位に集計（`changes()` 合計・COUNT 差分に依存しない）。`restoredDeleted` は「実挿入に成功した行のうち is_deleted=1」に限定。CHECK/型違反行は行単位 try/catch で `skipped_invalid` 分類（既存 crudHandlers の慣行）。内訳合計 = restored を受入基準に追加
5. **PREVIEW staging は意図的保持（Medium/Legacy Bridge）**: プレビュー→実行で同一stagingを再利用するため保持し、RESTORE実行・閉じる・ページ離脱のいずれかで削除（孤児掃除でも回収）。保持が意図的である旨と掃除タイミングを仕様として明記
6. **allowlist 検証・突合せは PBI-01 共通モジュール使用（High/Maintainability）**: `validateArchiveEngine`（meta.record_count と COUNT(*) の不一致は**拒否**）＋ `table_xinfo` 照合＋ `migrateArchiveStaging(engine)`（不足列は staging に補完・余剰列は COLUMN_NAMES 射影で無視・hidden/generated は拒否継続）を ARCHIVE_RESTORE 冒頭で適用。共通モジュールは **PBI-01（アーカイブ共通基盤）** で実装（番号再編により旧「PBI-01=退避作成」の記述は PBI-01=基盤を指す）。テスト D-1〜D-3（現行より1列少ない自作アーカイブが開けて復元できる）
7. **既存 handleRestore へのガード（High/Legacy Bridge）**: 全体復元（`restore_db`）に「`yasumaro_archive_meta` 存在時は拒否（アーカイブ復元UIへ誘導）」の1行ガード＋UI注意文言（全体復元=上書き/アーカイブ復元=マージ、i18n）＋E2E 1ケース（E-1/E-2）
8. **レガシー・互換（Medium/Legacy Bridge・API）**: 復元分は `resync_legacy` の newest-first 窓（既定1000・上限5000）外になる旨を docs/SETUP_GUIDE.md 復元節に記載。synced=0 の大量投入は既存の limit 付きバッチ同期（SyncBatchRunner）で段階処理される旨を仕様に明記。`archive_format_version=1` の v1 リーダー維持・未知列無視を受入基準に追加（I-2）
9. **domain は復元時再計算（Medium/Data Integrity）**: `extractDomain(url)` で再計算し、アーカイブ保存値は信頼しない（既存 insert の `record.domain || extractDomain` 慣行と整合）
10. **テスト戦略への追加（Test Experts ケース群 D/G/H/I）**: 上記各項目のテスト配置先は既存慣行（archiveRestore.test.ts 新規・archiveValidation.test.ts 新規・dashboardSqliteService.test.ts・dashboard-ui.spec.ts）に従う

## 実装メモ（2026-09-06 自律実装）

### 実装したファイル（メッセージ経路17ファイル）
- プロトコル/セキュリティ: `sqliteMessages.ts`（SQLITE_ARCHIVE_PREPARE_INCOMING / RESTORE_PREVIEW / RESTORE＋3応答型）、`sqliteRpcClient.ts`（MaintainOp 3変形＋オーバーロード）、`dashboardSqliteProtocol.ts`（3リクエスト＋応答マッピング）、`sqliteOperationSecurity.ts`（subtype 3件追加・archive_restore_preview を READ_ONLY+TOKEN_EXEMPT に・archive_restore/prepare はデフォルトでトークン必須）
- deps/ハンドラ: `deps.ts`（ArchiveDeps 3メソッド追加＋createSqliteClientDeps 委譲）、`archiveSubtypes.ts`（3追加）、`archiveHandler.ts`（3ケース追加）
- offscreen/worker: `offscreenGateway.ts`（maintain 3ケース・archive_restore は noRetry）、`dbMaintenance.ts`（3ラッパー）、`OpfsWorkerBackend.ts`（proxy 3メソッド）、`StorageBackend.ts`/`IdbVfsBackend.ts`/`FallbackStorageAdapter.ts`（IF＋OPFS以外エラー）、`sqliteMessageHandlers.ts`（3ハンドラ＋マップ）、`opfsWorker/types.ts`（3型＋payload）、`opfsWorker/archiveRestoreHandlers.ts`（新規・本体）、`opfsWorker.ts`（ルータ3ケース）
- UI: `dashboardSqliteService.ts`（3ラッパー）、Archive パネルに復元セクション（ファイル入力→staging書込→プレビュー→復元→結果表示）、i18n en/ja 15キー

### 復元ハンドラの安全 invariant（実装済み）
- staging名はレジストリ発行のみ（fail-closed）、`validateArchiveEngine` は reject モード（meta.record_count 不一致で拒否）
- 行は id 除外で再採番、`domain` は `record.domain || extractDomain(url)` で再計算（アーカイブ値は信頼しない）
- 行単位 try/catch＋`SELECT changes()` で集計（COUNT差分は並行録画と混同するため不使用）。INSERT OR IGNORE が CHECK違反も握り潰すため、`skippedInvalid` は主にバインド/型エラー等の実行時例外を分類
- バッチ 5000件/COMMIT（BEGIN IMMEDIATE）— 途中失敗でも再実行で収束（UNIQUE により冪等）
- single-flight（module-level flag、並行復元を拒否）
- 成功後 staging（レジストリ＋OPFSファイル）を解放

### PBI記載からの逸脱と理由
- **QueryCache 無効化の追加配線は不要**: 履歴パネルは再訪問時に `resetFiltersForFreshLoad()` → `invalidateCache('fresh-load')`（6.7.107）を実行するため、Archive パネルで復元した後も履歴タブを開けば最新が表示される。受け入れ基準「即時表示」はこの既存機構で充足
- **テスト配置**: `archiveRestoreHandlers.test.ts` は `src/offscreen/__tests__/` に配置（opfsWorker/__tests__ ではなく既存慣行に合わせた）
- **E2E**: file:// のCSP制約によりアーカイブパネルの復元フローは静的検証＋ユニットテストで代替（@extension e2e への追加は次回以降）

### 検証結果
- `npm run type-check` ✓ / `npm run lint` ✓（0 errors）/ `npm test` ✓ **11793 passed / 0 failed**（追加15件）/ `npm run build` ✓ / E2E dashboard-ui ✓ 104 passed
- 既存テスト2件はメッセージ型追加に伴う期待値更新（24→27）
