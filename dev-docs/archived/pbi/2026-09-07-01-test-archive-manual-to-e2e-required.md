# PBI: アーカイブ機能 手動必須項目（R1〜R4）のE2E自動化

> R5（VACUUM 領域解放）と R6（レジストリ消失 fail-closed）は「検証対象を変えれば部分的に自動化可能」なため、G6 と合わせて **2026-09-07-03** に分離した。本PBIは完全自動化できる R1〜R4 のみを対象とする。

## ユーザーストーリー

yasumaro の開発者として、`docs/MANUAL_TEST_ARCHIVE.md` の 🔴必須項目のうち完全自動化できる R1〜R4 を自動テスト化してほしい。なぜなら、これらはデータ信頼性の中核でありリリースのたびに人手で確認するのは漏れやすく、既存の `@extension` E2E 基盤（実物拡張 + 実 OPFS SQLite 往復）は `DASHBOARD_SQLITE` メッセージ経由で SW・offscreen worker・OPFS に到達できることが `dashboard-archive.spec.ts` で実証済みだから。

## 背景: なぜ「E2E不可」の記述が過大評価か

- `MANUAL_TEST_ARCHIVE.md` の「なぜE2Eで不可」の多くは (a) Playwright の download イベントが拡張ページで発火しない (b) 目視確認が最終担保、を根拠にしている
- しかし `archive_export` subtype（`archiveCreateHandlers.ts:252` `handleArchiveExport`）はステージング .db のバイト列をチャンク（`chunk: number[]`）で返すため、download イベントに依存せず内容照合が可能
- Playwright テストは Node コンテキストで動くため、返ったバイト列を SQLite ライブラリ（`better-sqlite3` か `sql.js`、下記で選定）でインメモリ open して SQL 照合できる
- `test.use({ timezoneId })` はブラウザ全体の TZ を制御するため offscreen worker の `Date` にも効く
- single-flight はモジュールレベルフラグ（`archiveCreateHandlers.ts:12`, `ARC_ALR_001`）。ただし単純な 2 ページ同時実行では再現しない可能性がある（下記 R4 の注記参照）

### レビューで判明した前提の誤り（着手前に対処すること）

1. **テスト専用シームの DEV ガードは「確立済みパターン」ではない**: `archiveStaging.ts` の `resetArchiveStagingForTesting` / `setArchiveStagingDirProviderForTesting`、`opfsWorker.ts:180` の `__setEngineForTesting` はいずれも**無条件 export**で `import.meta.env.DEV` ガードは存在しない。本PBI・02・03 でテスト専用フックを足す場合、DEV ガード機構と本番混入検出（build 出力 grep）を**ゼロから設計する**必要がある。見積もりに含めること
2. **`better-sqlite3` と CI の Node 24 の衝突リスク**: CI は `node-version: '24'`（`.github/workflows/tests.yml`）。`better-sqlite3` の prebuild が Node 24 に未対応だと `npm ci` で node-gyp ビルド（Python + C++ ツールチェーン）が走る。フォールバック候補の `sql.js` は API が別物（同期 `.prepare().get()` vs `db.exec()`）でヘルパ全書き換えになる。**どちらを使うか着手前に決め打つ**（下記「技術的考慮事項」参照）

## スコープ: R1〜R4 の分類（すべて完全自動化）

| # | 手法 |
|---|------|
| R1 退避 .db の内容照合 | `archive_export` バイト列 → SQLite（選定ライブラリ）で open → メタ/件数/FTS非存在を SQL 照合 |
| R2 境界日のタイムゾーン | ※下記「R2 の設計注意」を必読。`test.use({ timezoneId })` を分けるだけでは検証にならない |
| R3 フェーズA後の本体不変 | Phase A の直前直後で `get_count` subtype（`dashboardSqliteService.ts:219`）を撮り差分 0 を assert。**History パネル UI の行数比較はしない**（ページング/仮想スクロールで総件数と一致せず flaky になる） |
| R4 single-flight（2タブ競合） | ※下記「R4 の設計注意」を必読。単純な `Promise.all` では single-flight が壊れていても緑になりうる |

### R2 の設計注意（重要）

`cutoffMsFromLocalDate`（`src/utils/archiveGuards.ts:61`）は `new Date(year, month-1, day, 23,59,59,999).getTime()` で**ローカル TZ 依存**の epoch を作る。worker 側 `resolveCutoffMs` はクライアントが送った `cutoffMs` と**完全一致**を要求する（`archiveCreateHandlers.ts`）。既存 `dashboard-archive.spec.ts:104` はページ内で同じ式を評価して `cutoffMs` を作っている。

このため **TZ を変えると cutoff と seed の `created_at` が同じ方向にズレて、境界判定は常に成功する** — UTC/local 変換バグがあっても検出できない。

正しい設計:
- seed の `created_at` は**固定 epoch**（TZ に依存しない絶対値）で投入する
- cutoff は `cutoffDate` 文字列だけを渡し、worker に `cutoffMsFromLocalDate` で再導出させる
- 検証すべきは「固定 epoch の seed と、文字列由来の cutoff の**相対関係**が TZ で変わらないこと」
- 例: UTC+14（Kiritimati）と UTC-8（Los_Angeles）で、同じ `cutoffDate` に対し同じ seed が「含まれる/除外される」判定になること

### R4 の設計注意（重要）

`archiveCreateInFlight` フラグ（`archiveCreateHandlers.ts:118-126` の `let archiveCreateInFlight = false` → `handleArchiveCreate` 冒頭で `if (archiveCreateInFlight) throw ARC_ALR_001`）は worker がメッセージを処理し始めた瞬間に立つ。2つの `sendMessage` は SW → offscreen document → worker と経路が長く `await` 境界だらけなので、**実際には片方が走り切ってフラグが降りてから2つ目が着く公算が大きい** → `ARC_ALR_001` が出ず両方 success になり、single-flight が壊れていてもテストが緑になる。

**推奨（コスト最小）**: R4 の single-flight 検証は **worker 層のユニットテスト**（vitest）で行う。`archiveCreateHandlers.ts` の `handleArchiveCreate` を、内部の `INSERT` 実行を pending Promise で止めた状態で2回呼び、1回目が in-flight の間に呼んだ2回目が `ARC_ALR_001` で throw することを assert する。`ctx.engine` はモック可能（既存 `archiveCreateHandlers` のテストがあれば同じ seam を使う）。

**E2E で担保したい場合のみ**（in-flight を確定的に作る必要がある）:
- worker の `handleArchiveCreate` に「INSERT 前に N ミリ秒 sleep する」テスト専用フックを DEV ガード付きで追加（環境変数 or `globalThis.__ARCHIVE_TEST_DELAY_MS`）
- テスト専用 subtype の新設は避ける（下記「実装コンテキスト: 新 subtype 追加の実コスト」の理由）

> R5・R6 は 2026-09-07-03 に移動。

## BDD受け入れシナリオ

```gherkin
Feature: アーカイブ必須検証の自動化

Scenario: R1 退避 .db の内容がスキーマ仕様どおり
  Given 3件の履歴を seed し Phase A を実行した
  When archive_export で全チャンクを取得して1つの ArrayBuffer に結合する
  And そのバイト列を better-sqlite3（または sql.js）でインメモリ open する
  Then browsing_logs の件数が退避件数（3）と一致する
  And yasumaro_archive_meta に record_count=3 / max_id / format_version=1 が記録されている
  And sqlite_master に *_fts テーブルおよび FTS トリガーが存在しない
  # 注: FTS 非存在はスキーマ定数（schema.ts の ARCHIVE_META_SCHEMA_SQL）から静的に決まる。
  # schema.ts 側にも「アーカイブスキーマに FTS を含めない」ユニット assert を1本置き、
  # E2E は「実際に生成された .db がその定数どおり」の確認と位置づける

Scenario: R2 固定 epoch の seed と文字列由来 cutoff の相対関係が TZ で不変
  Given seed の created_at を固定 epoch で投入した
  And timezoneId=Pacific/Kiritimati（UTC+14）である
  When cutoffDate 文字列を渡して archive_preview を実行する（cutoffMs は worker が再導出）
  Then その seed が「含まれる/除外される」判定になる
  When timezoneId=America/Los_Angeles（UTC-8）で同じ cutoffDate・同じ seed で再実行する
  Then 「含まれる/除外される」判定が Kiritimati のときと一致する
  # Asia/Tokyo も同様。詳細は上記「R2 の設計注意」

Scenario: R3 Phase A では本体から1件も消えない
  Given N件を seed した
  When Phase A（archive_create）を実行する
  Then get_count subtype の値が実行前後で不変である

Scenario: R4 1つ目が in-flight の間に投げた2つ目は拒否される
  Given worker 側の Phase A 処理を人工遅延で長くしてある（テスト専用フック）
  And options.html を2ページ開いている
  When ページ1で archive_create を投げ、それが in-flight の間にページ2でも archive_create を投げる
  Then ページ1は success:true で staging を返す
  And ページ2は ARC_ALR_001（already in progress）で拒否される
```

## 受け入れ基準

- [x] SQLite リーダーライブラリを **`better-sqlite3` か `sql.js` のどちらか一方に決定**し、その根拠（CI の Node 24 で prebuild が取れるか実測）を PBI 完了メモに記録する。決めてからヘルパを書く
- [x] R1 用のヘルパ `testDir/e2e/fixtures/archiveDbReader.ts`（新規）: `archive_export` の全チャンクをポーリング取得 → 結合 → 選定ライブラリでインメモリ open → クエリを返す。**2026-09-07-02（Y3）・2026-09-07-03 でも再利用する共通資産**
- [x] `schema.ts` に「アーカイブスキーマ（`ARCHIVE_META_SCHEMA_SQL`）に FTS テーブル・トリガーを含めない」ことのユニット assert を追加
- [x] R4 single-flight は **worker 層のユニットテスト**（vitest・`archiveCreateHandlers` の in-flight 2回呼び）で検証する。E2E での担保は任意（やる場合は `globalThis` フラグ + DEV ガードの人工遅延フック、subtype 新設はしない）
- [x] `testDir/e2e/archive-required-verification.spec.ts`（新規・`@extension` タグ）に R1〜R3 のシナリオを実装しパスする
- [x] R2 は「固定 epoch seed + 文字列 cutoff の相対関係」を TZ 3 種（Asia/Tokyo・Pacific/Kiritimati・America/Los_Angeles）で検証する設計にする（上記「R2 の設計注意」）
- [x] R3 は `get_count` subtype の差分のみで検証（UI 行数比較を入れない）
- [x] `docs/MANUAL_TEST_ARCHIVE.md` を更新: R1〜R4 を手動チェックリストから削除

## テスト戦略（t_wadaスタイル）

### E2Eテスト（新規 `archive-required-verification.spec.ts`）
- R1: export バイト列のスキーマ照合
- R2: TZ 3種 × 固定 epoch seed と文字列 cutoff の相対関係が不変
- R3: Phase A 前後の `get_count` 不変

### 単体テスト（vitest）
- R4: `archiveCreateHandlers` の in-flight 2回呼びで2回目が `ARC_ALR_001`
- `archiveDbReader.ts` のチャンク結合ロジック（境界・end 到達・空ファイル）
- `schema.ts`: アーカイブスキーマ定数に FTS テーブル・トリガーを含めない

### CI 実行時間の管理
- 本 spec + 02・03 の新規 spec はいずれも `@extension`（`workers:1`・`fullyParallel:false`・`playwright.config.ts:60`）で直列実行。CI は 15 分制限（`tests.yml`）
- 3 PBI 合計の追加実行時間を見積もり、超過するなら seed 件数削減・シナリオ統合・別 job 分離のいずれかを検討

## 実装コンテキスト（他エージェント向け・着手前に必読）

### DASHBOARD_SQLITE メッセージの投げ方（既存 E2E から確立済み）

拡張ページ（`chrome-extension://<id>/options.html`）を開いて `page.evaluate` で:

```ts
const dashboardMsg = (payload) => page.evaluate(async (p) =>
  await chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: p }), payload);
```

参考実装: `testDir/e2e/dashboard-archive.spec.ts:45-67`（`dashboardMsg` / `scopeHash` / `tokenFor` の3ヘルパが完成形。**新 spec はこれをコピーして使う**）。`testDir/e2e/fixtures/extension.fixture.ts` の `{ context, extensionId }` fixture、`test.use({ locale: 'en-US' })` でロケール固定。

### confirmToken と scopeHash（PBI 2026-09-06-01）

`src/messaging/sqliteOperationSecurity.ts` が単一の SSOT:
- **TOKEN_EXEMPT_OPS**（`:83-96`）に無い subtype は全て confirmToken 必須。`archive_preview` / `archive_restore_preview` / `archive_query` / `archive_status` は exempt（トークン不要）
- **`archive_create` / `archive_export` / `archive_delete_by_staging` / `archive_restore` はトークン必須**
- `ARCHIVE_SCOPE_BY_SUBTYPE`（`:118-126`）: `archive_create`/`archive_preview` は `'cutoff'` scope（parts = `[cutoffMs, includeDeleted]`）、`archive_export`/`archive_delete_by_staging`/`archive_restore`/`archive_restore_preview` は `'staging'` scope（parts = `[stagingName]`）
- トークン取得: `dashboardMsg({ subtype: 'create_confirm_token', action, scopeHash })`。scopeHash は `SHA-256(parts.map(String).join('|'))` を hex 化（`dashboard-archive.spec.ts:50-54` の `scopeHash` ヘルパそのまま）
- 実行時は payload に `confirmToken` と `scopeHash` の両方を載せる（`dashboard-archive.spec.ts:108-117` 参照）

### archive_export の I/O（R1 の中核）

- リクエスト: `{ subtype: 'archive_export', stagingName, offset, length, confirmToken, scopeHash }`（`dashboardSqliteProtocol.ts:70`）
- レスポンス: `{ success: true, chunk: number[], nextOffset: number, total: number, done: boolean }`（`dashboardSqliteProtocol.ts:168`）
- worker 実装: `archiveCreateHandlers.ts:252` `handleArchiveExport` — `navigator.storage.getDirectory()` → `getFileHandle(stagingName)` → `file.slice(offset, end).arrayBuffer()`。`assertRegisteredStagingName` で staging 名の登録チェックあり
- **チャンク結合**: `done` になるまで `offset = nextOffset` で回し、全 `chunk`（`number[]`）を `Uint8Array` に連結 → `Buffer` 化 → SQLite に渡す。`archiveDbReader.ts` はこのループを実装

### アーカイブ .db のスキーマ（R1 の照合対象）

`src/offscreen/schema.ts`:
- テーブルは `browsing_logs`（`ARCHIVE_INSERT_COLUMN_NAMES` = `['id', ...COLUMN_NAMES]`、id 保存）+ `yasumaro_archive_meta`（`ARCHIVE_META_SCHEMA_SQL:139`、単一行）のみ
- `yasumaro_archive_meta` のカラム: `archived_at` / `cutoff_created_at` / `cutoff_date` / `record_count` / `include_deleted` / `max_id_at_archive` / `archive_format_version` / `yasumaro_version`。**手動テスト文書の `format_version=1` は正確には `archive_format_version`**（値は `ARCHIVE_FORMAT_VERSION` 定数、`utils/archiveGuards.ts`）
- **FTS は含まれない**: `browsing_logs_fts`（`schema.ts:366`）と3トリガー（`browsing_logs_ai`/`_ad`/`_au`、`:372-383`）はメイン DB スキーマにのみ存在。アーカイブ .db は `SCHEMA_SQL` を使わず `ARCHIVE_META_SCHEMA_SQL` + `CREATE TABLE browsing_logs`（明示カラム）で作る。R1 の assert は `SELECT name FROM sqlite_master WHERE type IN ('table','trigger')` に `*_fts` / `browsing_logs_a[idu]` が無いこと

### seed の投入（全シナリオ共通）

`import` subtype（トークン必須・action='import'・scope 無し）:
```ts
dashboardMsg({ subtype: 'import', confirmToken, rows: [{ url, title, summary, created_at, domain }] })
```
`dashboard-archive.spec.ts:69-86` が完成形。`created_at` は epoch ミリ秒。テスト DB は run ごとに分離されない（永続コンテキスト）ので、**URL に run 固有のプレフィックスを付けて他 run と衝突させない**。

### 新 subtype 追加の実コスト（R4 のフックで subtype 新設を避ける理由）

`archive_delete_by_staging` を1つ足したとき touch されたファイル（`git log` / grep 実測、**18ファイル**）:
`sqliteOperationSecurity.ts`（ALL 配列 + グループ + scope マップ）、`sqliteMessages.ts`、`sqliteRpcClient.ts`、`dashboardSqliteProtocol.ts`、`archiveSubtypes.ts`、`archiveHandler.ts`、`deps.ts`、`offscreenGateway.ts`、`dbMaintenance.ts`、`OpfsWorkerBackend.ts`、`StorageBackend.ts`、`IdbVfsBackend.ts`、`FallbackStorageAdapter.ts`、`sqliteMessageHandlers.ts`、`opfsWorker.ts`（ルータ）、`opfsWorker/types.ts`、`inMemoryTransport.ts`、`validators.ts`。
さらに起動時パーティション assert（`dashboardSqlite/index.ts:12-30`）が「全 subtype が過不足なく1グループに属する」を検査するため、`ALL_DASHBOARD_SQLITE_SUBTYPES` と `ARCHIVE_SUBTYPES` の両方を更新しないと**起動エラー**になる。

→ **テスト専用フックは subtype 経由にしない**。`globalThis` フラグ + worker 内 DEV ガードで完結させる（下記）。

### DEV ガードの方針（既存に無いので新設）

- worker（`opfsWorker.ts` / `archiveCreateHandlers.ts`）内で `import.meta.env.DEV` または明示的な `globalThis.__ARCHIVE_TEST_HOOKS__` を条件にフックを読む
- WXT のビルドは本番で `import.meta.env.DEV === false` に置換 → デッドコード削除される
- DoD で `npm run build` 後の `dist/chromium-mv3` を `grep -r '__ARCHIVE_TEST'` してヒット 0 を確認
- E2E からフックを有効化する手段: 拡張ロード時の `args` に渡せないので、`sw.evaluate` で offscreen へ設定メッセージを送るか、テスト用に `import.meta.env.DEV` がそもそも E2E ビルドで true になっているか確認（`npm run build` は本番モード。E2E は `dist/chromium-mv3` を読むため、**E2E 専用の dev ビルドを別途用意する必要があるかもしれない** — 着手時に `wxt.config.ts` のビルドモードを確認）

## 実装アプローチ

- **Outside-In**: E2E を Red で書き、失敗を確認してから実装
- **Red-Green-Refactor**: 各シナリオで TDD サイクル

## 見積もり

2〜3pt（要チームでの見積もり）— SQLite リーダー選定 + `archiveDbReader` ヘルパ + TZ マトリクスの正しい設計 + R4 ユニットテスト。DEV ガード機構は R4 を E2E で担保する場合のみ必要（+1pt）で、まず vitest 層で済ませる想定

## 技術的考慮事項

- **依存関係**: 2026-09-06-01〜04（アーカイブ基盤・作成・復元・削除）に依存。すべて完了済み
- **後続への提供**: `archiveDbReader.ts` は 2026-09-07-02（Y3）と 2026-09-07-03（R5）が依存する。本PBIを先に完了させる
- **SQLite リーダー選定（着手前に決定）**:
  - `better-sqlite3`: 同期 API で書きやすいが native モジュール。CI は Node 24（`tests.yml`）で prebuild 未提供なら node-gyp ビルドが `npm ci` に乗る
  - `sql.js`: pure JS/WASM で native ビルド不要だが API が別物（`db.exec()` 中心）。ヘルパの実装が変わる
  - **どちらかに決め打ち**、フォールバック前提で両対応しようとしない
- **テスト専用フック全般**: `archiveStaging.ts` の既存シームに DEV ガードは無い。本PBIで DEV ガード + 本番混入検出（`dist` grep）の枠組みを作り、02・03 はそれを踏襲する

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "handleArchiveExport\|assertRegisteredStagingName\|archiveCreateInFlight\|ARC_ALR_001" src/offscreen/opfsWorker/archiveCreateHandlers.ts
grep -n "ARCHIVE_META_SCHEMA_SQL\|browsing_logs_fts\|CREATE TRIGGER\|ARCHIVE_FORMAT_VERSION" src/offscreen/schema.ts src/utils/archiveGuards.ts
grep -n "TOKEN_EXEMPT_OPS\|ARCHIVE_SCOPE_BY_SUBTYPE\|deriveScopeHash" src/messaging/sqliteOperationSecurity.ts
sed -n '40,70p' testDir/e2e/dashboard-archive.spec.ts   # dashboardMsg / scopeHash / tokenFor ヘルパ
cat testDir/e2e/fixtures/extension.fixture.ts
ls testDir/e2e/*.spec.ts   # sw.evaluate 実績: recording-traceId / service-worker-orchestration
find . -path '*/opfsWorker/__tests__/*archiveCreate*' -o -name 'archiveCreate*.test.ts' | grep -v node_modules
```

### 実装手順
1. SQLite リーダーを選定（CI Node 24 で `better-sqlite3` prebuild が取れるか実測。ダメなら `sql.js` に確定）
2. `archiveDbReader.ts` ヘルパを書く（`archive_export` チャンクループ + open + クエリ）。vitest で単体テストを Red
3. `schema.ts` にアーカイブスキーマ定数の FTS 非存在 assert を追加
4. R1 の E2E を Red で書く（`dashboard-archive.spec.ts` のヘルパをコピー → seed → Phase A → export → `archiveDbReader` でスキーマ照合）
5. R3 の E2E を Red で書く（Phase A 前後の `get_count` 差分 0）
6. R2 の TZ 別 describe を「固定 epoch seed + `cutoffDate` 文字列のみ渡す」設計で書く（`test.use({ timezoneId })` を describe ごとに）
7. R4 の vitest ユニットテスト（`archiveCreateHandlers` in-flight）を追加
8. Green → リファクタリング
9. `MANUAL_TEST_ARCHIVE.md` から R1〜R4 を削除

### 落とし穴
- **`archive_export` はステージング名の登録チェックがある**（`assertRegisteredStagingName`）。Phase A 直後の staging 名をそのまま渡すこと。offscreen 再起動を挟むと登録が消える
- **R2 の TZ を変えるだけでは検証にならない**（上記「R2 の設計注意」）。cutoff と seed が同方向にズレて常に緑になる
- **R4 の `Promise.all` は single-flight を検証できない**（上記「R4 の設計注意」）。vitest ユニットで担保する
- **新 subtype は足さない**: 追加すると 18 ファイル改修 + 起動時パーティション assert（`dashboardSqlite/index.ts:12-30`）対応が必要（上記「新 subtype 追加の実コスト」）
- **`better-sqlite3` を選ぶ場合**: Node バージョンと ABI が一致する必要。CI の Node 24 との整合を実測してから
- **TZ とサマータイム**: America/Los_Angeles は DST 切替日をまたぐ `created_at` を避ける（テストが日付依存で不安定になる）
- **CLAUDE.local.md のモジュール分割ルール**: worker に DEV ガードモジュールを新設して `src/offscreen/` のファイル構成が変わる場合、`web_accessible_resources`（`wxt.config.ts`）の更新要否を確認

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate`（型チェック + テスト + lint）が通る
- [x] `npm run test:e2e:ci` で新規 spec がグリーン（macOS ローカルでは headed `--project=extension` で 34 passed / 1 skipped。CI は tests.yml が同一 grep で実行）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] `docs/MANUAL_TEST_ARCHIVE.md` 更新済み（R1〜R4 削除）

## 完了メモ（2026-09-07）

### SQLite リーダー選定: `better-sqlite3` 12.11.1 に決め打ち

根拠（実測 2026-09-07）:
- GitHub Releases の v12.11.1 アセットを実測し、**node-v137（Node 24 / CI）と node-v147（Node 26 / ローカル）の prebuild が linux-x64・darwin-arm64 の両方に存在**することを確認。`npm ci` で node-gyp ビルドは走らない
- 注意: v13.0.x は Node 24 (ABI 137) の prebuild が存在しない（404 実測）。そのため **12.11.1 を明示ピン**している
- `sql.js` は pure WASM で最有力フォールバック候補だったが、prebuild 実測で better-sqlite3 が取れたため不採用（フォールバック前提の両対応はしない方針どおり）

### 追加で見つかった本番バグ（Outside-In の Red で検出）

1. **SW 側 `archiveHandler.ts` に `archive_export` の case が存在しなかった**（b5128d4a 以来の欠落）。DASHBOARD_SQLITE 経由のアーカイブダウンロードが常に `"Unknown archive subtype: archive_export"` で失敗していた → case 追加 + `archiveHandler.test.ts` に3ケース追加
2. `archivePanel.test.ts` のモックが PBI 2026-09-06-05 追加分の service 関数に追従しておらず、`npm test` が unhandled rejection で exit 1 になっていた（validate ゲート破壊）→ モック補完 + `archiveStatus` の closed-session 既定値

### 産出物

- `testDir/e2e/fixtures/archiveDbReader.ts` — チャンクループ（`collectArchiveChunks`）+ 結合 + better-sqlite3 open。02（Y3）・03（R5）で再利用
- `testDir/e2e/fixtures/dashboardSqliteHelpers.ts` — `dashboardMsg` / `scopeHash` / `tokenFor`（id バインド対応）/ `poll` / `localEndOfDayMs`。dashboard-archive.spec.ts も共通ヘルパに移行済み
- `testDir/e2e/archive-required-verification.spec.ts` — R1〜R3（R2 は TZ 3種 × 固定epoch seed + 文字列 cutoff）
- `testDir/__tests__/archiveDbReader.test.ts` — チャンク結合ロジック（境界・空ファイル・nextOffset 停滞・total 不一致）11ケース
- `src/offscreen/__tests__/archiveSchemaNoFts.test.ts` — アーカイブスキーマ定数の FTS 非存在（文字列 + 実SQLite実行）

### R4 について

E2E は実施せず。既存 vitest `archiveCreateHandlers.test.ts` の `blocks a second concurrent create (single-flight)` が PBI 要求の in-flight 2回呼びシナリオをそのまま担保しているため。DEV ガード機構・テスト専用フックは本PBIでは**未導入**（不要と判断。02 もフラグ非依存で完了）

