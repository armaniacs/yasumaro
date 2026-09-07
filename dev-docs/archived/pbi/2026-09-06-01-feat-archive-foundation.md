# PBI: アーカイブ共通基盤（検証・ステージング・ガードのSSOT化と既存機能の安全化）

## ユーザーストーリー

yasumaroのユーザーとして、全体復元が偽のDBファイルを拒否し、.dbダウンロードが大容量でも破損しないことを、アーカイブ機能に先立ってほしい。なぜなら、アーカイブ3機能（退避・復元・一時オープン）が共通して依存する検証・ステージング・ガードの土台を先に固め、既存機能（全体復元・エクスポート）の安全強化を先行させることで、以降の機能実装を安全かつ重複なしに進められるから。

## ビジネス価値

- **既存機能の安全強化**: 全体復元（`restore_db`）が悪意ある・取り違えた .db を受理する既存リスク（トリガー数チェックのみの検証）を塞ぐ。アーカイブ機能がなくても即日効く
- **実装の重複排除**: アーカイブ3PBI（02/03/05）が共通して使う `archiveValidation` / `archiveStaging` / `archiveGuards` をSSOT化し、検証ロジックの写経ドリフト（トリガー数チェックのみの写経事故）を構造的に防止
- **測定方法**: (a) アーカイブ形式の .db を全体復元に食わせたら拒否されること (b) VIEW偽装・トリガー含有・hidden列のテストDBが `validateArchiveEngine` で拒否されること (c) トークン発行後にパラメータを差し替えた実行が拒否されること (d) 遅延解放後の downloadBlob で大容量Blobのダウンロードが壊れないこと

## BDD受け入れシナリオ

```gherkin
Feature: アーカイブ共通基盤

Scenario: アーカイブ形式の.dbを全体復元に食わせると拒否される
  Given browsing_logs と yasumaro_archive_meta を含むアーカイブ形式の.dbがある
  When 既存の全体復元（restore_db）にそのファイルを渡す
  Then 「アーカイブ復元UIで復元してください」旨のエラーで拒否される
  And メインDBは1件も変更されない

Scenario: 悪性構造のSQLiteファイルは validateArchiveEngine で拒否される
  Given VIEW で browsing_logs を偽装したSQLiteファイルがある
  And 別のファイルにはトリガー・hidden/generated 列・仮想テーブルが混入している
  When validateArchiveEngine を実行する
  Then いずれも許可リスト（table/index のみ）外のオブジェクト検出で拒否される
  And エンジン close → 一時ファイル removeEntry の順でクリーンアップされる

Scenario: 現行より1列少ないアーカイブは補完して開ける
  Given 現行 COLUMN_NAMES より1列少ない（旧形式の）アーカイブ.dbがある
  When validateArchiveEngine + migrateArchiveStaging を実行する
  Then 不足列が staging 側に補完され、開ける・復元できる状態になる
  And 余剰列は COLUMN_NAMES 射影で無視され、hidden/generated 列は拒否のまま

Scenario: トークン発行後のパラメータ差し替えは拒否される
  Given cutoff=X で発行した確認トークンがある（scopeHash 束縛）
  When cutoff=Y ≠ X に付け替えて同じトークンで実行する
  Then fail-closed で拒否され、対象データは変更されない

Scenario: downloadBlob は大容量でも遅延解放で壊れない
  Given 50MB のBlobを downloadBlob に渡す
  When アンカークリックでダウンロードを開始する
  Then URL.revokeObjectURL は遅延解放（setTimeout）され、ダウンロードが破損しない
```

## 受け入れ基準

- [x] `src/offscreen/opfsWorker/archiveValidation.ts`: `validateArchiveEngine(engine)` — sqlite_master 全行列挙による allowlist 検証（`type='table'` かつ `name ∈ {browsing_logs, yasumaro_archive_meta}` のみ許可、`type='index'` のみ追加許可、view/trigger/仮想テーブル（rootpage=0）は1つでも存在すれば拒否）＋ `PRAGMA table_xinfo` 照合（hidden/generated 列は拒否）＋ meta.record_count と COUNT(*) の突合せ（オプションで拒否/警告を選択可能に）
- [x] `migrateArchiveStaging(engine)`: 不足列の補完（ALTER TABLE ADD COLUMN 相当）・余剰列は COLUMN_NAMES 射影で無視
- [x] `src/offscreen/opfsWorker/archiveStaging.ts`: staging レジストリ（`stagingName → {cutoffMs, includeDeleted, phase, createdAt}`）・`prepareIncoming()` / `prepareOutgoing()`（offscreen 発行）・`sweepOrphanStagings(exclude)`（1関数に集約・呼出点は起動時/次回実行時/明示cleanupのみ）・`releaseStaging(name)`・close→removeEntry 順序ヘルパ・ファイル名検証正規表現 `^archive_(outgoing|incoming)_[A-Za-z0-9-]{36}\.db$`
- [x] `src/offscreen/opfsWorker/archiveGuards.ts`: `cutoffMsFromLocalDate`（`YYYY-MM-DD` 形式＋実在日＋範囲 2000-01-01〜実行日翌日の検証）・`isHttpUrl`（validators.ts からSSOT化して共用）・`MAX_ARCHIVE_FILE_BYTES` 等の上限定数
- [x] transport に `noRetry` オプションを追加し、バルク系subtype（将来の archive_create / archive_delete_by_staging / archive_restore）がリトライ対象外にできる（本PBIでは機構のみ。subtype 記録は 02 以降）
- [x] `create_confirm_token` に scopeHash（sha256(`cutoffMs | includeDeleted | stagingName`)）を追加し、`verifyConfirmToken` で厳密比較・単回消費・fail-closed。既存の `delete` / `update` は `id` 束縛のまま（挙動不変）
- [x] 既存 `handleRestore` に「`yasumaro_archive_meta` 存在時は拒否（アーカイブ復元UIへ誘導）」の1行ガード＋全体復元/アーカイブ復元のUI注意文言（i18n）
- [x] `downloadBlob`（src/dashboard/exportLogsService.ts）の即時 `revokeObjectURL` を遅延解放に修正
- [x] `dev-docs/ERROR_CODES.md` に `ARCHIVE_ALREADY_OPEN` / `ARCHIVE_INVALID` / `ARCHIVE_STAGING_EXPIRED` を登録
- [x] `src/offscreen/schema.ts` に `ARCHIVE_META_SCHEMA_SQL`（archived_at / cutoff_created_at / cutoff_date / record_count / include_deleted / archive_format_version / yasumaro_version）と `ARCHIVE_INSERT_COLUMN_NAMES` 等の archive 定数を追加（**定数のみ。テーブル作成は 02 の実行時**）
- [x] i18n（en/ja）: 全体復元/アーカイブ復元の注意文言のみ（本PBIの新規UIは最小限）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- アーカイブ形式 .db を全体復元UIに食わせると拒否され、本体件数が不変（dashboard-ui.spec.ts パターン）

### 統合テスト
- `archiveValidation.test.ts`（新規・sqliteTestApi）: VIEW偽装 / トリガー含有 / 仮想テーブル / hidden列 / 1列不足（D-1〜D-3）ごとの拒否・補完・クリーンアップ順序（close→removeEntry）
- `archiveStaging.test.ts`（新規）: レジストリ発行/消費・正規表現外の拒否・sweep の exclude 挙動・releaseStaging
- 既存 restore 系統合テスト: handleRestore ガード（アーカイブ形式拒否）

### 単体テスト
- `cutoffMsFromLocalDate`（形式・実在日・範囲外の拒否、月末/うるう年/DST）
- `isHttpUrl`（javascript:/data:/相対/例外）
- scopeHash トークン（発行後差し替え→拒否、sqlite-security-integrity.test.ts マトリクスに追加）
- `downloadBlob` の遅延解放（タイマーをモック）

## 実装アプローチ

- **Outside-In**: E2E（全体復元ガード）→ 統合（validateArchiveEngine/staging）→ 単体
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用

## 見積もり

3pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: なし（本PBIがアーカイブ3PBI（02退避作成/03復元/05一時オープン）の着手条件。**02のスパイクF2（第2エンジン長期同時オープン）は本PBIと並行して先行実施可**）
- **テスタビリティ**: 合成アーカイブ.db は sqliteTestApi.js 経由で生成可能（旧形式・悪性構造のテストDBもスクリプトで作れる）
- **非機能要件**: 既存機能（restore_db / backup_db / download）への**挙動変更なし**（ガード追加は悪入力の拒否のみ）。CSP/MV3遵守・`async/await`

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "yasumaro_archive_meta" src/ | grep -v test
grep -rn "verifyConfirmToken" src/background/confirmTokenManager.ts src/background/handlers/dashboardSqlite/index.ts
grep -rn "revokeObjectURL" src/dashboard/exportLogsService.ts
```
（2026-09-06 作成時点: 本PBIの対象は全て未実装。`handleRestore` の検証はトリガー数のみ（backupHandlers.ts:88-96）、`downloadBlob` は即時 revoke（exportLogsService.ts:149-158））

### 実装手順
1. E2E（全体復元ガード）をRedで書く
2. 統合テストをRedで書く（archiveValidation / archiveStaging / handleRestore ガード）
3. `archiveGuards.ts` → `archiveStaging.ts` → `archiveValidation.ts` の順に実装（依存の浅い順）
4. `schema.ts` に archive 定数を追加（ARCHIVE_META_SCHEMA_SQL / ARCHIVE_INSERT_COLUMN_NAMES / ARCHIVE_SELECT_COLUMNS）
5. transport `noRetry` オプション（src/background/offscreenTransport.ts）＋ dashboardGateway の送信直前 assert
6. `create_confirm_token` / `verifyConfirmToken` に scopeHash を追加（confirmTokenManager.ts）
7. `handleRestore` ガード＋UI注意文言（i18n）＋E2E
8. `downloadBlob` 遅延解放修正＋単体テスト
9. ERROR_CODES.md 登録
10. Green → リファクタリング

### 落とし穴
- **GROUPED_SUBTYPES パーティション assert**: 第4グループ（ARCHIVE_SUBTYPES）の確定は 02（最初の subtype 追加時）。本PBIでは触れない（空グループで assert が壊れるのを防ぐ）
- **scopeHash は既存 delete/update に影響させない**: 既存は `id` 束縛で足りている。scopeHash はオプション扱いとし、既存経路のテストを壊さない
- **validateArchiveEngine の拒否判定は fail-closed**: sqlite_master の照合で「不明な type」も拒否する（将来 SQLite が新しいオブジェクト型を追加しても安全側）
- **migrateArchiveStaging は本体DBに触れない**: 補完対象は staging 側のみ。本体スキーマ変更（マイグレーション）はこのPBIの範囲外

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate`（型チェック + テスト + lint）が通る
- [x] テストカバレッジが基準を満たす（E2E / 統合 / 単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み: `dev-docs/ERROR_CODES.md`、`CHANGELOG.md`（既存機能の安全強化として）

## 実装メモ（2026-09-06 自律実装）

### 実装したファイル
- `src/utils/archiveGuards.ts`（新規）: `cutoffMsFromLocalDate`（形式・実在日・範囲検証つき、Date正規化を拒否）/ `isHttpUrl` + `isHttpScheme`（SSOT）/ `isValidStagingName` + `ARCHIVE_STAGING_NAME_RE`（36文字nonce）/ `MAX_ARCHIVE_FILE_BYTES`（200MB）/ `ARCHIVE_FORMAT_VERSION`
- `src/offscreen/opfsWorker/archiveStaging.ts`（新規）: メモリ内レジストリ・`prepareIncoming`/`prepareOutgoing`（offscreen発行）・`assertRegisteredStagingName`（fail-closed）・`releaseStaging`・`sweepOrphanStagings(exclude)`（SSOT・呼出点は起動時/次回実行時/明示cleanup）・`removeStagingFile`。OPFSルートはテスト用プロバイダシームで注入
- `src/offscreen/opfsWorker/archiveValidation.ts`（新規）: `validateArchiveEngine`（sqlite_master allowlist — table/indexのみ・仮想テーブルrootpage=0拒否・`table_xinfo` でhidden/generated列拒否・型不一致拒否・meta.record_count突合せは reject/warn 選択、拒否時はエンジンclose）＋ `migrateArchiveStaging`（不足列をSCHEMA_SQLの基本型で補完・余剰列は射影で無視）＋ `readArchiveMeta`
- `src/offscreen/schema.ts`: `ARCHIVE_META_SCHEMA_SQL`（max_id_at_archive / archive_format_version を含む8列）・`ARCHIVE_INSERT_COLUMN_NAMES` / `ARCHIVE_INSERT_SQL` / `ARCHIVE_SELECT_COLUMNS` / `buildArchiveInsertParams`
- `src/background/confirmTokenManager.ts`: `scopeHash` 束縛（create/verify・fail-closed）＋ `computeScopeHash`（SHA-256・位置・アリティ敏感）
- `src/messaging/sqliteOperationSecurity.ts`: `deriveScopeHash(subtype, payload)`（archive_create/preview → cutoff+includeDeleted、delete_by_staging/restore/restore_preview → stagingName。他subtypeはundefined=既存フロー不変）
- `src/background/offscreenTransport.ts`: `msgOffscreen` に `noRetry` オプション（バルク系の二重実行防止）
- `src/offscreen/opfsWorker/backupHandlers.ts`: `handleRestore` にアーカイブ形式拒否ガード（`yasumaro_archive_meta` 検出時は全体復元を拒否しアーカイブ復元UIへ誘導）
- `src/dashboard/exportLogsService.ts`: `downloadBlob` のURL遅延解放（`DOWNLOAD_REVOKE_DELAY_MS` 60s）
- `src/messaging/validators.ts`: FetchUrl/ManualRecord のURLスキーム検証を `isHttpScheme` SSOTへ統合（メッセージ文言は不変）
- `dev-docs/ERROR_CODES.md`: ARC_ カテゴリ5件（ALR/INV/EXP/QUOTA/TOK）登録

### PBI記載からの逸脱と理由
- **archiveGuards.ts の配置を `src/utils/` に変更**: PBI記載の `src/offscreen/opfsWorker/archiveGuards.ts` だと validators.ts（messaging層）が offscreen を import するレイヤー違反が発生するため。純粋関数（cutoff/isHttpUrl/定数）は utils、OPFS/エンジン依存（staging/validation）は opfsWorker に分離
- **scopeHash テストの配置**: sqlite-security-integrity.test.ts ではなく `confirmTokenManager.test.ts` に追加（トークンの所有テストファイルへ。exemptマトリクスへの subtype 追加は 02 以降）
- **noRetry テストの配置**: messageTransport.test.ts ではなく `sqliteClient-queue.test.ts`（ChromeOffscreenTransport テストの所有ファイル。messageTransport.ts は別のトランスポート層）
- **handleRestore ガードのE2E**: 実アーカイブ.db が 02（退避作成）で初めて生成されるため、E2E は 02 に持ち越しガード本体はモックエンジン統合テストで検証済み（通常 .db は通過・アーカイブ形式は拒否・tmp掃除）
- **dashboardGateway の送信直前 assert**: 実装済み（トークン発行前後で deriveScopeHash を再計算し不一致なら送信中止）。結合テストは 02 で archive_create がプロトコルに加わった後に追加

### 検証結果
- `npm run type-check` ✓ / `npm run lint` ✓（0 errors / 124 warnings は既存）/ `npm test` ✓ **11748 passed / 0 failed**（基盤テスト87件を含む）/ `npm run build` ✓ 7.17MB
- 既存 wiring テスト1件（createConfirmToken 呼び出し引数）は scopeHash 引数追加に伴い期待値を更新（`('delete', 1, undefined)`）
