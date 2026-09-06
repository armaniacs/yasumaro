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
  Given PBI-01で作成したアーカイブ.db がある
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

- [ ] ファイル選択（accept=".db"）→ 一時オープン → 一覧 / 検索（LIKE）→ 詳細表示 → 編集 → 保存（元ファイルへ書き戻し）→ 閉じる、の一連が動作する
- [ ] オープン中、メインDB宛ての操作（検索・件数・編集・パージ等）がアーカイブ側へ誤ルーティングされない（セッション状態でデータソースを明確に分離）
- [ ] 書き戻しは File System Access API（`showOpenFilePicker` の readWrite ハンドル）で元ファイルに上書きする（編集済み.db はステージング `archive_outgoing_<nonce>.db` 経由で dashboard に引き渡す）。利用できない環境では編集済み .db の再ダウンロード（`downloadBlob`）で代替する
- [ ] 編集可能フィールドは既存 `UPDATABLE_FIELDS` のホワイトリストに従う
- [ ] オープン時のバリデーション: SQLiteとして読める + `browsing_logs` テーブル存在 + `yasumaro_archive_meta` が読めること（PBI-01の形式）+ **トリガーを含まないこと**（ユーザー指定ファイルは信頼できない入力。`restore_db` の検証と同一の fail-closed 方針）。失敗時は拒否してクリーンアップ
- [ ] 閉じる・失敗時・ページ再読み込みのいずれでもOPFS上の一時ファイル（`archive_incoming_*.db` / `archive_outgoing_*.db`）が残らない
- [ ] 検索はアーカイブ内ではLIKE検索に限定する（アーカイブ.dbにFTS5はない）
- [ ] 同時に開けるアーカイブは**1つ**に制限する（オープン中に再度開こうとした場合は案内して拒否。複数同時オープンは将来候補）
- [ ] i18n（en/ja）がすべての新規UI文言に適用されている

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

- **依存関係**: PBI-01 が定義するアーカイブファイル形式（`browsing_logs` + `yasumaro_archive_meta`）に依存。**PBI-01の完了後に着手する**
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
- **一時ファイルの孤児**: 例外・再読み込みでOPFSに `archive_incoming_*.db` / `archive_outgoing_*.db` / `yasumaro_archive_tmp_*.db` が残る。起動時・オープン時に `*_tmp_*.db` / `archive_incoming_*.db` / `archive_outgoing_*.db` を掃除するか、固定nonce管理で確実に削除する（PBI-01の孤児掃除基準と共通化）
- **FTS5の誤用**: アーカイブ.dbにはFTS5テーブルがない。メインDBの検索コードをそのまま流用すると「no such table: browsing_logs_fts」で落ちる。アーカイブ検索はLIKEに限定する
- **書き戻しの衝突検知はしない**: ユーザーがオープン中に元ファイルを外部で書き換えていた場合、保存は上書きになる。この仕様をUI文言とドキュメントに明記する
- **File System Access API のコンテキスト**: options ページで利用できるバージョンとそうでないケースが報告されており、テスト環境では使えない。フォールバック（`<input type="file">` + 保存時の再ダウンロード）を対等な経路として実装・テストする
- **初期化ヘルパーの誤用**: `createEngine` はDDLフリー（sqliteEngine.ts:47-51）。メインエンジン初期化（opfsWorker.ts:116-120）は SCHEMA_SQL + WAL設定 + マイグレーションを適用するため、これを流用すると**ユーザーのアーカイブファイルにFTS5やaudit_logが作成され、保存時に永続化される**。必ず素の `createEngine` を使う
- **大容量転送はステージング経由**: dashboard→background のメッセージは10MB上限（`MAX_RESTORE_DB_BYTES`、VULN-008）があるため、バイト列のbase64転送は不可。OPFSステージング（メッセージはファイル名のみ）を採用（deep-dig 2026-09-06 決定）。ステージングが使えない環境でのみbase64チャンク転送を検討する
- **編集は一時エンジンにしか反映されない**: 保存忘れで編集が失われるため、閉じる時の未保存警告は必須（シナリオ4）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック + テスト + lint）が通る
- [ ] テストカバレッジが基準を満たす（E2E / 統合 / 単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み: `docs/SETUP_GUIDE.md`（アーカイブの閲覧・編集節）、`CHANGELOG.md`
