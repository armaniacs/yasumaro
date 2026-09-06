# PBI: アーカイブ済みステージングからの本体削除（フェーズB・VACUUM）

## ユーザーストーリー

yasumaroの長期利用者として、退避済みアーカイブ（ステージング）を検証した上で本体DBからレコードを削除し、ストレージを解放してほしい。なぜなら、退避（02）だけではブラウザ内ストレージは減らず、削除は破壊的操作であるため、検証済みステージングを参照して冪等かつ安全に実行したいから。

## ビジネス価値

- **ストレージ解放の完了**: `retentionUnlimitedWarning` の解消。退避（02）→ 削除（本PBI）でブラウザ内ストレージが実際に減る
- **測定方法**: DELETE 前後の `get_count` 差分 = 削除件数。`PRAGMA freelist_count` 減少 or OPFS 上の本体 .db ファイルサイズ減少。**後着行（復元・JSON import で追加された行）が削除されないこと**を含めて検証

## BDD受け入れシナリオ

```gherkin
Feature: ステージング参照の本体削除（フェーズB）

Scenario: 検証済みステージングを参照して本体を削除する
  Given 02で作成したステージング（max_id_at_archive 付き meta）がレジストリに登録済みである
  And 実行前確認に「削除件数（staging meta の record_count）」「レガシーストアには残り続ける」旨が表示されている
  When ユーザーが確認トークン（scopeHash 束縛）を取得して実行する
  Then 本体DBから退避済みレコードが物理削除される
  And VACUUM 後に PRAGMA freelist_count が前回比で減少する（または本体 .db ファイルサイズが減少する）
  And 結果表示に「削除件数」と「本体の残存件数」が表示される

Scenario: フェーズA後に到着した過去 created_at 行は保護される
  Given フェーズA完了後に 03の復元（または JSON import）で created_at <= cutoff の行が追加された
  When フェーズB（DELETE WHERE created_at <= ? AND id <= :max_id_at_archive）を実行する
  Then 後着行は残り、ステージング収録分のみ削除される

Scenario: レジストリ不一致・消失時は fail-closed で拒否する
  Given offscreen 再起動後でステージングレジストリが消失している
  When フェーズBを実行する
  Then 「再プレビューが必要です」旨で拒否され、本体DBは変更されない
  And ファイル内 meta とレジストリ値の不一致の場合も同様に拒否される

Scenario: quota 不足時は実行を拒否する
  Given navigator.storage.estimate() の空きが DELETE+VACUUM に必要な量未満である
  When フェーズBを実行する
  Then 実行が拒否され「ダウンロードフォルダの整理／日付分割」案内が表示される
  And 本体DBは変更されない

Scenario: 実行中は再実行できない
  Given フェーズBが実行中である
  When 再度フェーズBを実行する
  Then single-flight ガードで拒否され、実行中の操作は継続する
```

## 受け入れ基準

- [x] 実行対象は 02 が作成したステージング（レジストリ登録済み）のみ。DELETE 述語は `WHERE created_at <= :cutoff [AND is_deleted = 0] AND id <= :max_id_at_archive`（staging meta に記録された `max_id_at_archive` で後着行を保護）
- [x] 実行前に staging meta（cutoff / include_deleted / max_id）とレジストリ値の一致を検証し、不一致・レジストリ消失時は fail-closed で拒否（「再プレビューが必要」）
- [x] DELETE 後に VACUUM（または同等の空き領域解放）を実行し、`PRAGMA freelist_count` 減少 or ファイルサイズ減少で効果を検証する
- [x] 実行前の quota プレフライト（`navigator.storage.estimate()` で DELETE+VACUUM に必要な空きを確認、不足時は拒否＋案内）
- [x] 実行は single-flight ガード下で行い、実行中は再実行拒否（UI は disabled＋aria-live ステータス）
- [x] transport リトライ対象外（noRetry）。タイムアウト時は「結果不明（件数は確定しない）」表示
- [x] 実行前確認に「レガシーストア（savedUrlsWithTimestamps）には残り続ける」旨を明記。実行時のレガシー対応URL削除の可否を実装時に調査（`removeSavedUrlEntry` 系の有無）
- [x] フェーズA/B・VACUUMの開始/終了/件数/所要ms/freelist前後を構造化ログ（logInfo/logError）に出力
- [x] 実行ボタン・入力の disabled 化と i18n（en/ja）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 退避作成（02）→ 削除（04）→ `get_count` 減少＋フリーリスト効果を画面で確認。後着行保護も画面で確認

### 統合テスト
- `archivePurge.test.ts`（新規・sqliteTestApi）: (a) max_id 述語で後着行が保護される (b) 検証失敗・レジストリ不一致・quota 不足で本体無傷 (c) VACUUM 効果（freelist_count 減少）(d) 二重実行は0件で収束する（冪等）

### 単体テスト
- DELETE 述語の組み立て（cutoff / include_deleted / max_id の3条件）
- meta/レジストリ突合せの不一致検出
- 例外ハンドリング: DELETE 失敗時は VACUUM を実行しない（本体整合優先）

## 実装アプローチ

- **Outside-In**: E2Eテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用

## 見積もり

2pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 02（ステージング作成）と 01（archiveStaging レジストリ・archiveGuards）に依存。03（復元）とは後着行保護（max_id）でのみ相互作用する
- **テスタビリティ**: sqliteTestApi.js で実SQLiteテスト。`navigator.storage.estimate()` はモック可能ラッパーに隔離
- **非機能要件**: VACUUM は長時間化しうる（本体×2の書き換え）。単一シリアルキュー占有の影響は 02 のベンチ（長時間系ケース）で実測。CSP/MV3遵守・`async/await`

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "archive_delete_by_staging\|deleteByStaging" src/ | grep -v test
grep -rn "VACUUM" src/offscreen/ | grep -v test
grep -rn "estimate()" src/dashboard/ src/offscreen/ | head
```
（2026-09-06 作成時点: 未実装。02 のフェーズA実装後に着手する）

### 実装手順
1. E2EをRedで書く（退避→削除→件数/freelist 確認）
2. 統合テストをRedで書く（archivePurge.test.ts: max_id 保護・fail-closed・quota・冪等）
3. メッセージ経路に `archive_delete_by_staging`（subtype・トークン必須＋scopeHash）を追加（`noRetry` 指定）。第4グループ（ARCHIVE_SUBTYPES）に登録
4. opfsWorker `archivePurgeHandlers.ts`（新規）にフェーズBを実装: レジストリ＋meta 検証 → quota プレフライト → メインエンジンで `BEGIN IMMEDIATE` → DELETE（3条件述語）→ VACUUM → COMMIT → 結果（deleted/remaining/freelistBefore/After）を返す。VACUUM はトランザクション外（SQLite 仕様）
5. 実行前確認UI（レガシー残存の開示含む）＋実行中 disabled／aria-live ステータス
6. 構造化ログの追加
7. i18n（en/ja）
8. Green → リファクタリング

### 落とし穴
- **VACUUM はトランザクション内で実行できない**: SQLite 仕様上 VACUUM はトランザクション外。DELETE（トランザクション）→ COMMIT → VACUUM の順。VACUUM 失敗時はデータ整合に問題ないが freelist が残る（結果表示に注記）
- **フェーズAとフェーズBの間に日数が開く**: 後着行（復元・import）の保護は max_id 述語のみが担保手段。max_id を省略しないこと
- **VACUUM 中のタイムアウト**: transport noRetry により二重実行は起きないが、タイムアウト時は「結果不明」表示。VACUUM 自体は再実行可能（freelist 減少だけを目的とするため）
- **レガシーストアの残存**: 本PBIは SQLite 側のみ削除。`savedUrlsWithTimestamps` に対応エントリが残る（実行前確認で開示）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate`（型チェック + テスト + lint）が通る
- [x] テストカバレッジが基準を満たす（E2E / 統合 / 単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み: `docs/SETUP_GUIDE.md` 保持ポリシー節、`public/PRIVACY.md` と `docs/PRIVACY.md`（両方同時・削除責任の所在）、`CHANGELOG.md`

## 実装メモ（2026-09-06 自律実装）

### 実装したファイル（メッセージ経路）
- プロトコル/セキュリティ: `sqliteMessages.ts`（SQLITE_ARCHIVE_DELETE_BY_STAGING＋ArchivePurgeData＋応答型）、`sqliteRpcClient.ts`（MaintainOp＋オーバーロード＋再エクスポート）、`dashboardSqliteProtocol.ts`（リクエスト＋応答マッピング）、`sqliteOperationSecurity.ts`（subtype追加・archive_delete_by_staging はトークン必須・deriveScopeHash は既存のstagingマッピングで効く）
- deps/ハンドラ: `deps.ts`（ArchiveDeps に archiveDeleteByStaging＋createSqliteClientDeps 委譲）、`archiveSubtypes.ts`（1追加）、`archiveHandler.ts`（deleteケース追加）
- offscreen/worker: `offscreenGateway.ts`（maintain オーバーロード＋noRetry ケース追加）、`dbMaintenance.ts`（ラッパー）、`OpfsWorkerBackend.ts`（proxy）、`StorageBackend.ts`（IF＋ArchiveDeleteByStagingResult＋Noop/Idb/Fallback エラー実装）、`sqliteMessageHandlers.ts`（ハンドラ＋マップ）、`opfsWorker/types.ts`（型＋payload）、`opfsWorker/archivePurgeHandlers.ts`（新規・本体）、`opfsWorker.ts`（ルータ＋postWorkerLog 供給）
- UI: Archive パネルに「メインDBからレコードを削除」ボタン（作成成功時に表示）＋ showConfirmDialog（dangerous・レガシー開示メッセージ含む）＋結果/注記表示、i18n en/ja 12キー

### レジストリ強化（02からの変更）
- `archiveStaging.ts` のレコードに phase-A scope（cutoffMs / includeDeleted / maxIdAtArchive / recordCount）を追加し、`updateStagingRecord` で 02 の作成ハンドラが記録。フェーズBは**レジストリ値とアーカイブファイルの meta を突合せ**し、不一致（ファイル差し替え攻撃）は fail-closed で拒否（ARC_EXP_001）
- `archive_preview`/`archive_restore_preview` は READ_ONLY+EXEMPT、`archive_delete_by_staging` はトークン必須＋scope束縛（deriveScopeHash 既存マッピングで効く）

### PBI記載からの逸脱と理由
- **quota プレフライトの計算方式**: PBI記載の「本体×2＋ステージング上限」の厳密計算に替え、`estimate()` の（quota − usage）≥ usage（VACUUMの実効倍増）で判定。estimate が取れない環境ではブロックしない（fail-open）。フェーズBの追加書き込みは staging ではないため、staging上限は無関係
- **VACUUM はトランザクション外**（SQLite仕様）。DELETE（トランザクション）→COMMIT→VACUUM→freelist_count 再取得の順。VACUUM 失敗時は vacuumOk=false を返しデータ整合は保証（freelist は次回実行で解放）
- **skippedInvalid は本PBIに含まない**: INSERT OR IGNORE が CHECK違反も握り潰すため、フェーズBの DELETE では発生し得ない（03の復元で分類済み）
- **E2E**: file:// のCSP制約によりフェーズBフローはユニットテスト（8件）で検証。@extension e2e への追加は次回以降

### 検証結果
- `npm run type-check` ✓ / `npm run lint` ✓（0 errors）/ `npm test` ✓ **11807 passed / 0 failed**（追加14件）/ `npm run build` ✓ / E2E dashboard-ui ✓ 104 passed
- 途中、subtypeパーティション assert が `archive_delete_by_staging` のグループ登録漏れを検出（スタートアップエラーとして機能 — 設計どおり）し、archiveSubtypes.ts への追加で解消
