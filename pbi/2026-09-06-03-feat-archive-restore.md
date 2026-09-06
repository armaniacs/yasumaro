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

- [ ] ファイル選択 → プレビュー（`yasumaro_archive_meta` の表示: レコード件数・対象期間・アーカイブ作成日時・**削除済み行を含むか（include_deleted）**）→ 確認トークン付き実行 → 結果表示（復元件数 / スキップ件数、is_deleted を含む場合はアクティブ・削除済みの内訳）のUIがある
- [ ] 重複判定は `UNIQUE(url, created_at)` に基づく（`INSERT OR IGNORE` 相当）
- [ ] 復元レコードは**新しい id で追加される**（アーカイブ内の元 id を引き継がない）
- [ ] 復元されたレコードの FTS 索引が更新される（メインDBの INSERT トリガーに依存）
- [ ] obsidian_synced / gist_synced などフラグ列はアーカイブ時点の値を保持する（再同期によるObsidian重複書き込みを起こさない）
- [ ] 大きなアーカイブでも転送できるよう、dashboard は選択ファイルを OPFS ステージング（`archive_incoming_<nonce>.db`）へ書き込み、メッセージは**ファイル名のみ**を運ぶ（バイト列のbase64転送は10MB上限に触れるため使わない — deep-dig 2026-09-06 決定）
- [ ] 実行前にアーカイブのバリデーションを完了させ、失敗時はメインDBを一切変更しない。バリデーションには**トリガーを含まないこと**を含める（ユーザー指定ファイルは信頼できない入力。`restore_db` の検証と同一の fail-closed 方針）
- [ ] i18n（en/ja）がすべての新規UI文言に適用されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- アーカイブ作成 → 復元の往復で件数が元に戻ることを画面越しに確認（PBI-01のE2Eと組み合わせ）

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

- **依存関係**: PBI-01 が定義するアーカイブファイル形式に依存。**PBI-02（一時オープン・編集）には依存しない** — 編集されていないアーカイブの復元は本PBI単独で完結する。PBI-02で編集されたアーカイブも同様に復元できる
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
   - dashboard が選択ファイルを OPFS ステージング（`archive_incoming_<nonce>.db`）へ書き込み、メッセージは**ファイル名のみ** → `createEngine` → バリデーション（PBI-02の手順3と同一パターン: `browsing_logs` + `yasumaro_archive_meta` 存在 + **トリガー数 0**。`createEngine` はDDLフリー（sqliteEngine.ts:47-51）でメイン初期化ヘルパー（opfsWorker.ts:116-120）は流用しない。共通化を検討）
   - 一時エンジンから `SELECT`（id を除く全カラム + `buildInsertParams` 相当のマッピング）→ メインエンジンへ `INSERT OR IGNORE`（INSERT_IGNORE_SQL 流用。id は含めない）
   - 結果集計（changes から restored / skipped を算出）→ 一時ファイル削除（finally）
4. メッセージ経路の追加: `sqliteMessages.ts` / `sqliteRpcClient.ts`（MaintainOp）/ `dashboardSqliteProtocol.ts`（subtype）/ `sqliteOperationSecurity.ts`（`ALL_DASHBOARD_SQLITE_SUBTYPES` に追加・tokenExempt には入れない＝デフォルトで**トークン必須**）/ `validators.ts`（転送上限の設計参照）/ `dashboardSqlite/maintenanceBatchHandler.ts`（**`MAINTENANCE_BATCH_SUBTYPES` への追加が必須 — router はこの Set から dispatch を導出する**）
5. ダッシュボードUI: アーカイブセクションに「メインDBへ復元」。プレビュー（meta表示）→ confirmToken（`create_confirm_token`）→ 実行 → 結果表示
6. i18n（en/ja）
7. Green → リファクタリング（PBI-02と一時エンジン生成・バリデーションの共通化）

### 落とし穴
- **元 id の引き継ぎ禁止**: アーカイブの id をそのまま INSERT すると、メインDBの PRIMARY KEY 衝突で「url も created_at も異なる別レコード」が誤ってスキップされる。id は必ず再採番（AUTOINCREMENT）に任せる
- **FTS トリガーはメインDB側で自動発火**: `browsing_logs_ai` トリガーが INSERT 時に FTS を更新する。復元側で FTS を手動更新しない（二重索引になる）
- **同期フラグの扱い**: obsidian_synced=1 のまま復元するため Obsidian への再書き込みは起きない。再同期したいユーザーには既存の `resync_legacy` を案内する
- **編集済みレコードの扱い**: PBI-02で url を変更したレコードは、復元時に「新しい記録」として追加される（元の記録との重複判定が成立しない。なお `created_at` は既存 `UPDATABLE_FIELDS` に含まれないためアーカイブ編集では変更不可）。仕様としてドキュメントに明記する
- **削除済み行の復元**: PBI-01で「削除済み行を含める」をチェックしたアーカイブは is_deleted=1 の行を持つ。フラグ保持のまま復元するため表示には出ないが本体容量を占める。結果表示に内訳（アクティブ / 削除済み）を出してユーザーが把握できるようにする
- **転送されるのはファイル名のみ**: 行の SELECT（一時エンジン）と INSERT（メインエンジン）はどちらも offscreen 内で完結する。アーカイブ.db も OPFS ステージング経由で渡すため、バイト列・行ともメッセージに載らない（deep-dig 2026-09-06 決定）。JSON import の rows-per-request（`MAX_IMPORT_ROWS` / `MAX_IMPORT_BYTES`）は設計参照であり流用先ではない
- **外部由来のアーカイブは信頼できない入力**: メインDBの CHECK 制約（is_starred / scroll_ratio / visit_duration）は INSERT 時に発火するが、url スキームの検証は CHECK にない。既存メッセージバリデータ（http/https 以外を拒否）と同等の検証を INSERT 前に適用する
- **部分更新の禁止**: 検証（バリデーション）→ 取り込みの順序を厳守し、取り込みは1トランザクションにする（ステージング方式のため行転送のチャンクは存在しない）。途中失敗でメインDBが部分更新されないことを統合テストで担保

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate`（型チェック + テスト + lint）が通る
- [ ] テストカバレッジが基準を満たす（E2E / 統合 / 単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み: `docs/SETUP_GUIDE.md`（復元節）、`CHANGELOG.md`
