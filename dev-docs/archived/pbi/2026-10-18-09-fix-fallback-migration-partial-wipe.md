# PBI: fallback→SQLite 移行の一部失敗で、SQLite に着地しなかった記録が fallback ストアごと消えるのを止める

## ユーザーストーリー

yasumaro を.opfs が使えない環境で使い続けているユーザーとして、起動時の storage 移行が「一部だけ成功した」場合でも、SQLite に書き込めなかった記録が chrome.storage.local から消えずに残っていることを保証してほしい、なぜなら fallback ストアは_拡張機能側が保持する唯一のコピーで、1 件でも INSERT が失敗した瞬間にその履歴は二度とどこにも存在しなくなるから（ユーザー側の復元手段・バックアップ・問い合わせにも痕跡が残らない）。

## 優先度

- 順位: 09 / 25
- RICE: 1500（Reach=300 / Impact=1 / Confidence=100% / Effort=0.2）
- 根拠: 監査9位。offscreen の初期化時に走る fallback→IDB 移行は、record ごとの INSERT 失敗を空 catch で飲み込んでループを回し続け、`migrated > 0`（1 件でも成功した）だけで fallback ストア全体の `clearAll()` を実行する。失敗して SQLite に着地しなかったレコードは、fallback ストアが唯一のコピーであるにもかかわらず恒久的に消える。同一モジュールの兄弟 `migrationBackup.ts:370` は「件数一致を確認してからバックアップを捨てる」方針でハードニング済みなのに、この経路だけがその方針から抜けている。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴あり（移行失敗時のデータ保持方針が変わる。`clearAll` を外すと「移行済みだが SQLite では重複している」孤児レコードが fallback ストアに残るため、後始末（削除してよいのか・保持して次回再試行するのか）を本 PBI 内で決める必要がある。加えて、既存テスト `src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts:64-75` は現行の壊れた挙動を `expect(mockClearAll).toHaveBeenCalledOnce()` として固定しているため、同テストの期待値変更が必須）

## 背景（監査の出典）

security-audit run-2（source ref `d49d70a3`）の needs_validation リード。fingerprint: `fallbackMigration.tryMigrateFallbackToSqlite:partial-failure-clearall-wipe`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（NEEDS-VALIDATION.md 10番 / findings.json `needs_validation`）。

claimed root cause: 移行ループの per-record catch が後始末の判断と結び付いていない。`clearAll` が「全件着地した」ことを要求せず `migrated > 0` で走るため、部分失敗時に未移行分が破壊される。

### Trace

- [entrypoint] `src/offscreen/sqliteEngineHost.ts:235`（engine init）― `_doInit` のステップ4。`runMigrationBackup`（`:223`）と `runMigrationRestore`（`:232`）の後に `tryMigrateFallbackToSqlite(this.fallbackMigrationState)` を await する。engine 初期化は成功扱いで返る（`:236 return true`）ため、失敗は上位に伝播しない。
- [propagation] `src/offscreen/sqliteEngineContext/fallbackMigration.ts:29`（snapshot）― `new FallbackStorage()`（`:28`）が別インスタンスなので mutex も別（`storageFallback.ts:24 private readonly mutex = new Mutex()`）。稼働中の engine が持つ FallbackStorage とはロックを共有せず、`getAllRecords()`（`storageFallback.ts:475`）で全件を一度だけ読む。
- [propagation] `src/offscreen/sqliteEngineContext/fallbackMigration.ts:42`（migration loop）― 各レコードを `INSERT OR IGNORE`（`src/offscreen/schema.ts:145`）で `execWithCache`（`idbEngineLifecycle.ts:55`）経由の投入。失敗は `:47-48` の空 catch で飲み込まれ、`migrated++`（`:46`）は成功時のみ。ループは打ち切られない。
- [sink] `src/offscreen/sqliteEngineContext/fallbackMigration.ts:53`（destruction）― `if (migrated > 0)`（`:51`）が成立すると `tempFallback.clearAll()` が `FALLBACK_STORAGE_DATA`（`storageFallback.ts:15`）を全消しする（`storageFallback.ts:361`、実体は `:57 mutate(() => ({ next: { records: [] } }))`）。INSERT に失敗したレコードもここで死ぬ。`:55` が `OPFS_FALLBACK_MODE` を落とし、残りが無かったことに両端が寄与する。

### Evidence

- `src/offscreen/sqliteEngineContext/fallbackMigration.ts:47` ― per-record INSERT を囲む空 catch。エラーも件数も捨てられ、後始末の判断材料にならない。
- `src/offscreen/sqliteEngineContext/fallbackMigration.ts:53` ― `clearAll` は `migrated > 0` のみで無条件に走る。全件成功であることは検証されていない。
- `src/offscreen/storageFallback.ts:361` ― `clearAll` は store 内の全レコードを破棄する。取り戻す経路が存在しない。

### 対照: ハードニング済みの兄弟

`src/offscreen/sqliteEngineContext/migrationBackup.ts` は同じ「移行したあと元データを捨てる」型 Benefits として、捨てる前に必ず SQLite 側の実数を測っている。

- `:355` `const expectedCount = payload.records.length;`
- `:368` `SELECT COUNT(*) FROM browsing_logs` で `actualCount` を実測
- `:370` `if (actualCount >= expectedCount && expectedCount > 0)` ― 満たしたときだけバックアップを削除（`:371-376`）
- `:402` / `:416` ― restore 後に一度だけ再検証する終端保証

この「count 一致を確認してから安全網を捨てる」方針を `fallbackMigration` にも適用するのが本 PBI の中心です。

### 監査 ref と現在 HEAD の行番号差分

| ファイル | 監査 ref `d49d70a3` | 現在 HEAD `56f1d7c1` | 差 |
|---|---|---|---|
| `src/offscreen/sqliteEngineContext/fallbackMigration.ts` | 空 catch `:47` / `clearAll` `:53` / ループ `:42` / snapshot `:29` | 同 | 差なし |
| `src/offscreen/storageFallback.ts` | `clearAll` `:361` | `:361` | 差なし |
| `src/offscreen/sqliteEngineHost.ts` | `_doInit` step4 `:235` | `:235` | 差なし |
| `src/offscreen/sqliteEngineContext/migrationBackup.ts` | count 一致判定 `:370` | `:370` | 差なし |
| `src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts` | `expect(mockClearAll).toHaveBeenCalledOnce()` `:60` / `:74` | `:60` / `:74` | 差なし |

監査コメントに混ざっていた Rust 由来の語（Sicherungsnetz）は「安全網（バックアップ）」の意味。該当箇所は `migrationBackup.ts:370` の count 一致判定。

## BDD受け入れシナリオ

1. **Scenario: 3 件中 1 件の INSERT が失敗しても、失敗した 1 件は fallback ストアに残る（migrated > 0 でも clearAll しない）**
   - **Given** fallback ストアに 3 件のレコードを投入済みで、offscreen の engine 初期化（IDB 成功・step 4）を通る状態である
   - **When** 2 件の `execWithCache` は成功し、1 件だけが reject する（クォータ枯渇・IDB engine エラー等の想定外失敗）
   - **Then** 成功した 2 件が SQLite の `browsing_logs` に着地していること
   - **And** 失敗した 1 件が fallback ストア（`FALLBACK_STORAGE_DATA`）に残存していること
   - **And** `clearAll` が呼ばれないこと（`migrated > 0` であっても）
   - **And** 失敗数がログまたはメトリクスとして観測できること（現状の空 catch では記録されない）

2. **Scenario: 全件成功時は従来どおり clearAll されてストアが空になる（正常系の回帰ガード）**
   - **Given** fallback ストアに 2 件のレコードがあり、すべて `execWithCache` が成功する
   - **When** `tryMigrateFallbackToSqlite` が完了する
   - **Then** 2 件が SQLite に着地し、`clearAll` が 1 回呼ばれること（既存回帰を壊さない）
   - **And** `OPFS_FALLBACK_MODE` が従来どおり削除されること

3. **Scenario: 全件失敗（migrated === 0）のときは何も消さない**
   - **Given** fallback ストアに 2 件のレコードがあり、`execWithCache` が 2 件とも reject する
   - **When** `tryMigrateFallbackToSqlite` が完了する
   - **Then** `clearAll` が呼ばれず、2 件とも fallback ストアに残る（現状は `migrated > 0` が偽なので無傷だが、成功2件/失敗1件のケースとの対比として固定する）

4. **Scenario: 部分失敗後の次回起動で、失敗分が再試行されて最終的に着地する**
   - **Given** 前回起動で 1 件の INSERT が失敗し、その 1 件が fallback ストアに残っている
   - **When** 次の起動で engine 初期化（step 4）が再度走る
   - **Then** 残った 1 件が再び INSERT され、成功すれば fallback ストアが空になり `clearAll` が実行されること
   - **And** 成功済みで SQLite にあるレコードは `INSERT OR IGNORE` により重複しないこと（再試行して取り返しが壊れない）

5. **Scenario: 破棄の判断は「全件着地」で行う（兄弟の count 一致判定と同じ形）**
   - **Given** 移行後に SQLite 側の実レコードを数える手段（`SELECT COUNT(*)`、callback 付き `execWithCache`）が使える
   - **When** 移行ループが終わった時点で投入数と既知行数を突き合わせる
   - **Then** 一致したときだけ `clearAll` する（`migrationBackup.ts:370` と同じ `actualCount >= expectedCount && expectedCount > 0` 形状）
   - **And** 不一致のときは fallback ストアを保持したまま移行を「未完了」として扱い次回へ持ち越すこと

## 受け入れ基準

- [x] `src/offscreen/sqliteEngineContext/fallbackMigration.ts:51` の `clearAll` 条件が `migrated > 0` ではなく「全件成功（`failed === 0`）」または「投入済みレコード数と SQLite 側実数が一致」を要求するものになっていること
- [x] per-record の失敗が `:47-48` の空 catch で消えず、件数（failed）と失敗理由（先頭 N 件のエラー文字列）が `logError` / `logWarn` 経由で残るか、既存のメトリクス経路に載ること
- [x] 部分失敗時に `clearAll` が呼ばれず、失敗レコードが fallback ストアに残ることを、既存テストの書式に沿って固定する単体テストが1件以上増えること
- [x] 全件成功時に `clearAll` が 1 回呼ばれストアが空になること（既存テスト `fallbackMigration.test.ts:51-62` が緑のまま）、かつ既存テスト `:64-75` の壊れた期待値（部分失敗でも `toHaveBeenCalledOnce()`）が正しい期待値へ変更されていること
- [x] 破棄判断を SQLite 側の実数で検証する場合、検証に使うクエリが `migrationBackup.ts:368` の `SELECT COUNT(*) FROM browsing_logs` と同じ意味論であり、判定形が `:370` と揃っていること（同一モジュール内で 2 系統の廃止方針を作らない）
- [x] engine 初期化は部分失敗でも `return true` のまま（`:236`）で、`OPFS_FALLBACK_MODE` の扱いが不整合にならないこと。保持方針を変えた場合、`:55` のフラグ削除が「残存レコードあり」のケースで正しいか判断し、その理由がコードコメントに残ること
- [x] 孤児レコード（SQLite には着地済みだが fallback ストアに残る）の扱いを明示し、選定した方針（次回移行で `INSERT OR IGNORE` により無害に吸収／明示削除）がコメントまたは doc として記録されていること
- [x] `npx vitest run src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts src/offscreen/sqliteEngineContext/__tests__/migrationBackup.test.ts --repeats=20 --retries=0` が 0 失敗で通ること（`npm run validate` 緑）

## テスト戦略

- 単体: 既存ファイル `src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts` の書式をそのまま使う。同ファイルは `// @vitest-environment jsdom`、`vi.mock('../../storageFallback.js')` で `mockGetAllRecords` / `mockClearAll`、`vi.mock('../idbEngineLifecycle.js')` で `mockExec`（＝ `execWithCache`）を差し込む構造（`:10-25`）。この差し込み口を使えば追加の mock は不要で、`mockExec.mockRejectedValueOnce(...).mockResolvedValue(...)` の組み合わせだけで「1 件だけ reject」を作れる。追加するのは (a) 3件中1件 reject で `expect(mockClearAll).not.toHaveBeenCalled()`、(b) 全件 reject でも `not.toHaveBeenCalled()`、(c) 全件成功で `toHaveBeenCalledOnce()` の3ケース。既存 `:64-75` は「失敗1件 + 成功1件 → clearAll 1回」という壊れた期待値なので、期待値を書き換える（テストケース の削除ではなく期待値の書き換え）。ログ/メトリクス観測を pin するなら `logError` / `logWarn` を mock して呼び出しを assert する。
- 統合: offscreen 初期化フロー（`SqliteEngineHost._doInit` の step 1→4、step 4 が `sqliteEngineHost.ts:235`）を通して「IDB 初期化成功 → fallback 移行が部分失敗 → 戻り値は `true` のまま → 次の `_doInit` で残りが再試行される」一連を 1 テストで流す。step 4 の後に `runMigrationRestore` 相当の再検証が絡む場合は、「残存レコードあり」ケースで復元ロジックと衝突しないことを確認する。実時間の sleep は使わず、await と mock の解決で同期を締める（AGENTS.md「Async / Timing Failures」）。
- E2E: owner 観測（テストプロファイルのみで実施）。隔離プロファイルに fallback レコードを種し、offscreen 初期化中に 1 件だけ IDB 書き込みが失敗する条件を仕込んで、移行前後の fallback ストア内容と SQLite の `browsing_logs` 件数を突き合わせる。実データには決して触らない。E2E 側に実時間 sleep は入れず、準備完了は上限つきポーリング（10 秒以下間隔）で待つ。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（trace / evidence 由来。ref `d49d70a3` と HEAD `56f1d7c1` で差なし）

| ファイル | 行 | 現状 |
|---|---|---|
| `src/offscreen/sqliteEngineHost.ts` | 235 | `_doInit` ステップ4。`await tryMigrateFallbackToSqlite(this.fallbackMigrationState)`。`:236 return true` で成功扱い。`:223` / `:232` が同じ初期化段の兄弟移行 |
| `src/offscreen/sqliteEngineContext/fallbackMigration.ts` | 28-29 | `new FallbackStorage()` + `getAllRecords()`。稼働中 engine とは別 mutex（`storageFallback.ts:24`）でスナップショット取得 |
| 同上 | 42-49 | 移行ループ。`:45` `execWithCache(..., INSERT_IGNORE_SQL, buildInsertParams(record, domain))`、`:46` `migrated++`、`:47-48` 空 catch |
| 同上 | 51-54 | `if (migrated > 0)` → `logInfo` → `:53` `await tempFallback.clearAll()` ★破壊の sink |
| 同上 | 55 | `chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE)`。残存の有無に関わらず実行される |
| `src/offscreen/storageFallback.ts` | 15 | `const STORAGE_KEY = 'FALLBACK_STORAGE_DATA'` |
| `src/offscreen/storageFallback.ts` | 24 / 57 | `private readonly mutex = new Mutex()` / `private async mutate<T>(fn)` ― 全 mutator の単一ロック規律。`clearAll` もこの `mutate` を通る |
| `src/offscreen/storageFallback.ts` | 361 | `async clearAll()` ― `mutate(() => ({ next: { records: [] } }))` + counter リセット。取り戻す経路なし |
| `src/offscreen/storageFallback.ts` | 475 | `async getAllRecords()` ― 移行スナップショットの供給元 |
| `src/offscreen/sqliteEngineContext/idbEngineLifecycle.ts` | 55 | `execWithCache(idbEngine, sql, params, callback?)`。callback 付きなら `query` を走査、無しなら `exec`。件数検証（選択肢3）にそのまま使える |
| `src/offscreen/schema.ts` | 145 | `INSERT_IGNORE_SQL = INSERT OR IGNORE INTO browsing_logs (...)`。重複は無害化される＝再試行しても安全 |
| `src/offscreen/sqliteEngineContext/migrationBackup.ts` | 355 / 368 / 370 | 兄弟の実装。`expectedCount` 取得 → `SELECT COUNT(*)` で実測 → 一致時のみバックアップ削除 |
| 同上 | 402 / 416 | restore 後の終端再検証（同じ判定形の再使用） |
| `src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts` | 64-75 | ★既存テストが**現行の壊れた挙動を固定**している（部分失敗でも `expect(mockClearAll).toHaveBeenCalledOnce()`）。期待値変更が必須 |
| 同上 | 51-62 | 全件成功ケース。回帰ガードとして緑のまま残す |
| `src/utils/Mutex.ts` | 38 / 76 / 121 | `class Mutex` / `acquire()` / `release()`。`mutate` は `finally` で必ず解放する規律 |

### 最小変更の選択肢

1. **条件だけを差し替える（最小 diff）** ― `:51` の `if (migrated > 0)` を「`failed === 0`（= `records.length` 件すべて成功）」に変更し、`:47-48` の空 catch で `failed` を数える。`:45` の per-record ループと `execWithCache` の呼び出し方は不変。**推奨の第一候補**（差分が最小・既存テストの mock 差し込み口だけで書ける・`migrationBackup.ts` 相当の count 検証を init 時に1クエリ追加せずに済む）。ただし「投入成功」と「SQLite に着地」が `INSERT OR IGNORE` では厳密には別（重複既存行は success だが新行ではない）ため、既存行が混在する実データでは履歴が重複して残る可能性がある。この点が気になる場合は選択肢 3 を採る。

2. **失敗したレコードだけを残して次回移行の対象にする（部分成功レコードを別キーで保持）** ― `:53` の `clearAll` を「成功した分だけを store から落とす」delete-by-id に置き換える（`FallbackStorage` に selective delete がない場合は、新キーを追加して成功 id を記録し、次回 init で成功分を skip してから clear する）。**最小 diff ではない**：`storageFallback.ts` に新 API か新ストレージキーが必要なため、工程が他の選択肢を上回り、`pbi/2026-10-18-10`（legacy count）や 13（field drift）とキー設計が干渉しうる。副作用 🔴 の実体がこれ（孤児残存の明示）。採用する場合はキー設計を先に owner と合意すること。

3. **兄弟の count 一致判定（`migrationBackup.ts:370`）と同じ形に揃える** ― ループ後に `execWithCache(engine, 'SELECT COUNT(*) FROM browsing_logs', [], cb)`（callback 付き = `query` 経路）で実数を測り、`actualCount >= expectedCount && expectedCount > 0` を満たしたときだけ `clearAll`。**方針の一貫性が最も高く**、同一モジュールに「数を確認してから捨てる」「数を見ずに捨てる」の2系統を残さない。ただし既存行（すでに移行済みの履歴）が混ざると `COUNT(*)` が期待値以上になり得るため、判定は「投入後の差分」で取るか、`browsing_logs` の移行前行数を控えて差分を見る必要がある。**推奨: 選択肢 1 を既定実装とし、選択肢 3 を「1 が孤児残存に耐えられないと判断された場合の置換先」として記録。**

**推奨方針**: 選択肢1（`failed === 0` 条件を足す＋失敗件数のログ）を最小実装とし、既存の `:64-75` テストの期待値を書き換える。同時に「全件成功時の clearAll 1回」を既存 `:51-62` で緑に保つことで回帰ガードとしても固定できる。選択肢3への切り替えは owner の判断で、実装中に孤児残存が許容できないと判断された時点で引き継ぐ。

### 着手前に潰すべき検証（needs_validation の bounded local 再現）

監査 verdict は `needs_validation`。**ブロッカーは「per-record の `execWithCache` がループ途中で 1 件だけ reject し得るか」という実行事実**であり、ソース（`INSERT OR IGNORE` + 空 catch）では実プロファイルでの発生を証明できない（run-2 は sandbox 実行不可・source-only 判定）。着手前に潰すもの:

1. **ローカル再現を先に 1 本書く** ― BDD シナリオ1・3 の単体テストを先に追加して緑にすれば「部分失敗時に clearAll が走る」ことが現行コードで実際に観測できる。観測できなければ needs_validation の留保理由そのものが変わり、影響評価を再記載する。
2. **失敗モードの実在確認** ― 想定している reject の原因（IDB クォータ / eviction / wasm engine error / `SqliteValue` の型不正）が 1 つでも実プロファイルで起こり得るかを owner が隔離プロファイルで確かめる。1 つも再現できなくても選択肢1 は無害（現状より安全性が増すだけ）だが、**再現が確認できないまま「直した」と書かない**（source-only 実行境界の明示）。
3. **`OPFS_FALLBACK_MODE` の扱い** ― `:55` が残存の有無に関わらずフラグを消すため、「残ったが本番は OPFS 経路で動き中」という状態で fallback の残存レコードが二度と読まれなくなる可能性がある。保持方針を変えた場合、このフラグの削除条件も併せて変更するか、理由コメントを残す。

### ロールバック手順

1. 変更は `src/offscreen/sqliteEngineContext/fallbackMigration.ts`（ループ内の `failed` 計数と `:51` の条件、ログ追加）と `src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts`（期待値変更）の2ファイルに限定する。ストレージキー構造・manifest・権限は触らないため、**データ移行や schema 変更を伴わない**（戻すのはコード1差分）。
2. ロールバックは上記 hunk を revert するだけで足りる。新規に書いた `FALLBACK_STORAGE_DATA` 配下のレコードは、設定のデータ削除または `clearAll` 相当で消える（保持量は増えない）。
3. 本番で「fallback レコードがたまって init が重くなった」という報告を受けた場合、まず孤児残存の扱いを決める（選択肢2/3へ置換）か、無害なら保持継続の判断を owner が行う。**`clearAll` を戻す判断はしない**（データ消失の再発）。
4. 回帰が疑われる場合は `npx vitest run src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts src/offscreen/sqliteEngineContext/__tests__/migrationBackup.test.ts --repeats=20 --retries=0` を単発実行し、全件成功・部分成功・全件失敗の3境界を確認する。

## 見積もり

0.2 SP（人週 1 日）。ブロッカー（bounded local 再現）のローカル単体 2 ケース 2h → 最小実装（`failed` 計数・条件差し替え・ログ）1-2h → 既存テストの期待値修正と新規3ケース 2h → 統合確認（offscreen init flow）1-2h → `npm run validate` とレビュー 1-2h。選択肢2（部分成功レコードを別キーで保持）に採り直す場合は +0.3 SP、`storageFallback.ts` への新 API 追加とキー設計の合意が必要。

## Definition of Done

- [x] BDDシナリオが自動テストで実装されパス
- [x] `npm run validate` が緑
- [x] 監査 fingerprint を完了記録に残す（`fallbackMigration.tryMigrateFallbackToSqlite:partial-failure-clearall-wipe`）
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`fallbackMigration.ts` のヘッダコメントの「移行して clearAll する」記述と、本 PBI で採用した保持方針の整合。`pbi/00-INDEX.md` の本エントリ）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: fallback 3 件のうち execWithCache を 1 件 reject・2 件成功にすると **`clearAll` が 1 回呼ばれた**（条件は `migrated=2 > 0` のみ）。失敗した 1 件の唯一のコピーが SQLite に着地しないまま破壊され、`OPFS_FALLBACK_MODE` も削除される。全件失敗（migrated=0）では無傷
- 影響: 既存テスト `fallbackMigration.test.ts:64-75` が壊れた挙動を pin しているため、期待値の書き換えが必要

## 関連

- `pbi/00-INDEX.md`
- PBI 10（legacy count）/ 13（field drift）/ 17（rec snapshot）― 同じ fallback・移行領域。移行系方針（count 一致で安全網を捨てる）の整合を確認すること。特に 13 は `browsing_logs` の列定義に絡むため、選択肢3（count 検証）を採る場合は列ドリフトと併せて確認する
- `src/offscreen/sqliteEngineContext/migrationBackup.ts:370` ― 本 PBI が揃えるべき方針の兄弟実装
- `src/offscreen/storageFallback.ts:361` ― `clearAll` の実体。取り戻す経路が存在しないことを示す
- `src/offscreen/sqliteEngineHost.ts:235` ― 呼び出し点。`_doInit` のステップ4
- run-2 の companion プロトコル DATA-ISOLATION-AND-LIFECYCLE（`/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/agents/hunter-offscreen/` の結果）― 「唯一のコピーを破壊する」ライフサイクル評価の根拠
- `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（findings.json / NEEDS-VALIDATION.md 10番 / run-metadata.json の `source_ref: d49d70a3`）

## 完了記録（2026-10-20）

- 実装: `clearAll` 条件を `migrated > 0` から `failed === 0`（全件着地）へ変更。per-record の空 catch を解消して `failed++` と先頭 3 件の失敗理由（`MAX_LOGGED_FAILURE_REASONS = 3`）を収集し、部分失敗時は `logWarn`（{migrated, failed, total, failureReasons}）で観測可能に。成功時のみ logInfo + clearAll。孤児レコード（SQLite 着地済みで fallback に残る分）は次回移行の INSERT OR IGNORE により無害に吸収する方針をコメントで明示。`OPFS_FALLBACK_MODE` は残存レコードがあっても削除する判断と理由（step 4 はフラグ非依存で毎回残存分を再読み、opfsRecovery の誤認防止）をコメントで記録。
- 既存テストの期待値書き換え（PBI 明示どおり）: 旧「skips a failed record insert and continues」テストは部分失敗でも `mockClearAll` の 1 回呼び出しを pin して壊れた挙動を固定していたため、「clearAll 不呼び出し + logWarn 観測」に書き換え（ケースは削除せず、Given を BDD シナリオ 1 に合わせた）。Red/Green 検証済み: 修正前に新規 3 ケースが FAIL（欠陥の局所再現、調査結果 CONFIRMED と一致）。
- 検証: 対象 2 ファイル 14 テスト緑 / AC ゲート --repeats=20 --retry=0 で 0 失敗（Vitest 5 では --retries ではなく --retry）/ 同ディレクトリ全体回帰 5 ファイル 44 テスト緑 / type-check / eslint 全緑。