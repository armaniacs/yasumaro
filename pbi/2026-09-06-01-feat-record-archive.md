# PBI: 日付指定でのレコードアーカイブ作成（SQLite書き出し＋本体削除）

## ユーザーストーリー

yasumaroの長期利用者として、指定日（例: 2026-03-31）以前の閲覧履歴レコードをまとめて標準SQLiteファイルとして退避し、本体DBからは削除してほしい。なぜなら、保持設定を無制限のままだとストレージが増え続け、既存のパージはデータが失われ、全体エクスポート（.db）は日付絞り込みができず不要なレコードまで含むから。

## ビジネス価値

- **ストレージ解放**: `retentionUnlimitedWarning`（entrypoints/options/index.html:442）が示す無制限蓄積問題を「削除ではなく退避」で解消する。退避先はブラウザ外のダウンロードフォルダなので、ブラウザ内ストレージが実際に減る
- **測定方法**: アーカイブ実行前後の `get_count` 差分 = 退避件数。アーカイブ.db のレコード数が退避件数と一致すること。VACUUM 後の本体 .db ファイルサイズ減少
- **外部可読性**: 書き出された .db は DB Browser for SQLite / sqlite3 CLI でそのまま閲覧できる（標準SQLite形式）

## BDD受け入れシナリオ

```gherkin
Feature: 日付指定アーカイブ

Scenario: 境界日以前のレコードをアーカイブして本体から削除する
  Given 本体DBに 2026-01-10 / 2026-03-31 / 2026-04-02 作成のレコードがある
  And ダッシュボードのアーカイブ日付に 2026-03-31 を入力した
  And 実行前確認に対象件数が表示されている
  When ユーザーが確認トークンを取得して実行する
  Then アーカイブ.db のダウンロードが始まる
  And アーカイブ.db には 2026-01-10 と 2026-03-31 のレコードが含まれる
  And アーカイブ.db には 2026-04-02 のレコードは含まれない
  And 本体DBからは 2026-03-31 以前のレコードが物理削除されている
  And 結果表示に「退避件数」と「本体の残存件数」が表示される

Scenario: スター付きレコードも退避対象に含まれる
  Given 境界日以前に is_starred=1 のレコードがある
  And 実行前確認にスター付き件数が表示されている
  When ユーザーが確認して実行する
  Then スター付きレコードもアーカイブ.db に含まれ、本体から削除される

Scenario: 削除済み行はデフォルトで除外され、含めなかった分は戻せない旨が表示される
  Given 本体DBに境界日以前の is_deleted=1 のレコードがある
  And 実行前確認の「削除済み行を含める」チェックボックスはデフォルトでオフである
  When ユーザーがチェックせずに実行する
  Then アーカイブ.db に is_deleted=1 の行は含まれない
  And 確認画面に「含めなかった削除済み行はアーカイブから復元できない」旨が表示される

Scenario: 削除済み行を含めてアーカイブする
  Given 実行前確認で「削除済み行を含める」をチェックした
  When ユーザーが確認して実行する
  Then アーカイブ.db に is_deleted=1 の行も含まれる
  And yasumaro_archive_meta に include_deleted=1 が記録される

Scenario: 対象0件のときは実行しない
  Given 本体DBに境界日以前のレコードが1件もない
  When アーカイブ日付を入力して確認する
  Then 対象件数 0 件であることが表示される
  And アーカイブ処理は実行されず、本体DBは変更されない

Scenario: 確認トークンなしでは実行できない
  Given アーカイブ対象のレコードが存在する
  When 有効な確認トークンなしでアーカイブ操作が送信される
  Then 操作は拒否され、本体DBは変更されない
```

## 受け入れ基準

- [ ] ダッシュボード（オプションページ）に、日付入力 → 実行前確認（対象件数・スター付き件数・削除済み件数・対象期間の最古/最新日）→ 実行 → 結果表示のUIがある
- [ ] 境界日は「指定日の終日まで」を含む（ローカルタイムゾーンの指定日 23:59:59.999 まで、`created_at <= cutoff`）
- [ ] 実行には確認トークンが必要（破壊的操作として既存の tokenRequired 仕様に従う。tokenExempt に含めない）
- [ ] アーカイブ.db は標準SQLiteで、`browsing_logs` テーブル（`SCHEMA_SQL` 準拠・**FTS5/トリガーなし**）と `yasumaro_archive_meta` テーブル（archived_at / cutoff_created_at / cutoff_date / record_count / include_deleted / yasumaro_version）を含む。`id` 列の値は本体と同一
- [ ] 実行前確認に「削除済み行を含める」チェックボックスがある（**デフォルトOFF = is_deleted=1 を除外**。含めない場合は「含めなかった削除済み行はアーカイブから復元できない」旨を確認画面に表示する）
- [ ] アーカイブ.db はOPFSステージングファイル（`archive_outgoing_<nonce>.db`）経由で引き渡され、dashboard がそれを読んでダウンロードする。ステージングファイルはクリーンアップされるまでOPFSに残り、そこから再ダウンロードできる
- [ ] アーカイブ後、本体DBから対象レコードが物理削除され、VACUUM（または同等の空き領域解放）が実行される
- [ ] OPFS バックエンドでのみ提供する（フォールバック環境では既存の生.dbエクスポートと同様「OPFSストレージでのみ利用可能」の注記を表示）
- [ ] 起動時・次回アーカイブ実行時に孤児ステージングファイル（`archive_outgoing_*.db` / `archive_incoming_*.db` / `yasumaro_archive_tmp_*.db`）を掃除する
- [ ] i18n（en/ja）がすべての新規UI文言に適用されている（data-i18n）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードで日付指定 → 確認 → 実行 → 本体件数減少を画面越しに確認（testDir/e2e の dashboard-ui.spec.ts パターンに倣う）

### 統合テスト
- opfsWorker アーカイブハンドラ: 生成されたアーカイブ.db の内容（件数・カラム・meta・FTSなし）と本体削除の整合（sqliteTestApi.js を使う既存テストパターンに倣う）
- 境界値: `created_at == cutoff` は含まれる / `cutoff + 1ms` は含まれない
- セキュリティ: トークンなしでは拒否される（既存の tokenRequired マトリクステストに追加）
- ステージングファイル（`archive_outgoing_*.db`）が検証失敗時に残らず、クリーンアップが機能すること

### 単体テスト
- cutoff 計算（日付文字列 → ローカル終日UTCミリ秒変換、月境界・夏時間（DST）切り替え日）
- アーカイブファイル名生成（`yasumaro_archive_YYYY-MM-DD.db`、同日再実行時の接尾辞）
- meta 生成（include_deleted の反映、record_count と実行件数の一致）
- 削除SQL + VACUUM の実行順序
- 例外ハンドリング: アーカイブ生成が失敗した場合、本体を一切削除しない（fail-safe順序）

## 実装アプローチ

- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり

5pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: なし。本PBIがアーカイブファイル形式（`browsing_logs` + `yasumaro_archive_meta`、FTS5なし）を定義し、PBI-02 / PBI-03 がそれを参照する
- **テスタビリティ**: offscreen ハンドラは `sqliteTestApi.js` 経由で実SQLiteによる統合テストが可能。dashboard 側は Gateway / exportDb 相当をモック
- **非機能要件**: 10万件規模でのアーカイブ時間（SELECT→INSERT→DELETE→VACUUM が同期的に長時間化する可能性 → 進捗表示または将来的な非同期化を検討）。CSP遵守（インラインスクリプト禁止）・MV3遵守・`async/await` 使用・`onMessage` の `return true`

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# アーカイブ・退避関連の既存実装の有無を再確認
grep -rn "archive\|ARCHIVE" src/offscreen/ src/messaging/ src/dashboard/ | grep -v test
# 全体.dbエクスポートとダウンロードの既存パターン
grep -rn "exportDb\|downloadBlob" src/dashboard/
# 保持パージ（削除のみ）の現状
grep -rn "purgeOldRecords" src/offscreen/ | head
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。
（2026-09-06 作成時点の調査結果: 日付指定の退避機能は未実装。既存は「削除のみのパージ」「全体バックアップ」「全体.dbエクスポート」のみ）

### 実装手順
1. E2EテストをRedで書く（ダッシュボードUIフロー: 日付入力→確認→実行→件数確認）
2. 統合テストをRedで書く（opfsWorker アーカイブハンドラ: 生成内容・本体削除・境界値・トークン拒否）
3. メッセージ経路に `archive_before`（仮称）を追加: `src/messaging/sqliteMessages.ts` / `sqliteRpcClient.ts`（MaintainOp）、`src/background/handlers/dashboardSqliteProtocol.ts`（subtype）、`src/messaging/sqliteOperationSecurity.ts`（`ALL_DASHBOARD_SQLITE_SUBTYPES` に追加。tokenExempt には入れない＝デフォルトでトークン必須）、`src/messaging/validators.ts`、`src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts`（**`MAINTENANCE_BATCH_SUBTYPES` への追加が必須 — router はこの Set から dispatch を導出する**）
4. opfsWorker にアーカイブハンドラを実装（src/offscreen/opfsWorker/ に新ファイル。purgeHandlers.ts / backupHandlers.ts パターンに倣う）:
   - `archive_outgoing_<nonce>.db` を OPFS に直接作成し `createEngine` で開く（同一ワーカー内の第2エンジンは backupHandlers.ts:88 の restore 検証が先例。**createEngine はDDLフリー（sqliteEngine.ts:47-51）。SCHEMA_SQL適用は opfsWorker.ts:116-120 のメインエンジン初期化経路にあるため、そのヘルパーを流用しないこと**）
   - `SCHEMA_SQL` を適用（FTS5_STATEMENTS は適用しない）→ `yasumaro_archive_meta` テーブル作成 → meta 1行書き込み（include_deleted 含む）
   - 1トランザクションで `SELECT ... WHERE created_at <= ?`（+ include_deleted に応じ `AND is_deleted = 0`）`ORDER BY id` → アーカイブ側へ INSERT（`buildInsertParams` を流用。id 含む）
   - 検証（アーカイブ側件数 == SELECT件数、テーブル存在）→ close → `PRAGMA wal_checkpoint(TRUNCATE)`（backupHandlers.ts:53 の先例）
   - **検証が完全に成功した後にのみ** 本体で `DELETE FROM browsing_logs WHERE created_at <= ?`（+ include_deleted に応じ `AND is_deleted = 0`）+ `VACUUM` を実行し、応答は**ステージングファイル名のみ**（バイト列をメッセージに載せない）
5. ダッシュボードUIを追加（`entrypoints/options/index.html` + `src/dashboard/`）: 配置は保持ポリシー節の近くか Export Logs パネル。日付入力・削除済み行チェックボックス・プレビュー（対象件数・スター付き件数・削除済み件数・最古/最新日）・confirmToken取得（`create_confirm_token`）・**OPFSステージングファイルを読んで `downloadBlob`**・クリーンアップまでの再ダウンロード
6. i18n（`public/_locales/en/messages.json` / `public/_locales/ja/messages.json`）に data-i18n キーを追加
7. Green → リファクタリング（ハンドラの共通化・テスト整理）

### 落とし穴
- **DELETE だけではファイルサイズは減らない**: OPFS 上の SQLite は空き領域を freelist に残す。VACUUM 必須。sqlite-wasm の OPFS VFS で VACUUM が動くかを最初に検証し、動かない場合は `auto_vacuum` 方式へ切り替える設計にしておく
- **削除→ダウンロード失敗のデータロス**: ダウンロード（アンカークリック）は完了検知できない。アーカイブはOPFSステージングファイルに残るため、クリーンアップまでの間は再ダウンロード可能にする（メモリ内Blob保持に依存しない）
- **境界日のタイムゾーン**: `created_at` はUTCミリ秒。UIのローカル日付を「その日の24:00（UTC換算）」へ変換しないと1日ずれる（単体テストで固定）
- **大容量転送はメッセージに載せない**: アーカイブはOPFSステージング経由で引き渡す。base64応答（`backup_db` パターン）は chrome メッセージングの実用上限に触れる可能性があるため使わない（deep-dig 2026-09-06 の決定）
- **削除済み行のデフォルト除外**: 含めない場合、その分はアーカイブに存在しない。確認画面の注意文言（「含めなかった削除済み行はアーカイブから復元できない」）を省略しないこと
- **本体の FTS 索引**: 本体からの DELETE で `browsing_logs_ad` トリガーが発火する。FTS 索引との整合は既存トリガーに委ねる（アーカイブ.db 側にはトリガーを作らない）
- **WAL 未チェック**: ステージングファイルへ書き出す前に `wal_checkpoint(TRUNCATE)` を忘れると最新データがアーカイブに入らない
- **audit_log は対象外**: 本PBIでは `browsing_logs` のみ退避する

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック + テスト + lint）が通る
- [ ] テストカバレッジが基準を満たす（E2E / 統合 / 単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み: `docs/SETUP_GUIDE.md` の保持ポリシー節、`public/PRIVACY.md` と `docs/PRIVACY.md`（**両方同時に**同一内容へ更新）、`CHANGELOG.md`
