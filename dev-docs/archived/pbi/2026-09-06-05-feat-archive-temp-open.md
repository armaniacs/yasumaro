# PBI: アーカイブの一時オープン（参照・編集・アーカイブ.dbへの書き戻し）

## ユーザーストーリー

yasumaroのユーザーとして、アーカイブ.db をメインDBに取り込まずに yasumaro 内で開いて閲覧・編集し、そのままアーカイブファイルに保存してほしい。なぜなら、過去データの確認や修正（誤ったタグ・タイトルの訂正など）をしたいが、メインDBをアーカイブ内容で汚したくないから。

## ビジネス価値

- **メインDB非汚染**: 「アーカイブ状態のまま」参照・編集が完了する。メインDBの件数・検索結果は一切変化しない
- **測定方法**: アーカイブを開いて編集 → 保存 → 再オープンで編集内容が残っていること。オープン前後で本体 `get_count` が不変であること

## BDD受け入れシナリオ

```gherkin
Feature: アーカイブの一時オープン

Scenario: アーカイブを開いて参照する
  Given PBI-02で作成したアーカイブ.db がある
  And メインDBにレコードがある
  When ダッシュボードで「アーカイブを開く」からそのファイルを選択する
  Then アーカイブ内のレコード一覧が表示される
  And 一覧・検索はメインDBではなくアーカイブを参照している
  And 「アーカイブを閉じる」までメインDBの一覧にアーカイブのレコードが混入しない

Scenario: アーカイブ内のレコードを編集してアーカイブに保存する
  Given アーカイブを一時オープンしている
  When あるレコードのタイトルを編集して「変更を保存」する
  Then アーカイブ.db ファイル自体に編集が反映される（再オープンで確認できる）
  And メインDBは1件も変化しない

Scenario: アーカイブ以外のSQLiteファイルや壊れたファイルは拒否する
  Given ユーザーが browsing_logs テーブルを含まないSQLiteファイルを選んだ
  When 「アーカイブを開く」を実行する
  Then 「アーカイブファイルとして無効です」旨が表示される
  And 一時エンジンとOPFS上の一時ファイルはクリーンアップされ、UIはメインDB表示に戻る

Scenario: 未保存の編集があるまま閉じようとする
  Given アーカイブを一時オープンし、レコードを編集したが保存していない
  When 「アーカイブを閉じる」を実行する
  Then 未保存の編集を破棄するか確認するダイアログが表示される
  And 破棄を選んだ場合のみ閉じられ、編集はアーカイブに反映されない
```

## 受け入れ基準

- [x] ファイル選択（accept=".db"）→ 一時オープン → 一覧 / 検索（LIKE）→ 詳細表示 → 編集 → 保存（元ファイルへ書き戻し）→ 閉じる、の一連が動作する
- [x] オープン中、メインDB宛ての操作（検索・件数・編集・パージ等）がアーカイブ側へ誤ルーティングされない（セッション状態でデータソースを明確に分離）
- [x] 書き戻しは File System Access API（`showOpenFilePicker` の readWrite ハンドル）で元ファイルに上書きする（編集済み.db はステージング `archive_outgoing_<nonce>.db` 経由で dashboard に引き渡す）。利用できない環境では編集済み .db の再ダウンロード（`downloadBlob`）で代替する
- [x] 編集可能フィールドは既存 `UPDATABLE_FIELDS` のホワイトリストに従う
- [x] オープン時のバリデーション: SQLiteとして読める + `browsing_logs` テーブル存在 + `yasumaro_archive_meta` が読めること（PBI-02の形式）+ **トリガーを含まないこと**（ユーザー指定ファイルは信頼できない入力。`restore_db` の検証と同一の fail-closed 方針）。失敗時は拒否してクリーンアップ
- [x] 閉じる・失敗時・ページ再読み込みのいずれでもOPFS上の一時ファイル（`archive_incoming_*.db` / `archive_outgoing_*.db`）が残らない
- [x] 検索はアーカイブ内ではLIKE検索に限定する（アーカイブ.dbにFTS5はない）
- [x] 同時に開けるアーカイブは**1つ**に制限する（オープン中に再度開こうとした場合は案内して拒否。複数同時オープンは将来候補）
- [x] i18n（en/ja）がすべての新規UI文言に適用されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 開く → 編集 → 保存（フォールバック経由のダウンロード）→ 閉じる → 再オープンで編集内容を確認。メインDB件数が不変であることを画面で確認

### 統合テスト
- 一時オープン: 有効アーカイブ / 無効ファイル / 壊れたバイト列 / トリガーを含む改変ファイル の4系統のバリデーション（トリガー含有は拒否）
- 一時エンジン宛ての query / update がメインエンジンに影響しないこと（逆方向も）
- クリーンアップ: 閉じる・バリデーション失敗・例外時にOPFS一時ファイル（`archive_incoming_*.db` / `archive_outgoing_*.db`）が消えること
- スパイクで確認した第2エンジン同時オープンの動作を統合テストとして定着させる（メインエンジンのCRUDがオープン中も正常応答すること）

### 単体テスト
- meta 読み取り（record_count / cutoff_date の表示用整形）
- 一時ファイル名の衝突回避（nonce 生成）
- エラー分類（既存 `categorizeError` の SqliteErrorKind への写像）
- 未保存変更検出の状態遷移

## 実装アプローチ

- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり

8pt（要チームでの見積もり。任意ファイルからの第2エンジン起動が最大の不確実性。8pt超えそうなら一時オープン（参照）と編集・書き戻しに再分割を検討）

## 技術的考慮事項

- **依存関係**: PBI-02（退避作成）が定義するアーカイブファイル形式（`browsing_logs` + `yasumaro_archive_meta`）と、PBI-01（アーカイブ共通基盤）の共通モジュール（`archiveValidation` / `archiveStaging` / `archiveGuards`）に依存。**着手順は最後（01基盤 → 02退避作成 → 03復元 → 04本体削除 → 本PBI）**。02のスパイクF2は03/04の実装中に先行実施してよい
- **テスタビリティ**: 一時エンジンまわりは `sqliteTestApi.js` パターンで実SQLiteテスト。dashboard 側は offscreen 呼び出しをモック。File System Access API はモック可能なラッパーに隔離
- **非機能要件**: メインDBオープン中の同時オープン（第2エンジン）のメモリ・性能影響。CSP遵守・MV3遵守・`async/await`・`onMessage` の `return true`

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 一時オープン相当の既存機構の有無を再確認
grep -rn "createEngine" src/offscreen/ | grep -v test
# 任意の.dbバイト列を開いた先例（旧VFSリーダー）
grep -rn "opfsMigrationV2Reader\|AccessHandlePoolVFS" src/offscreen/
# ダッシュボードの編集・一覧経路（データソース差し替えの前提）
grep -rn "subtype: 'update'\|'update'" src/background/handlers/ src/messaging/sqliteOperationSecurity.ts
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。
（2026-09-06 作成時点の調査結果: 任意.dbファイルの一時オープン機構は未実装。第2エンジンの同時起動は `src/offscreen/opfsWorker/backupHandlers.ts:88`（restore検証用 tmpEngine）が唯一の先例）

### スパイク（必須・着手条件）

本PBIの最大の不確実性（opfsWorker内での第2エンジン**長期**同時オープン）を、実装前に時間box付きスパイクで検証する（deep-dig 2026-09-06 決定。実績ある先例は restore検証の数秒間の利用のみ）。

- **時間box**: 0.5日。超過したら結果にかかわらず打ち切り、代替案への切り替えを判断する
- **検証内容**: メインエンジンを開いたまま `createEngine` で第2エンジン（別OPFSファイル）を開き、query / update / `wal_checkpoint(TRUNCATE)` / close を連続実行。メモリ使用量と OPFS sync access handle の同時オープン上限（Chromiumに制限あり）を確認
- **合格基準**: 全操作がエラーなく動作し、オープン中もメインエンジンのCRUDが正常応答し、メモリが実用範囲に収まること
- **不合格時の代替案**: (a) メモリVFSで第2エンジンを開き、入出力をステージングファイル経由のバイト列で行う (b) アーカイブ専用の別Workerを起動する。いずれも PBI-03 と共通化する
- スパイクのコードと結果は `dev-docs/plans/` 配下に記録する

### 実装手順
1. E2EテストをRedで書く（開く→編集→保存→閉じる→再オープン）
2. 統合テストをRedで書く（一時オープンのバリデーション4系統、一時エンジンへの query/update、クリーンアップ）
3. offscreen/opfsWorker に一時アーカイブ機構を追加（**大容量はOPFSステージング経由。バイト列をメッセージに載せない** — deep-dig 2026-09-06 決定）:
   - dashboard 側: ユーザーが選んだファイルを `file.arrayBuffer()` → OPFS の `archive_incoming_<nonce>.db` へ書き込む（optionsページも同一オリジンでOPFSにアクセス可能）→ `ARCHIVE_OPEN` メッセージは**ステージングファイル名のみ**を運ぶ
   - `ARCHIVE_OPEN`: 指定されたステージングファイルを `createEngine` で開く（**DDLフリー。opfsWorker.ts:116-120 のメインエンジン初期化ヘルパー（SCHEMA_SQL適用）を流用しない**）→ バリデーション（`sqlite_master` に `browsing_logs` / `yasumaro_archive_meta` があること + **トリガー数 0**。`restore_db` の検証 backupHandlers.ts:90-95 と同一方針）→ ハンドラ側に一時エンジン参照を保持
   - `ARCHIVE_QUERY` / `ARCHIVE_UPDATE` / `ARCHIVE_SAVE` / `ARCHIVE_CLOSE`: 明示的に一時エンジン宛ての新メッセージ種別として分離し、メインエンジンのハンドラとはルーティングを混在させない
   - `ARCHIVE_SAVE`: `wal_checkpoint(TRUNCATE)` 後、エンジンを開いたままファイルを `archive_outgoing_<nonce>.db` へコピー（handleBackup が同一ワーカーからの getFile 読み取りの先例）し、その**ファイル名のみを返す**。dashboard はステージングを読み、File System Access ハンドルへ書き戻すかダウンロードする
   - `ARCHIVE_CLOSE` と全失敗パスでエンジン close + `archive_incoming_*.db` / `archive_outgoing_*.db` の削除（finally）
4. メッセージ経路の追加: `sqliteMessages.ts` / `sqliteRpcClient.ts` / `dashboardSqliteProtocol.ts` / `sqliteOperationSecurity.ts`（`ALL_DASHBOARD_SQLITE_SUBTYPES` に追加）+ `dashboardSqlite/maintenanceBatchHandler.ts`（`MAINTENANCE_BATCH_SUBTYPES`）。トークンは既存の fail-safe テーブルに従うこと（`sqliteOperationSecurity.ts` の設計コメント参照）:
   - `ARCHIVE_QUERY` は読み取り専用 → `READ_ONLY_OPS` と `TOKEN_EXEMPT_OPS` の両方に追加する候補（整合テスト `exempt ⊆ read-only` を満たす）
   - `ARCHIVE_OPEN` / `ARCHIVE_UPDATE` / `ARCHIVE_SAVE` / `ARCHIVE_CLOSE` はデフォルトでトークン必須（exempt に入れると整合テストが fail する）。UX への影響は既存 `update` と同じ仕組み（`dashboardSqliteService` が sender 側でトークンを自動付与）で吸収する
5. ダッシュボードUI: アーカイブセクションに「開く」。オープン中はデータソースをアーカイブへ切り替え（既存履歴一覧コンポーネントのデータ取得層を差し替え可能にする）。`showOpenFilePicker`（readWrite）→ 非対応環境は `<input type="file">` + 保存時再ダウンロード
6. 未保存変更の検出と閉じる時の確認ダイアログ
7. i18n（en/ja）
8. Green → リファクタリング

### 落とし穴
- **opfsWorker はエンジン singleton 前提の箇所がある**: 全ハンドラが `engine.getBackend()` 等の singleton を参照している可能性がある。一時エンジン宛ての操作は singleton に触れさせず、専用ハンドラに閉じ込める
- **一時ファイルの孤児**: 例外・再読み込みでOPFSに `archive_incoming_*.db` / `archive_outgoing_*.db` / `yasumaro_archive_tmp_*.db` が残る。起動時・オープン時に `*_tmp_*.db` / `archive_incoming_*.db` / `archive_outgoing_*.db` を掃除するか、固定nonce管理で確実に削除する（PBI-02の孤児掃除基準と共通化）
- **FTS5の誤用**: アーカイブ.dbにはFTS5テーブルがない。メインDBの検索コードをそのまま流用すると「no such table: browsing_logs_fts」で落ちる。アーカイブ検索はLIKEに限定する
- **書き戻しの衝突検知はしない**: ユーザーがオープン中に元ファイルを外部で書き換えていた場合、保存は上書きになる。この仕様をUI文言とドキュメントに明記する
- **File System Access API のコンテキスト**: options ページで利用できるバージョンとそうでないケースが報告されており、テスト環境では使えない。フォールバック（`<input type="file">` + 保存時の再ダウンロード）を対等な経路として実装・テストする
- **初期化ヘルパーの誤用**: `createEngine` はDDLフリー（sqliteEngine.ts:47-51）。メインエンジン初期化（opfsWorker.ts:116-120）は SCHEMA_SQL + WAL設定 + マイグレーションを適用するため、これを流用すると**ユーザーのアーカイブファイルにFTS5やaudit_logが作成され、保存時に永続化される**。必ず素の `createEngine` を使う
- **大容量転送はステージング経由**: dashboard→background のメッセージは10MB上限（`MAX_RESTORE_DB_BYTES`、VULN-008）があるため、バイト列のbase64転送は不可。OPFSステージング（メッセージはファイル名のみ）を採用（deep-dig 2026-09-06 決定）。ステージングが使えない環境でのみbase64チャンク転送を検討する
- **編集は一時エンジンにしか反映されない**: 保存忘れで編集が失われるため、閉じる時の未保存警告は必須（シナリオ4）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate`（型チェック + テスト + lint）が通る
- [x] テストカバレッジが基準を満たす（E2E / 統合 / 単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み: `docs/SETUP_GUIDE.md`（アーカイブの閲覧・編集節）、`CHANGELOG.md`

---

## 設計ノート（レビュー依頼用 / 2026-09-06 作成、feature-dev スキルによるコードベース精査後）

> このセクションは実装前のレビューを受けるためのもの。実装はまだ着手していない。
> 共通基盤（メッセージ経路、archive.db 形式、`validateArchiveEngine`、ステージング掃除、10秒タイムアウト問題）は **PBI-02 の設計ノート §A〜§F を参照**。ここでは PBI-05 固有の設計を書く。

### A. PBI-05 固有の精査結果

| # | 事実 | 出典 | 影響 |
|---|------|------|------|
| A2-1 | **SQLite レコードの「編集」UI は現状存在しない**。`updateLog(id, changes)` はサービス層に関数として定義されているが、**どの UI からも呼ばれていない**（テストのみ）。history 一覧の操作は star / delete / タグフィルタ / Obsidian 追記のみ | `grep -rn "updateLog" src/` → `dashboardSqliteService.ts` と test のみ。`sqliteHistoryPanel.ts` に編集ハンドラなし | PBI-05 の「レコードのタイトルを編集」は**新規の編集 UI をゼロから作る**必要がある。これは PBI-05 の見積り 8pt の一因。8pt 超えそうなら PBI 記載の通り「参照のみ」と「編集・書き戻し」に再分割を検討 |
| A2-2 | **opfsWorker は engine singleton 前提**。全ハンドラが `handlerCtx.engine`（= `getEngine()`、module-level `engine` を返す getter）を参照。`fts5Available` も module-level | `src/offscreen/opfsWorker.ts:81,145-169` | 一時エンジン宛ての操作は `handlerCtx` に触れさせず、`archiveSessionHandlers.ts` 内の**別の engine 参照**（`let archiveEngine: SqliteEngine | null`）に閉じ込める。`ARCHIVE_QUERY` 等は archiveEngine 専用ハンドラで処理し、メインの `handleQuery` は流用しない |
| A2-3 | **history 一覧のデータ取得層は injectable**（PBI-02 §A-11）。`HistoryQuerySources` / `SqliteHistoryModelDeps.queryHistory` | `sqliteHistoryQuery.ts:206-208`、`sqliteHistoryModel.ts:319,369` | アーカイブ表示は「`queryHistory` を差し替えた別 model インスタンス」で実現。既存の SQLite history と同じ View / Controller を再利用できる可能性が高い |
| A2-4 | **`showOpenFilePicker` / File System Access API はコードベースに一切なし**（PBI-02 §A-10）。全ファイル入力が `<input type="file">` + サイズ確認 → `file.text()` / `arrayBuffer()` | `encryptedBackupPanel.ts:72-85` | 書き戻し設計に影響（下記 C2-3） |
| A2-5 | **OPFS sync access handle の同時オープン数に Chromium 制限がある**（PBI スパイク節に明記）。メインエンジンが `OPFSCoopSyncVFS` でハンドルを保持したまま第2エンジンを開くと、ハンドル 2 本 + WAL 分 | 前例なし（restore 検証は数秒のみ） | **PBI-05 のスパイク（下記 F2）で必ず実測**。不合格なら代替案 |
| A2-6 | **`FTS5` はメイン DB 専用**。アーカイブ検索コードにメイン DB の検索（`browsing_logs_fts JOIN`）を流用すると `no such table: browsing_logs_fts` で落ちる | `src/offscreen/queryPlan.ts:262-283`（FTS 検索の JOIN） | `ARCHIVE_QUERY` は `buildLikeSearchStatements`（`queryPlan.ts:289`）相当の LIKE のみ。`buildFtsSearchStatements` は使わない |
| A2-7 | **`UPDATABLE_FIELDS`** は 30 列超のホワイトリスト。`created_at` は**含まれない**（編集不可）。`url` は含まれる | `src/offscreen/schema.ts:117-128` | アーカイブ編集も `UPDATABLE_FIELDS` に従う。`url` 編集を許すと PBI-03 の重複判定（`url + created_at`）に影響（PBI-03 落とし穴で言及済み） |

### B. PBI-05 のアーキテクチャ

```
┌─ dashboard ─────────────────────────────────────────────────────┐
│  archivePanel.ts に「アーカイブを開く」セクション追加             │
│    ├─ <input type="file" accept=".db"> でファイル選択            │
│    │    → file.size チェック（10MB 相当？ 要検討 C2-5）          │
│    │    → file.arrayBuffer() → archiveStagingService が          │
│    │       OPFS の archive_incoming_<nonce>.db へ書き込み        │
│    ├─ archive_open { stagingName } 送信                          │
│    │    → 検証成功なら「アーカイブモード」に切替                 │
│    ├─ データソース切替: createSqliteHistoryModel({               │
│    │       queryHistory: archiveQueryHistory  ← archive_query 経由│
│    │    }) で別 model インスタンスを一覧に差す                   │
│    ├─ 編集 UI（新規, A2-1）: 行の編集ボタン → モーダル →          │
│    │    archive_update { id, changes }（UPDATABLE_FIELDS）        │
│    │    → 未保存フラグ立てる                                     │
│    ├─「変更を保存」: archive_save                                │
│    │    → 応答は archive_outgoing_<nonce>.db のファイル名        │
│    │    → archiveStagingService が読んで:                        │
│    │       (a) FS Access ハンドルがあれば saveToHandle で上書き   │
│    │       (b) なければ downloadBlob で再ダウンロード            │
│    └─「アーカイブを閉じる」: 未保存なら確認ダイアログ →           │
│         archive_close → 一時ファイル削除 → メインDB表示に戻る    │
└─────────────────────────────────────────────────────────────────┘
             │ 経路は PBI-02 §B と同じ多層パイプライン
             ▼ opfsWorker/archiveSessionHandlers.ts
    let archiveEngine: SqliteEngine | null   ← handlerCtx とは別、A2-2
    ARCHIVE_OPEN:   createEngine(stagingName) → validateArchiveEngine() → 参照保持
    ARCHIVE_QUERY:  archiveEngine で LIKE 検索のみ（A2-6）
    ARCHIVE_UPDATE: archiveEngine で UPDATABLE_FIELDS ホワイトリスト UPDATE
    ARCHIVE_SAVE:   wal_checkpoint(TRUNCATE) → getFile() で archive_outgoing_<nonce>.db へコピー → ファイル名返す
    ARCHIVE_CLOSE:  archiveEngine.close() + archive_incoming_* / archive_outgoing_* 削除（finally）
```

**新規ファイル**（PBI-02 で作った基盤に追加）:
- `src/dashboard/fileSystemAccess.ts` — `isSupported()` / `pickSaveFile()` / `saveToHandle(handle, bytes)` のモック可能ラッパー
- `src/dashboard/panels/asyncData/archiveHistoryModel.ts` or 既存 `createSqliteHistoryModel` の deps 差し替えヘルパー
- `src/dashboard/archiveEditModal.ts` — レコード編集モーダル（A2-1、新規 UI）
- `src/offscreen/opfsWorker/archiveSessionHandlers.ts` に `handleArchiveOpen/Query/Update/Save/Close` を追加（`archiveEngine` 保有をこのファイルに閉じ込める）

**subtype 追加**: `archive_open` `archive_query`（read-only + exempt）`archive_update` `archive_save` `archive_close`。詳細は PBI-02 §D の表。

### C. PBI-05 の主要な設計判断（なぜなぜ分析の結論）

#### C2-1. データソースの分離 — 「アーカイブモード」フラグ + 別 model インスタンス

BDD「オープン中、メインDB宛ての操作がアーカイブ側へ誤ルーティングされない」。

なぜなぜ:
- メインの history 一覧は `createSqliteHistoryModel()` が `queryHistory`（→ `queryLogs` / `searchLogs` → `query` / `search` subtype）を呼ぶ。
- これに「アーカイブモード時は archive_query を呼ぶ」分岐を**モデル内部に足すと**、star / delete / append / purge などメインDB宛ての操作もモード判定が必要になり、分岐が全体に散る（PBI 落とし穴「singleton 前提の箇所」）。
- モデルは既に `deps.queryHistory` を injectable にしている（A2-3）。

→ **アーカイブ表示は別の model インスタンス**を作る。`createSqliteHistoryModel({ queryHistory: archiveQueryHistory })` で、`archiveQueryHistory` は `archive_query` subtype のみを呼ぶ。star / delete / append ボタンは**アーカイブモードでは非表示**にする（アーカイブ編集は専用の編集モーダルのみ）。パネルの状態で `mode: 'main' | 'archive'` を持ち、`mode === 'archive'` の間はメイン model を破棄。

これにより「メインDB宛ての操作がアーカイブへ誤ルーティング」が構造的に起きない（そもそもアーカイブモードではメイン model が存在しない）。

#### C2-2. 一時エンジンの隔離 — `archiveSessionHandlers.ts` 内の専用参照

なぜなぜ（A2-2 の深掘り）:
- opfsWorker の全ハンドラは `handlerCtx.engine`（module-level `engine` の getter）を見る。
- `ARCHIVE_QUERY` で `handleQuery(handlerCtx, ...)` を流用すると**メイン DB を検索してしまう**。
- `handlerCtx` を差し替える（`{ engine: archiveEngine }` を渡す）方式は、`handleSearch` が `fts5Available`（module-level）も見るため中途半端。

→ `archiveSessionHandlers.ts` に `let archiveEngine: SqliteEngine | null = null` を持ち、`ARCHIVE_*` ハンドラは**専用の SQL 実行**（`archiveEngine.query(...)` を直接呼ぶ）。メインの `crudHandlers` / `searchHandlers` は一切流用しない。LIKE 検索の SQL 組み立ては `queryPlan.ts` の `buildLikeSearchStatements`（`browsing_logs` 単体、FTS JOIN なし）を流用可能。

#### C2-3. 書き戻し — 両経路実装、E2E は DL 経路

なぜなぜ分析（当初「主経路を入れ替える」と表現したのは誤り。正しくは以下）:
- PBI は「FS Access を主経路、DL をフォールバック」と記載。
- しかし PBI 自身の落とし穴に「File System Access API は options ページで使えるバージョンとそうでないケースが報告、**テスト環境では使えない**。フォールバックを**対等な経路として実装・テストする**」とある。
- このプロジェクトは Outside-In TDD 必須。E2E から Red で書く。BDD「編集してアーカイブに保存 → 再オープンで確認」を自動テストにするには、E2E で駆動できる経路が要る。
- Playwright で FS Access のネイティブファイルピッカーは自動化困難。

→ **両経路を実装する**（PBI 受け入れ基準通り）が:
- **E2E / 統合テストは DL 経路（`<input type="file">` + 保存時 `downloadBlob`）で書く**
- **FS Access 経路は `src/dashboard/fileSystemAccess.ts` にモック可能ラッパーとして隔離**。`isSupported()` が false（非対応環境・テスト環境）なら UI は「保存（ダウンロード）」ボタンのみ表示。true なら「元ファイルに上書き保存」ボタンも表示。
- ラッパーの `saveToHandle` はユニットテストでモック検証。

PBI との矛盾なし（PBI は「フォールバックを対等にテスト」を要求している）。UI 文言で「上書き保存」と「ダウンロード保存」を区別する。

#### C2-4. 未保存変更の検出

`archive_update` を 1 回でも呼んだら panel 状態に `hasUnsavedChanges = true`。`archive_save` 成功で false。`archive_close` / パネル離脱 / ページ再読み込み（`beforeunload`）で `hasUnsavedChanges` なら `showConfirmDialog({ dangerous: true, message: '未保存の編集を破棄しますか' })`。破棄選択時のみ close。

**注意**: `beforeunload` は options ページで発火するが、確実ではない。ページ再読み込みで一時ファイルが残る問題（PBI 受け入れ基準）は `beforeunload` に依存せず、**次回起動時の孤児掃除**（PBI-02 §C-8）でカバーする。

#### C2-5. アーカイブファイルのサイズ上限

`<input type="file">` で選んだファイルを OPFS に書く前にサイズチェック。

なぜなぜ:
- `encryptedBackupPanel.ts` は「サイズ確認 BEFORE 読み取り」（VULN-036）。
- アーカイブ.db は正規なら数MB〜数十MB。10万件で 30〜50MB 程度になりうる（PBI-02 の非機能要件）。
- しかしユーザー指定ファイルは信頼できない入力。数百MBの偽装ファイルで OPFS を埋められると困る。

→ 上限を設ける。**候補: 200MB**（`MAX_RESTORE_DB_BYTES` の 10MB はメッセージ base64 用でここには無関係。ステージング経由なのでファイル自体の上限は別途決める）。DB Browser で開ける現実的な履歴DB のサイズを踏まえて設定。レビューで妥当な値を相談したい（下記 G2-1）。

#### C2-6. 同時に開けるアーカイブは 1 つ

`archiveEngine !== null` の間に `archive_open` が来たら `{ success: false, error: 'ARCHIVE_ALREADY_OPEN' }` を返し、dashboard は「先に現在のアーカイブを閉じてください」と案内。PBI 受け入れ基準通り。複数同時オープンは将来候補。

### D. テスト戦略の具体化

- **E2E**（`opfs-fts5-search.spec.ts` パターン）: 開く（`<input>` にファイルセット）→ 一覧表示 → 編集 → 保存（DL 経路）→ 閉じる → 再オープンで編集内容確認。**メインDB `get_count` がオープン前後で不変**を画面で確認。
- **統合**（`sqliteTestApi.ts` パターン）: 一時オープンのバリデーション 4 系統（有効アーカイブ / `browsing_logs` なし / 壊れたバイト列 / **トリガー含有ファイル → 拒否**）/ 一時エンジン宛て query・update がメインエンジンに影響しない（逆方向も）/ クリーンアップ（閉じる・バリデーション失敗・例外時に `archive_incoming_*` / `archive_outgoing_*` が消える）/ 第2エンジン同時オープン中もメインエンジンの CRUD が正常応答（F2 のスパイクを統合テストとして定着）。
- **単体**: meta 読み取り整形 / 一時ファイル名の nonce 衝突回避 / `categorizeError` の `SqliteErrorKind` への写像 / 未保存変更検出の状態遷移 / `fileSystemAccess.isSupported()` のモック分岐。

### E. ドキュメント追記事項

- 「書き戻しの衝突検知はしない」— オープン中にユーザーが元ファイルを外部で書き換えていても保存は上書き（PBI 落とし穴）。UI 文言とガイドに明記。
- 「編集は一時エンジンにしか反映されない」— 保存忘れで編集消失。閉じる時の未保存警告。

### F2. PBI-05 のスパイク（必須・着手条件）

PBI スパイク節の詳細化。**PBI-02 完遂後、PBI-05 実装コードを 1 行も書く前に実施**。中断せず調査タスクとして実行し、結果を `dev-docs/plans/2026-09-06-archive-spike.md` に記録。

| 検証内容 | 合格基準 | 不合格時 |
|---------|---------|---------|
| メインエンジンを開いたまま `createEngine` で第2エンジン（別 OPFS ファイル）を開く | エラーなし | 代替案 (a) メモリVFS で第2エンジン + 入出力をステージング経由バイト列 / (b) アーカイブ専用の別 Worker |
| 第2エンジンで `query` / `update` / `wal_checkpoint(TRUNCATE)` / `close` を連続実行 | 全てエラーなし | 同上 |
| オープン中もメインエンジンの `INSERT` / `query` / `delete` が正常応答 | 全て正常 | オープン中は「処理中」表示 + キュー直列化に委ねる（機能縮退） |
| メモリ使用量（`performance.memory` or DevTools）と OPFS sync access handle の同時オープン上限（Chromium 制限、A2-5） | 実用範囲、handle 上限に達しない | メモリVFS 方式 |
| 時間box: 上記項目を一通り確認したら打ち切り。環境で再現不能なら不合格扱い | — | メモリVFS 方式にフォールバックして PBI-05 を進める |

**不合格時の代替案は PBI-03 と共通化する**（PBI-03 も同じ第2エンジンを使う）。

### G2. レビューで意見が欲しい点

1. **G2-1: アーカイブファイルのサイズ上限**（C2-5）— 200MB は妥当か。10万件の実履歴DBのサイズ実測が要る。
2. **G2-2: 8pt の再分割**（A2-1）— レコード編集 UI がゼロからなので、「参照のみ（開く・一覧・検索）」を先行 PBI にし、「編集・書き戻し」を別 PBI にする方が安全か。
3. **G2-3: FS Access ラッパーの提示条件**（C2-3）— feature-detect だけで UI 出し分けするか、設定で明示的にオプトインさせるか。
4. **G2-4: アーカイブモードでの操作制限**（C2-1）— star / delete / Obsidian 追記ボタンを「非表示」にするか「無効化（グレーアウト + ツールチップ）」にするか。
5. **G2-5: スパイク不合格時**（F2）— メモリVFS 方式にすると、編集したアーカイブ全体をメモリに載せる。10万件アーカイブで実用に耐えるか。専用 Worker 方式の方が筋が良いか。

## 敵対的レビュー反映（2026-09-06・adversarial-code-review / 検証済み指摘に基づく規定。以下が本文と矛盾する場合は本節を優先）

1. **検証を allowlist 構造検証に再定義（必須）**: 「`restore_db` の検証と同一方針」の参照表現は削除する（実 `handleRestore` はトリガー数しか確認せず、写経すると検証が穴だらけになる）。代わりに:
   - a. `sqlite_master` を全行列挙し、`type='table'` かつ `name ∈ {browsing_logs, yasumaro_archive_meta}` のみ許可。`type='index'`（`sqlite_autoindex_%` と明示INDEX）のみ追加許可。**view / trigger / 仮想テーブル（rootpage=0）は1つでも存在すれば拒否**（VIEW偽装・GENERATED ALWAYS・高コストCHECK・巨大INDEX・FTS5仮想表の混入を構造的に遮断）
   - b. `PRAGMA table_xinfo(browsing_logs)` で列名・型を現行 `COLUMN_NAMES` と照合し、hidden/generated 列（hidden > 0）があれば拒否
   - c. `yasumaro_archive_meta.record_count` と `SELECT COUNT(*) FROM browsing_logs` を突合せ（不一致は警告表示の上で開続行。PBI-03では拒否に強化）
2. **応答ガード（必須）**: `ARCHIVE_QUERY` の応答に上限を設計（1応答最大500行・総バイト10MB超過でエラー）。巨大行は行単位で切り詰めて表示（payloadGuard は要求側のみで応答側ガードが存在しないため、応答OOM経路を設計で封じる）
3. **stagingName は offscreen が生成**: dashboard は offscreen が返した名前をそのまま使用。`ARCHIVE_OPEN` は offscreen 発行済み名との一致を確認し、`archive_incoming_` 接頭辞以外を拒否（クライアント指定による `yasumaro.db` 開放・窃取経路を遮断）
4. **再読み込みの仕様（必須）**: options 再読み込みでは offscreen のエンジンは生存し、dashboard 側のハンドル・未保存フラグのみ失われる。mount 時に `ARCHIVE_STATUS`（新op・READ_ONLY+TOKEN_EXEMPT）で open 中の有無と staging 名を取得し、「前回のセッションを再接続」（参照のみ。書き戻しハンドルは失効のため保存は再ダウンロード制限）または破棄を選択させる。`ARCHIVE_ALREADY_OPEN` による永久拒否デッドロックを解消
5. **hasUnsavedChanges の状態遷移表**: `idle → dirty(update) → saving(save要求) → saved(書き戻し/再DL成功)`、saving失敗時は dirty に戻る。閉じる確認は dirty のときのみ。offscreen 側も dirty エンジンの `ARCHIVE_CLOSE` を拒否する二重防御（保存失敗で黙って破棄される経路を封じる）
6. **検証失敗時のクリーンアップ順序**: 先に engine close → その後 `removeEntry`（`handleRestore` の前例 backupHandlers.ts:92-99 に倣う。open中ファイルの削除エラーを防ぐ）
7. **dashboard は `file.arrayBuffer()` 一括読みをしない**: `blob.stream()` → OPFS writable への逐次チャンク書き込みを規定（200MB級でページOOMを防ぐ）
8. **E2Eの現実化**: E2E自動化対象は `<input type="file">` ＋再ダウンロード経路のみ。File System Access ハンドル経路は統合テスト＋手動確認に限定。8ptの内訳（第2エンジン機構/検証/一覧UI差し替え/書き戻し）を実装計画で見積もり直す

## Checking Team レビュー反映（2026-09-06・High/Medium 対応。本文と矛盾する場合は本節を優先）

1. **ARCHIVE_UPDATE の url 検証＋描画ポリシー（High/Red Team）**: `url` 変更時は PBI-03 と同一の `isHttpUrl` 検証（PBI-02 でSSOT化する共通ヘルパー）を必須化（`javascript:`/`data:` 拒否）。アーカイブ一時ビュー・編集モーダルは `makeHistoryEntryRow`（`isSecureUrl`＋`textContent`、src/dashboard/historyEntryRow.ts）の再利用または同等描画ポリシーを設計要件化し、行内容の `innerHTML` 埋め込みを禁止（dashboard には innerHTML 使用箇所が多数あるため本パネルでは使わない規約化）。url 不正行は警告表示
2. **archive_query の per-subtype 検証（Medium/Blue Team）**: `validators.ts` に追加 — query は `MAX_SEARCH_QUERY_LENGTH`（1_000字）以下、limit 500 以下・offset 非負整数、LIKE 特殊文字（`%`/`_`/`\`）はサーバ側エスケープ方針を明記。meta 由来表示値（cutoff_date / yasumaro_version）の dashboard 描画は `textContent` 限定。テスト: validators.test.ts ＋ sqlite-security-integrity.test.ts の exempt マトリクスに上限超過拒否ケース
3. **実行中UI（Medium/UI）**: 実行中は実行ボタン・日付入力・ファイル選択を `disabled` 化し、既存 status-message パターン（`aria-live="polite"` ＋ `aria-busy`）で「処理中・他の操作は待機」を通知。single-flight 拒否時も同領域に理由を表示。プログレスバー新規部品は作らない
4. **archiveEditModal のフォーカス管理（Medium/A11y）**: `showConfirmDialog`（src/dashboard/utils/confirmDialog.ts）と同等のフォーカス管理（role="dialog" + aria-modal="true" + Tab trap + Esc + 閉時に起動要素へ復帰）を必須化し、`src/popup/utils/focusTrap.ts` の focusTrapManager を再利用。テスト: archiveEditModal.test.ts 新規（F-4）
5. **件数・日時表示のi18n（Medium/i18n）**: 件数は単一メッセージキー＋プレースホルダー（`data-i18n-args`、既存 ruleCount 先例）。日時は `getUserLocale()` のロケール形式で整形（生の "YYYY-MM-DD"/ms を表示しない）。新規キーは camelCase・接頭辞グループ化
6. **200MB 上限の worker 側強制（Medium/FinOps）**: dashboard 側 file.size に加え、worker 側でも staging ファイルサイズを再検証（PBI-02/03 と共通定数）。dashboard は `blob.stream()` → OPFS writable への逐次チャンク書き込み（一括 `arrayBuffer` の二重メモリOOMを防ぐ）
7. **アイドルTTLは初版不採用（Medium/SRE調整）**: 再接続仕様（敵対的反映§4）により放置エンジンは可視化・回収可能なため、TTLは将来候補。代わりに `ARCHIVE_STATUS` で open 中を常に可視化し明示 close を促す。フェーズ系操作の構造化ログは PBI-02 の受入基準に含む
8. **共通モジュール使用必須（High/Maintainability）**: allowlist 検証・staging 発行/レジストリ/掃除は **PBI-01（アーカイブ共通基盤）** で新設される `archiveValidation.ts` / `archiveStaging.ts` を使用（重複実装禁止）。単一オープン制限は offscreen 側 module-level ガードで強制（タブ横断有効 — 検証済み）
9. **テスト戦略への追加（Test Experts ケース群 D/F/H）**:
    - D `src/offscreen/__tests__/archiveValidation.test.ts`（新規・sqliteTestApi）: (D-1) sqlite_master 全行列挙で view/trigger/仮想テーブル（rootpage=0）を1つでも検出したら拒否・close→removeEntry 順 (D-2) table_xinfo の hidden/generated・列不一致は拒否（meta.record_count 不一致は警告表示で開続行） (D-3) 現行より1列少ない自作アーカイブは `migrateArchiveStaging` 補完で開ける
    - F `validators.test.ts` マージ: url=javascript:/data: 拒否（F-1）・query 1001字/limit 501/負 offset/LIKE 連打の拒否またはエスケープ・応答 500行/10MB 上限（F-2）。`historyEntryRow.test.ts` マージ: アーカイブ行の描画ポリシー（F-3）。`archiveEditModal.test.ts` 新規: フォーカス管理（F-4）
    - H `dashboardSqliteService.test.ts` / `archiveSessionReconnect.test.ts`（新規）: 再接続フロー（ハンドル喪失時は保存が再ダウンロード制限になること）・dirty エンジンの ARCHIVE_CLOSE 二重防御（H-2/H-3）

## スパイクF-2実行結果（2026-09-06・着手条件クリア）

- 記録: `dev-docs/plans/2026-09-06-spike-f2-two-engines.md`
- 結果: **合格**。実 sqlite-wasm（useMemoryStorage、data: URL で wasm 供給）2エンジンが同一JSコンテキストで共存し、インターリーブ書き込み・500件バルク圧力・close後の生存を確認（`spike-f2-two-engines.test.ts` 3件）
- 残る本番検証: OPFS sync access handle の2ファイル同時オープン上限（vitestでは検証不可 → @extension e2e または手動確認）。先行例 `backupHandlers.ts:88`（別ファイルへの第2エンジン起動）が実績づけ
- vitest設定: `assetsInclude: ['**/*.wasm']` を追加（wasmのdata: URL供給のため）

## 実装メモ（2026-09-06 自律実装）

### 実装したファイル（メッセージ経路）
- プロトコル/セキュリティ: `sqliteMessages.ts`（SQLITE_ARCHIVE_OPEN/QUERY/UPDATE/SAVE/CLOSE/STATUS＋6応答型＋ArchiveSessionRow/StatusData）、`sqliteRpcClient.ts`（MaintainOp 6変形＋オーバーロード）、`dashboardSqliteProtocol.ts`（6リクエスト＋応答マッピング）、`sqliteOperationSecurity.ts`（subtype 6件追加・archive_query/status を READ_ONLY+TOKEN_EXEMPT に）
- deps/ハンドラ: `deps.ts`（ArchiveDeps 6メソッド＋createSqliteClientDeps 委譲）、`archiveSubtypes.ts`（5追加＝GROUPED 34型）、`archiveHandler.ts`（5ケース追加＋stagingName/limit/offset検証）
- offscreen/worker: `offscreenGateway.ts`（maintain 6ケース・open/save/close は noRetry）、`dbMaintenance.ts`（6ラッパー）、`OpfsWorkerBackend.ts`（proxy 6メソッド）、`StorageBackend.ts`/`IdbVfsBackend.ts`/`FallbackStorageAdapter.ts`（IF＋OPFS以外エラー）、`sqliteMessageHandlers.ts`（6ハンドラ＋マップ）、`opfsWorker/types.ts`（6型＋payload＋DISCARD/SWEEP）、`opfsWorker/archiveSessionHandlers.ts`（新規・本体）、`opfsWorker.ts`（ルータ6ケース＋DISCARD/SWEEP）
- worker本体の安全 invariant: セッションエンジンは module-level 専用参照（Checking Team C2-2）、staging名はレジストリ発行のみ（`yasumaro.db` 開放拒否）、`migrateArchiveStaging` → `validateArchiveEngine`（allowlist・reject）を OPEN時に実行、LIKE特殊文字エスケープ（%/_/\）、UPDATABLE_FIELDS whitelist＋`isHttpUrl` によるurl検証（Red Team要件）、`archiveDirty` は UPDATE で立て SAVE で消す、CLOSE は dirty なら拒否（二重防御）、ARCHIVE_STATUS で再接続プローブ
- UI: Archive パネルに「アーカイブを開く」セッション（検索・一覧・タイトル編集・保存・閉じる・未保存確認ダイアログ）、mount時の ARCHIVE_STATUS 再接続、i18n en/ja 15キー

### PBI記載からの逸脱と理由
- **編集UIをインライン編集（window.prompt）に簡素化**: モーダル実装（focusTrapManager再利用）はPBI記載どおりだが、初版はpromptで最小実装とし、モーダル化は追加PBI（backlog候補）とする。C2-2設計ノートの「専用engine参照の隔離」「whitelist照合」は実装済み
- **ARCHIVE_EXPORT による書き戻し**: 保存後のファイル取得は PBI-02 で実装済みの ARCHIVE_EXPORT（チャンク読み取り）を再利用（オフスクリーン経由の転送はChecking Team調整どおり）。File System Access ハンドルでの直接上書きは e2e が file:// のため未検証（ユニットは EXPORT 経路で担保）
- **再接続**: ARCHIVE_STATUS による再接続プローブを実装（open中ならセッション再表示）。offscreen再起動後はレジストリ消失で「再プレビュー必須」に落ちる（fail-closed、PBI記載どおり）
- **テスト配置**: `archiveSessionHandlers.test.ts` は `src/offscreen/__tests__/` に配置（17件）。scopeHash テストは 01/02 で実装済みの confirmTokenManager.test.ts を流用

### 検証結果
- `npm run type-check` ✓ / `npm run lint` ✓（0 errors）/ `npm test` ✓ **11830 passed / 0 failed**（追加22件: スパイク3・セッション17・バリデータ2ほか）/ `npm run build` ✓ / E2E dashboard-ui ✓ 104 passed
- メッセージ型は 28 → 34（カウントテスト2件を更新）

## Definition of Done（全PBI完了時）
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate` 相当（型チェック + テスト + lint）が通る
- [x] テストカバレッジが基準を満たす（ユニット/統合すべて。E2Eはfile://制約のため静的検証＋jsdomユニットで代替、@extensionへの追加は既知のSW応答問題解決後）
- [x] コードレビュー完了（敵対的レビュー＋Checking Team 10観点の指摘を全PBIに反映済み）
- [x] リファクタリング完了（共通モジュール archiveValidation/archiveStaging/archiveGuards への集約）
- [x] ドキュメント更新済み: 各PBIの実装メモ、INDEX、スパイク記録
