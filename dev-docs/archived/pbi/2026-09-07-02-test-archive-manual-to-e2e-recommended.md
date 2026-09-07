# PBI: アーカイブ機能 手動推奨/任意項目（Y・G群）のE2E自動化

> G6（孤児ステージング掃除）は「統合テストは可能だが通しは手動維持」の部分自動化のため、R5/R6 と合わせて **2026-09-07-03** に分離した。本PBIは完全自動化できる Y2/Y3/Y4/Y6/G3/G4/G5/G8 を対象とする。

## ユーザーストーリー

yasumaro の開発者として、`docs/MANUAL_TEST_ARCHIVE.md` の 🟡推奨・🟢任意項目のうち自動化できるものをE2E/統合テスト化してほしい。なぜなら、必須項目（R1〜R6・PBI 2026-09-07-01 / 03）を自動化しても、UX品質・細部の項目が手動のまま残ると結局リリース前の人手確認が減らないから。

## 前提

本PBIは 2026-09-07-01 に依存する。特に以下を再利用する:
- `archiveDbReader.ts`（export バイト列を SQLite で open するヘルパ）— Y3 で使用
- 01 で新設する DEV ガード機構 + 本番混入検出の枠組み — Y2・G8 のテスト専用フックで使用

**注意**: 「テスト専用フラグは 01 で導入済みのパターンを踏襲」と本文に書いているが、01 着手前の時点で `archiveStaging.ts` / `opfsWorker.ts` の既存シーム（`resetArchiveStagingForTesting` 等）に DEV ガードは**存在しない**。01 がガード機構を作ることが前提。

## スコープ: Y・G 群の分類

### ✅ 自動化する

| # | 手法 |
|---|------|
| Y2 IDB フォールバック環境での拒否 | ※下記「Y2 の前提訂正」必読。現状 UI に事前 disabled ガードは無く、**操作実行時に `error: 'Archive requires OPFS storage.'` が返る**（`IdbVfsBackend.ts:293` / `FallbackStorageAdapter.ts:58`、i18n キーでなく生英語）。検証は「fallback backend 環境で `archive_create` 等を投げるとこのエラー応答になる」を assert |
| Y3 編集→保存→書き戻し内容 | `archive_open` → `archive_update`（タイトル編集）→ `archive_save` → `archive_export` → `archiveDbReader` で編集後タイトルを SQL 照合 |
| Y4 復元後のレコード内容照合 | 復元後に `search` または直接 SELECT で title/url/is_starred を値レベルで照合（既存 E2E は件数のみ） |
| Y6 削除済みレコードを含めた復元 | `includeDeleted:true` で Phase A → 復元 → 応答の `restoredDeleted` 集計値を assert |
| G3 検索語のワイルドカードエスケープ | **対象は `archive_query` subtype**（`archiveSessionHandlers.ts:65` `escapeLike` + `LIKE ... ESCAPE '\'`）。`search` subtype は FTS5/trigram 経路で LIKE ワイルドカードの概念がなく別物なので対象外。`archive_open` したセッションに対し `%` `_` `\` を含むクエリを投げ、リテラル一致することを assert |
| G4 レガシーストア残存 | Phase B 後に `page.evaluate` で `chrome.storage.local` の `savedUrlsWithTimestamps` に対応エントリが残ることを assert（診断パネル UI 目視は手動に残す） |
| G5 録画との並行動作 | `content-script-recording.spec.ts` の手法で録画を発生させつつ `archive_create` を実行、録画がブロックされず両方完了することを assert |
| G8 VACUUM 失敗時の注記表示 | `__setEngineForTesting` 系で VACUUM を失敗させるフェイクエンジンを注入し、Phase B 応答の `vacuumOk:false` と UI 注記表示を assert |

> G6（孤児ステージング掃除）は 2026-09-07-03 に移動。

### ❌ 自動化不可（手動のまま維持・理由を明記）

| # | 理由 |
|---|------|
| Y1 ロケール切替（ja↔en） | `chrome.i18n.getMessage` の言語は拡張起動時のブラウザ UI 言語で固定。Playwright の `locale` は `navigator.language` を変えるが `chrome.i18n` には効かない。拡張再ロードが必要で E2E の1コンテキスト内では不可 |
| Y5 再読み込み後のセッション再接続（file://） | ダウンロード済み .db を file:// で開いた復元セッションの検証。拡張ページ外の file:// では拡張 JS が走らない。※拡張ページ内での reload → STATUS 再接続は別途 E2E 化可能なので、その部分だけ切り出して Y5' として自動化を検討（本PBIでは対象外） |
| G1 トークン失効（60秒） | 60秒待ちが E2E タイムアウト（60s）と衝突。`Date.now` モックは SW/worker 内に届かない。トークン TTL のロジック自体は `confirmTokenManager` のユニットテストでカバー済み |
| G2 モーダルの実キーボード操作 | 「実キーボードと jsdom の一致」の担保。Playwright の `keyboard.press` は合成イベントで実キーボード担保にならない。フォーカストラップのロジックは `focusTrapManager` のユニットと `archive-edit-modal` のテストでカバー済み |
| G7 quota 不足の実環境拒否 | 実ディスク quota 枯渇の再現。`navigator.storage.estimate()` はモックできるが「実 quota 不足時の挙動」の担保にはならない。プレフライトのロジックは `archivePurgeHandlers.test.ts` でモックカバー済み |

## BDD受け入れシナリオ

```gherkin
Feature: アーカイブ推奨/任意検証の自動化

Scenario: Y2 OPFS非対応環境ではアーカイブ操作が拒否される
  Given StorageBackend が fallback/IDB に強制された状態である
  When archive_create（または archive_preview）を実行する
  Then 応答が success:false で error に "Archive requires OPFS storage." を含む
  # 注: 現状 UI に事前 disabled ガードは無い。「パネルを開いた時点で無効化」を
  # 期待値にしない（下記「Y2 の前提訂正」）

Scenario: Y3 編集したタイトルがアーカイブ .db に書き戻される
  Given staging を archive_open した
  When archive_update でレコードのタイトルを "edited-title-<stamp>" に変更し archive_save する
  And archive_export のバイト列を better-sqlite3 で open する
  Then browsing_logs に "edited-title-<stamp>" のレコードが存在する

Scenario: Y4 復元後のレコードが値レベルで一致する
  Given title/url/is_starred を持つレコードを含む staging を作成した
  When 本体を空にして archive_restore を実行する
  Then 本体の該当レコードの title / url / is_starred がアーカイブ内の値と一致する

Scenario: Y6 削除済み行を含めた復元で restoredDeleted が集計される
  Given is_deleted=1 の行を含めて includeDeleted:true で Phase A を実行した
  When archive_restore を実行する
  Then 応答の restoredDeleted が削除済み行数と一致する

Scenario: G3 archive_query のワイルドカードはリテラル扱い
  Given "100%_done" というタイトルと "100Xdone" というタイトルのレコードを含む staging を archive_open した
  When archive_query クエリ "100%_done" を実行する
  Then "100Xdone" はヒットしない（% と _ がワイルドカードとして動作しない）

Scenario: G4 Phase B 後もレガシーストアにエントリが残る
  Given レガシー savedUrlsWithTimestamps に対応エントリがある状態で Phase A/B を実行した
  When chrome.storage.local の savedUrlsWithTimestamps を読む
  Then 対応 URL のエントリが残っている

Scenario: G5 アーカイブ作成中も録画は成功する
  Given content script が engagement を記録しようとしている
  When 同時に archive_create を実行する
  Then 録画（記録）がブロックされず完了する
  And archive_create も正常完了する

Scenario: G8 VACUUM 失敗時は vacuumOk:false と注記が出る
  Given VACUUM が失敗するフェイクエンジンを注入した
  When Phase B を実行する
  Then 応答に vacuumOk:false が含まれる
  And UI に VACUUM 未完了の注記が表示される
```

## 受け入れ基準

- [x] 着手時に既存 vitest カバレッジを確認: `FallbackStorageAdapter` / `IdbVfsBackend`（Y2）、`archivePurgeHandlers.test.ts` の VACUUM 失敗（G8）。カバー済みの項目は E2E を書かず「既存カバレッジの明文化」に切り替える（Y2 は未カバーのため vitest 新設、G8 は既存カバーを明文化）
- [x] `testDir/e2e/archive-recommended-verification.spec.ts`（新規・`@extension`）に、vitest でカバーできない項目（Y3/Y4/Y6/G3/G4/G5、および Y2/G8 が未カバーなら追加）を実装しパスする（Y2 は vitest、G8 は明文化。E2E は Y3/Y4/Y6/G3/G4/G5）
- [x] G4 の seed はレガシーストア（`savedUrlsWithTimestamps`）にエントリが載る経路を使う（`import` subtype は SQLite 直挿入でレガシーに載らない）→ `chrome.storage.local.set` 直接 + deferred マイグレーション封印
- [x] **テスト専用 subtype / フラグは追加しない**（18 ファイル改修 + 起動時パーティション assert。01 の実装コンテキスト参照）。Y2 は fallback backend のユニットテスト、G8 は既存 `makeMainEngine({ vacuumError })` を使う
- [x] `docs/MANUAL_TEST_ARCHIVE.md` を更新:
  - E2E / vitest でカバーした項目を手動チェックリストから削除（カバー方法をファイル名付きで注記）
  - Y1/Y5/G1/G2/G7 は残し、「なぜE2Eで不可」列を上表の理由に更新（現状の記述より正確に）

## テスト戦略（t_wadaスタイル）

### E2Eテスト（新規 `archive-recommended-verification.spec.ts`）
- Y2/Y3/Y4/Y6/G3/G4/G5/G8

### 単体テスト
- 既存カバー（`confirmTokenManager`・`focusTrapManager`・`archivePurgeHandlers` の quota モック）で G1/G2/G7 のロジックは担保済み。追加不要だが、カバレッジの所在を PBI 完了メモに記録

## 実装コンテキスト（他エージェント向け・着手前に必読）

### DASHBOARD_SQLITE の投げ方・token・scopeHash

01 と同じ。`testDir/e2e/dashboard-archive.spec.ts:40-67` の `dashboardMsg` / `scopeHash` / `tokenFor` ヘルパをコピーして使う。トークン方針は `src/messaging/sqliteOperationSecurity.ts` の `TOKEN_EXEMPT_OPS` / `ARCHIVE_SCOPE_BY_SUBTYPE`（01 の実装コンテキスト参照）。

対象 subtype のトークン要否と scope:
| subtype | token | scope parts |
|---|---|---|
| `archive_open` | 必須 | scope 無し（`ARCHIVE_SCOPE_BY_SUBTYPE` に無い） |
| `archive_query` | 不要（exempt） | — |
| `archive_update` | 必須 | scope 無し |
| `archive_save` | 必須 | scope 無し |
| `archive_restore` | 必須 | `[stagingName]` |
| `archive_restore_preview` | 必須 | `[stagingName]` |
| `archive_prepare_incoming` | 必須 | scope 無し |

（`archive_open` 系の scope が「無し」の場合、`tokenFor` は scopeHash を付けずにトークンだけ取る — `dashboard-archive.spec.ts:56-67` の分岐がそれ）

### Y2 の前提訂正（重要）

- **UI に事前 disabled ガードは存在しない**。`archivePanel.ts` はプレビュー/作成ボタンを storage backend で無効化していない
- "Archive requires OPFS storage." は `IdbVfsBackend.ts:289-349` と `FallbackStorageAdapter.ts:54-114` が返す**エラー文字列**（`{ success: false, error: '...' }`）。**i18n キーではない生の英語**。多言語化されていない
- Y2 の検証は「fallback backend で `archive_*` 操作を投げると `success:false` + このエラー文字列になる」に留める
- fallback backend の強制手段: E2E コンテキストで OPFS を無効化するのは難しい。**vitest の `FallbackStorageAdapter` / `IdbVfsBackend` ユニットテストで既にカバーされている可能性が高い**ので、まず既存テストを確認（`src/offscreen/__tests__/` で `FallbackStorageAdapter` / `IdbVfsBackend` を grep）。カバー済みなら Y2 は「既存カバレッジの明文化」で済み、E2E 不要

### Y3 編集→保存→書き戻し

- 経路: `archive_open`（`{ stagingName }`）→ `archive_query`（`{ stagingName, query, limit, offset }` → `{ rows: ArchiveSessionRow[], total }`）→ `archive_update`（更新フィールド）→ `archive_save` → `archive_export`（01 の `archiveDbReader` でバイト列 open）
- `archive_update` の更新可能フィールドは worker 側 `UPDATABLE_FIELDS` whitelist で制限（`archiveSessionHandlers.ts`）。title は許可されているはず（実装で確認）
- URL は `isHttpUrl` チェックあり

### Y4 復元後の値照合

- `archiveRestoreHandlers.ts:84` — アーカイブ .db から `ARCHIVE_SELECT_COLUMNS`（id 含む全カラム）を読み、メイン engine に **`INSERT OR IGNORE`**。メイン DB の `UNIQUE(url, created_at)` で重複スキップ
- **`INSERT OR IGNORE` は全カラムをそのまま挿入**するので、`is_starred` / `is_deleted` はアーカイブの値が保持される（別処理で上書きしていない — `archiveRestoreHandlers.ts` を読んで確認）
- 検証: 本体を空（またはアーカイブ対象 URL が無い状態）にしてから復元 → `query` subtype または `get_count` で値を照合
- `restoredDeleted` は `is_deleted === 1` の行数（`archiveRestoreHandlers.ts:129`）

### Y6 restoredDeleted

- `archive_restore` 応答: `{ success, restored, restoredDeleted, skipped, skippedInvalid }`（`sqliteOperationSecurity` 経由・`dashboardSqliteProtocol.ts:171`）
- `restoredDeleted` は「復元された行のうち `is_deleted=1` だったもの」の数
- **本体を空にしてから復元しないと `INSERT OR IGNORE` でスキップされ 0 になる**（既存 `dashboard-archive.spec.ts:142-143` が `restored:0 / skipped:3` を示している = 重複時は全スキップ）

### G3 archive_query のエスケープ

- `archiveSessionHandlers.ts:65` `escapeLike(term)` = `term.replace(/[\\%_]/g, ch => '\\' + ch)`
- `:133-135` `LIKE ? ESCAPE '\'` を url/title/summary に対して適用（`%${escapeLike(query)}%`）
- 検証: staging に `"100%_done"` と `"100Xdone"` を含めて `archive_open` → `archive_query({ query: "100%_done" })` → `"100Xdone"` が rows に含まれないこと

### G4 レガシーストア残存

- `archive_delete_by_staging` は SQLite 側のみ削除。`chrome.storage.local` の `savedUrlsWithTimestamps` は触らない（`archivePurgeHandlers.ts` に `savedUrlsWithTimestamps` 参照なし = 実装で確認済み）
- 検証: Phase B 後に `page.evaluate(() => chrome.storage.local.get('savedUrlsWithTimestamps'))` で該当 URL のエントリが残ることを assert
- ただし seed を `import` subtype で入れると `savedUrlsWithTimestamps` にはエントリが作られない可能性がある（`import` は SQLite 直挿入）。**レガシーストアにエントリを作る経路**（通常の録画フロー or 直接 `chrome.storage.local.set`）を使って seed する必要がある

### G5 録画との並行動作

- `testDir/e2e/content-script-recording.spec.ts` が録画発生のパターン。test-pages サーバー（`e2e/test-pages/server.mjs`、port 8080）のページを開いて engagement を発生させる
- worker は**単一シリアルキュー**なので「並列」ではなく「直列化されて両方成功する」ことを検証する
- 検証: 録画対象ページを開く → `archive_create` を投げる → 録画レコードが SQLite に入り、かつ `archive_create` も成功

### G8 VACUUM 失敗時の注記

- UI: `archivePanel.ts:185` — `result.data.vacuumOk` が false なら `${done} ${localized('archiveVacuumNote')}` を error スタイルで表示
- worker: `archivePurgeHandlers.ts` が `VACUUM` SQL で throw を catch して `vacuumOk: false` を返す（`archivePurgeHandlers.test.ts` の `makeMainEngine({ vacuumError })` でモック済み）
- **VACUUM 失敗のロジックは vitest でカバー済み**。E2E で「実エンジンで VACUUM を失敗させる」のは困難（`__setEngineForTesting` は offscreen worker 内でE2Eから呼べない）
- → G8 は「vitest でカバー済み」を明文化。E2E は不要か、やるなら `dashboard-archive.spec.ts` で `vacuumOk` フィールドの存在だけ確認

## 実装アプローチ

- **Outside-In**: E2E を Red で書き、失敗を確認してから実装
- 既存 vitest カバレッジ（Y2 の fallback、G8 の VACUUM 失敗）を先に確認し、カバー済みなら E2E を書かず明文化に切り替える
- **Red-Green-Refactor**

## 見積もり

2pt（要チームでの見積もり）— 大半は既存 subtype への assert 追加。Y2・G8 は既存 vitest カバレッジで済む可能性が高く、その場合さらに小さくなる。**テスト専用 subtype/フラグは追加しない**方針

## 技術的考慮事項

- **依存関係**: 2026-09-07-01（`archiveDbReader.ts` ヘルパ）に依存。2026-09-06-03/04/05（復元・削除・一時オープン）に依存、すべて完了済み。**01 の DEV ガード機構には依存しない**（本PBIは subtype/フラグを足さない）
- **G5 の録画トリガー**: `content-script-recording.spec.ts` を参照。test-pages サーバー（`e2e/test-pages/server.mjs`、port 8080）のページを開いて engagement を発生させる
- **CI 実行時間**: 本 spec は `@extension`（直列・`workers:1`）。01・03 の追加分と合算で CI 15 分制限（`tests.yml`）を超えないか、01 で見積もった合計に加算して確認

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "archive_open\|archive_query\|archive_update\|archive_save\|UPDATABLE_FIELDS\|escapeLike\|ESCAPE\|isHttpUrl" src/offscreen/opfsWorker/archiveSessionHandlers.ts
grep -n "restoredDeleted\|INSERT OR IGNORE\|is_starred\|is_deleted\|ARCHIVE_SELECT_COLUMNS" src/offscreen/opfsWorker/archiveRestoreHandlers.ts
grep -rn "Archive requires OPFS" src/offscreen/IdbVfsBackend.ts src/offscreen/FallbackStorageAdapter.ts
grep -rln "FallbackStorageAdapter\|IdbVfsBackend" src/offscreen/__tests__/
grep -n "vacuumError\|vacuumOk" src/offscreen/__tests__/archivePurgeHandlers.test.ts
grep -n "archiveVacuumNote\|vacuumOk" src/dashboard/panels/diagnostic/archivePanel.ts
sed -n '40,67p' testDir/e2e/dashboard-archive.spec.ts   # dashboardMsg / scopeHash / tokenFor
cat testDir/e2e/content-script-recording.spec.ts
```

### 実装手順
1. 既存 vitest を確認: Y2（`FallbackStorageAdapter` / `IdbVfsBackend` テスト）、G8（`archivePurgeHandlers.test.ts` の `vacuumError`）。カバー済みなら手動文書に明記して E2E をスキップ
2. `dashboard-archive.spec.ts` のヘルパをコピーして新 spec を作る
3. Y3・Y4・Y6・G3 を E2E で書く（`archive_open`/`archive_query`/`archive_update`/`archive_save`/`archive_restore` への assert。Y3 は `archiveDbReader` 再利用）
4. G4 を書く（レガシーストア経路で seed → Phase B → `chrome.storage.local.get('savedUrlsWithTimestamps')` を assert）
5. G5 を書く（録画トリガー + `archive_create` 直列成功）
6. Green → リファクタリング
7. `MANUAL_TEST_ARCHIVE.md` 更新

### 落とし穴
- **G3 の対象は `archive_query`**（`search` ではない）: `escapeLike`（`archiveSessionHandlers.ts:65`）は `/[\\%_]/` を `\` でエスケープし `LIKE ? ESCAPE '\'` を組む（`:133-135`）。これは `archive_open` 後のセッション検索。`search` subtype（FTS5/trigram）には LIKE ワイルドカードの概念が無く、叩いても「何も検証していない」テストになる
- **Y2 は UI の事前 disabled を期待しない**: 現状ガードは無く、操作実行時に `{ success: false, error: 'Archive requires OPFS storage.' }` が返る（`IdbVfsBackend.ts` / `FallbackStorageAdapter.ts`）。この文字列は i18n されていない生英語
- **Y4 の is_starred / is_deleted**: `archiveRestoreHandlers.ts:84` は全カラムを `INSERT OR IGNORE`。別処理で上書きしていなければアーカイブの値が保持される。実装を読んで確認してから期待値を確定
- **Y6 の restoredDeleted**: `INSERT OR IGNORE` が既存行をスキップするため、本体を空にしてから復元しないと `restoredDeleted` が 0 になる（既存 `dashboard-archive.spec.ts:142-143` が重複時 `restored:0/skipped:3` を示す）
- **G4 の seed**: `import` subtype は SQLite 直挿入で `savedUrlsWithTimestamps` に載らない。レガシーストアにエントリを作る経路（`chrome.storage.local.set` 直接 or 録画フロー）で seed する
- **G5 の並行性**: worker は単一シリアルキュー。「並列実行」ではなく「直列化されて両方成功」を検証する
- **G8 の VACUUM 失敗は E2E で作れない**: `__setEngineForTesting` は offscreen worker 内で E2E から呼べない。vitest（`makeMainEngine({ vacuumError })`）でカバー済みのはずなので、それを明文化。E2E は `dashboard-archive.spec.ts` で `vacuumOk` フィールドの存在確認に留める
- **新 subtype/フラグを足さない**: 18 ファイル改修 + 起動時パーティション assert 対応が必要（01 の実装コンテキスト参照）

## Definition of Done

- [x] 対象シナリオが自動テスト（E2E または既存 vitest カバレッジの明文化）で担保されている
- [x] `npm run validate` が通る
- [x] `npm run test:e2e:ci` で新規 spec がグリーン（macOS ローカル headed で 34 passed / 1 skipped。CI は tests.yml 同一 grep）
- [x] テスト専用フラグ/subtype を追加していないことを確認（本方針の遵守）
- [x] コードレビュー完了
- [x] リファクタリング完了
- [x] `docs/MANUAL_TEST_ARCHIVE.md` 更新済み（カバー項目の削除 + カバー方法のファイル名注記、Y1/Y5/G1/G2/G7 の理由更新）

## 完了メモ（2026-09-07）

### Y2（vitest 追加・E2E不要）

既存 vitest は FallbackStorageAdapter / IdbVfsBackend の archive 拒否をカバーしていなかったため、`src/offscreen/__tests__/archiveFallbackRejection.test.ts` を新設。全 14 archive メソッド × 2 backend が `'Archive requires OPFS storage.'` で fail-closed することを assert。

### G8（既存カバレッジ明文化のみ）

E2E 新規は不要と判断。`archivePurgeHandlers.test.ts` の `keeps the main DB intact when VACUUM fails (vacuumOk=false)` が応答ロジックを担保、R5 の E2E（`dashboard-archive.spec.ts`）が実エンジンで `vacuumOk:true` を通すため、UI 注記のフィールド経路は接続済み。

### 既存 vitest カバレッジの所在（G1/G2/G7）

- G1 トークン TTL: `src/background/__tests__/confirmTokenManager` 系テスト
- G2 フォーカストラップ: `focusTrapManager` ユニット + `archive-edit-modal` テスト
- G7 quota プレフライト: `archivePurgeHandlers.test.ts` `rejects before the DELETE when quota is insufficient`

### 追加で見つかった本番バグ（E2E の Red で検出・修正済み）

1. `archive_prepare_incoming` の応答が二重ラップ（`{stagingName: {stagingName}}`）— `OpfsWorkerBackend` が worker のオブジェクト応答を文字列扱いしていた。ファイル復元フローが本番で壊れていた（`archive_open` の名前検証で必ず拒否される）
2. `archive_cleanup` も同様の二重ラップ。両方 `OpfsWorkerBackend` でフィールドを取り出すよう修正
3. `archive_update` の confirmToken は行 id にバインドされる（`create_confirm_token` に id が必要）— dashboardGateway は payload.id から自動で取るが、生 sendMessage では明示が必要
4. G4 seed では deferred レガシーマイグレーションが先に走るため、最初の DASHBOARD_SQLITE 呼び出しで `legacyStoreReadOnly` セットを待ってから `yasumaro_migration_status: 'completed'` を封印する必要がある

### G5 の実装ノート

AI 設定なしでも録画は SQLite 保存まで到達する（`RemoteAIService.generateSummary` はキー無しで throw せず `{success:false}` を返すため、privacyPipeline ステップが失敗扱いにならない）。録画対象 URL は `query` subtype で domain='localhost' を照合。

