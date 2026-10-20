# PBI: IDB 移行の復元失敗時に「再検証が読めた」だけでバックアップを捨てる挙動を「件数が期待値に達した」ことに変更する

## ユーザーストーリー

古い IndexedDB（wa-sqlite `idb-batch-atomic`）から新しい SQLite エンジンへ閲覧履歴を移行したユーザーとして、**復元が「全部そろった」と確認できたときだけデータの控えを捨ててほしい**。このバックアップは移行における最後の保険であり、復元されなかった行を黙って見過ごして控えを消すことは、その行を二度と取り戻す手段を消すことに等しい。履歴データ（どのページをどれくらい見ていたか）は復元不可能な損失であり、ユーザーが（有償で）利用するか判断する根拠そのものを失うからである。

現状、`runMigrationRestore` は件数不一致の復元分岐に入った後、**バックアップ削除の条件が「再検証の COUNT 読み込みが成功したか」**であり、「実際の件数がバックアップの件数に届いたか」ではない。per-row の `INSERT OR IGNORE`（`INSERT_IGNORE_SQL`）は `catch {}` により失敗行を黙って飛ばすため、行の一部が復元されないまま控えが削除される。

## 優先度

- 順位: 24 / 25
- RICE: 300（Reach=100 / Impact=0.5 / Confidence=50% / Effort=0.4）
- 根拠: 監査24位。件数が不一致で復元分岐に入った後、バックアップ削除の条件が「再検証の READ が成功したか（`reverifyOk`）」であり、「`actualCount` が `expectedCount` に達したか」ではない（`migrationBackup.ts:412`）。per-row の INSERT は `INSERT_IGNORE_SQL` で、失敗行は `catch {}` により飛ばされる（`:380-388`）。その結果、行の一部が復元されないままバックアップが削除され、`setIdbMigrationDone()` が以後の新しいバックアップ取得を閉じ（`:202-203`）、レガシー `idb-batch-atomic` DB を読むコードパスも存在しなくなる。復元されなかった行は恒久的に到達不能になる。
  - 補足（監査の記述の精密化・実ファイル照合で判明）: `runMigrationRestore` 自体は done フラグを読まない。`IDB_MIGRATION_V2_DONE` の読み出しは `isIdbMigrationDone()`（`:238-248`）経由で `runMigrationBackup` の `:202` のみから呼ばれる。**したがって done が立ったままでも、バックアップキーが残っていれば `runMigrationRestore` は次の初期化で再度走る**。監査の「以後の試行を全て閉じる」は正確には「新しいバックアップを取り直す道を閉じる」に過ぎず、削除条件だけを直せば再試行は成立する。この点は選択肢 1 の妥当性の根拠になる。
  - 根本原因（claimed root cause）: 件数不一致分岐のバックアップ削除条件が `reverifyOk`（再検証 READ の成否）であり、`actualCount >= expectedCount` ではない。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低（削除条件の変更のみ）
- 副作用: 🔴あり（**理由**: バックアップの寿命が変わる。削除を遅らせると旧 DB のスナップショットが `chrome.storage.local` に残り続ける。`IDB_MIGRATION_BACKUP` は全レコードを JSON 文字列として 1 キーに持つ（`migrationBackup.ts:297`）ため、大量履歴ユーザーでは推定容量相当の領域を使い続ける。データ復元性が損なわれることはなく、方向としては「安全側に倒れる」変更だが、**一度も収束しないプロファイルでは毎回の初期化で復元ループと警告ログが繰り返す**という望ましくない副作用が生じうる。選択肢 3（試行回数の有限化）を採用する場合はこの副作用を上限で打ち消す）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `migrationBackup.runMigrationRestore:backup-removed-on-incomplete-restore`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 13番 / `findings.json`）。

trace（entrypoint → sink）。**行番号は現在の実ファイルで確認済み**:

| # | ファイル:行 | 役割 |
|---|---|---|
| 1 | `src/offscreen/sqliteEngineHost.ts:232` | entrypoint。`_doInit` が IDB engine 起動後に `await runMigrationRestore(this.migrationBackupState)` を呼ぶ（`:225` の `initIdbEngine` 成功後、`:235` の fallback 移行前） |
| 2 | `src/offscreen/sqliteEngineContext/migrationBackup.ts:367-370` | propagation。`SELECT COUNT(*) FROM browsing_logs` で `actualCount` を実測し、`expectedCount` と比較。不一致なら復元分岐へ落ちる |
| 3 | `src/offscreen/sqliteEngineContext/migrationBackup.ts:380-388` | propagation。per-record ループ。`:383` で `INSERT_IGNORE_SQL` を実行、`:385-387` の空 `catch {}` が失敗行を警告なく飛ばす（`restored` はログ専用カウンタで判定には使われない） |
| 4 | `src/offscreen/sqliteEngineContext/migrationBackup.ts:400-414` | **sink**。`:400` `reverifyOk = true`、`:401-411` で再検証 COUNT を読み、`throw` した場合のみ `reverifyOk = false` に倒す。`:412-414` の `if (reverifyOk) remove(IDB_MIGRATION_BACKUP)` は**件数を一切見ずに**削除する |
| 5 | `src/offscreen/sqliteEngineContext/migrationBackup.ts:415` | `setIdbMigrationDone()` が無条件で立つ |
| 6 | `src/offscreen/sqliteEngineContext/migrationBackup.ts:202-203` | `runMigrationBackup` の早期 return。以後の新しいバックアップ取得を閉じる（読み出しは `isIdbMigrationDone` のみ） |

**行番号の実ファイル照合**: 現在 HEAD は `56f1d7c1`。`git diff --numstat d49d70a3 HEAD` は `migrationBackup.ts` / `sqliteEngineHost.ts` / `__tests__/migrationBackup.test.ts` のいずれも空＝**ドリフトなし**。監査証拠の行番号は現在の HEAD でそのまま有効（`:412` / `:385` / `:202`）。

判定に効く条件式:

- `migrationBackup.ts:370` ― `if (actualCount >= expectedCount && expectedCount > 0)` すでに正常分岐で「件数が期待値に達したか」でバックアップを捨てている（`:372`）。**不一致分岐だけがこの規律から外れている**。
- `migrationBackup.ts:416` ― 復元後に `actualCount >= expectedCount` を再判定してログを出し分けるという判定がすでに存在するが、これは**ログのためだけ**で、削除の判断には使われていない。ここに削除条件の判定材料がある。
- `migrationBackup.ts:360-365` ― 0 件のときの一端子分岐。**この分岐は触らない**（0 件で照合条件を永久に満たさない不具合を既に回避している）。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 3件中1件が投入に失敗した不完全復元では、バックアップは残る
  Given 移行前のバックアップに閲覧履歴が 3 件残っている
  And   1 件は制約違反などで投入に失敗し、再検証しても実測件数は 2 件のまま
  When  拡張機能のデータベースが初期化されて復元が走る
  Then  バックアップは削除されない
  And   「移行は全部そろっていない」という事実が警告ログに残る

Scenario: 2. 不完全復元でも、次回の起動で復元がもう一度試される
  Given 前回の復元でバックアップがScenario 1 により残されている
  When  次回起動してデータベースが再度初期化される
  Then  バックアップの読み込みと復元処理がもう一度実行される
  And   すでに「移行済み」の目印立っていても復元はスキップされない
  And   復元されなかった行が次の起動で拾い直せる

Scenario: 3. 件数が期待値に達した完全復元では、従来どおりバックアップが削除される（回帰ガード）
  Given 移行前のバックアップに閲覧履歴が 3 件残っている
  And   再検証で実測件数が 3 件になり、全件そろった
  When  復元が終わる
  Then  バックアップは削除される
  And   「移行済み」の目印が立つ
  And   既存の正常系テスト（件数一致 → 削除 + 目印立つ）が引き続き緑

Scenario: 4. 再検証の読み込み自体が失敗した場合は、バックアップを保留したまま大声で記録する
  Given 件数が不一致で復元分岐に入り、再検証の COUNT 読み込みが例外を投げる
  When  復元処理が終わる
  Then  バックアップは削除されない
  And   「移行済み」の目印は立つ（既存の終了契約を変えない）
  And   読み込み失敗が構造化エラーとして記録される
  And   Scenario 1 とは別の原因として区別できる

Scenario: 5. 投入が成功しても制約で弾かれた行は「復元済み」に数えない
  Given バックアップに 3 件あり、1 件は新データベースの制約に当たって挿入されない
  When  復元が走る
  Then  復元後の実測件数が期待値に達しないためバックアップは残る
  And   ログの投入件数が期待件数と食い違う旨を示せる
```

Scenario 1 が本 PBI の核心です。Scenario 4 は既存分岐（`:400-411`）を**壊さずに残す**ことを保証する回帰ガード、Scenario 5 は per-row の空 `catch` が「投入できた」と数えてしまう over-count を明示的に扱うものです。

## 受け入れ基準

- [ ] `migrationBackup.ts:412` のバックアップ削除条件が、**再検証の COUNT 読み込みが成功し、かつ `actualCount >= expectedCount` の両方**を要求すること（現状は `reverifyOk` のみ）
- [ ] 件数が期待値に達しなかった場合、`chrome.storage.local.remove(StorageKeys.IDB_MIGRATION_BACKUP)` を**呼ばない**こと
- [ ] バックアップが残る場合、復元が完了していない旨を `logWarn` で残すこと（`ErrorCode.MIGRATION_ROLLBACK_FAILED` を継続して使用する）
- [ ] 既存分岐「再検証の READ が throw した場合」（`:401-411`、バックアップを forensics 用に保留し `logError`）の挙動を**変更しない**こと。件数不足とは別の原因として区別してログ・テストで固定する
- [ ] `expectedCount === 0` の早期 return 分岐（`:360-365`、バックアップ削除 + done）と、件数一致で早期 return する分岐（`:370-376`）の挙動を**変更しない**こと
- [ ] `setIdbMigrationDone()` を、`runMigrationRestore` が done を読む仕組みを**新規に増やさない**こと（現状どおり done は `runMigrationBackup:202` だけが読む。バックアップ残置を理由に done を倒す実装に変更しない）
- [ ] `StorageKeys` のキー構造・`chrome.storage` への書き込み方式・schema・wire 契約を変更しないこと（既存プロファイルが読める）
- [ ] 既存テスト `__tests__/migrationBackup.test.ts` のうち **`:135-166`「terminates after a mismatched restore so the next launch does not replay it」は、現行の（不正な）挙動を pin しているため修正が必要**であることを認識し、Scenario 1/2 の契約に読み替えること（`:94-107` の件数一致テスト、`:168-196` の再検証 throw テストは**改変せず残す**）

## テスト戦略

### 単体

- **本 PBI の Red（まずこれを書いて「確実に赤」を観測する）**: `src/offscreen/sqliteEngineContext/__tests__/migrationBackup.test.ts` に追加。`chrome.storage.local` を既存 `beforeEach`（`:72-83`）の形でモックし、`StorageKeys.IDB_MIGRATION_BACKUP` に 3 レコードを seed。engine 側（`mockExecWithCache`）は、`SELECT COUNT` の初回は 0 件・再検証は 2 件を返し、`INSERT_IGNORE_SQL` は 3 件中 1 件だけ reject する。`runMigrationRestore` を実行し、`chrome.storage.local.remove` が `IDB_MIGRATION_BACKUP` で**呼ばれない**こと（＝現状では呼ばれるので **Red**）を pin する。
- **Scenario 2（再試行）**: 直前のテストの「バックアップが残った」状態をそのまま次の起動として再現し（`chrome.storage.local.get` が同じバックアップを返す）、2 回目の `runMigrationRestore` で再び `execWithCache` が呼ばれ、復元ループが再実行されることを確認する。**現状の実装でも `runMigrationRestore` は done を読まないので、これは修正前から緑になるはず**であり、「done が再試行を塞いでいない」という監査記述の精密化を固定する回帰ガードになる。
- **Scenario 3（回帰ガード）**: 既存 `:94-107`「deletes the backup and sets the done flag when the counts match」を**改変せず残す**。加えて「不一致 → 復元成功 → 再検証で件数が期待値に達した」ケースを追加し、そのとき削除 + done が立つことを確認する（`:416` のログ分岐と削除条件の整合）。
- **Scenario 4（既存分岐の保持）**: 既存 `:168-196`「keeps the backup for forensics but still ends the loop when the re-verify read fails」を**改変せず残す**。このテストは Scenario 1 とは原因が異なることを明示する錨になる。
- **既存テストの改変ポイント（要注意）**: `:135-166` は「COUNT が期待値に届かなくても次の起動で再生しない」ことを意図的に pin しており、**修正により意図が反転する**。テスト名とコメントの「uninsertable rows never converge, so retrying every launch is futile」という前提は、修正後の「バックアップを残す」方針と衝突する。**消すのではなく、Scenario 1/2 の契約に読み替えて書き直す**こと。`:109-133` の 0 件テストも**そのまま残す**。
- 合格条件: `npx vitest run src/offscreen/sqliteEngineContext/__tests__/migrationBackup.test.ts --repeats=20`。AGENTS.md の test rule に従い、**実時間 sleep を追加しない**（全部 Promise ベースの stub）。本 PBI の変更は決定的な局所挙動なので sleep は不要。

### 統合

- `src/offscreen/sqliteEngineHost.ts:223-232` の初期化フローに対する統合テスト。`sqliteEngineHost.ts` 側の既存モック（`src/offscreen/__tests__/opfsDegradation.integration.test.ts:56-57`、`src/offscreen/sqliteEngineContext/__tests__/coverage.test.ts:26-27`）が `runMigrationBackup` / `runMigrationRestore` を `vi.fn()` で差し替えているため、**この2ファイルのモック契約は変更不要**であることを確認する（シグネチャを変えない）。
- `src/offscreen/sqliteStatus.ts:82,103` が `IDB_MIGRATION_V2_DONE` を状態表示に読んでいるため、**done の意味を変えない**ことの回帰確認（この PBI で done は据え置き）。

### E2E

- 不要（決定的な局所挙動）。ただし blocker の closure として owner 観測が 1 回だけ必要（下記「ブロッカー」参照）。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（現在 HEAD `56f1d7c1` で確認済み・監査 ref `d49d70a3` と差分ゼロ）

**変更の中心**

| ファイル:行 | 現状 | 備考 |
|---|---|---|
| `migrationBackup.ts:412` | `if (reverifyOk) {` | **これが本 PBI の変更点**。`reverifyOk` のみが削除条件になっている |
| `migrationBackup.ts:413` | `await chrome.storage.local.remove(StorageKeys.IDB_MIGRATION_BACKUP);` | 削除本体 |
| `migrationBackup.ts:416` | `if (actualCount >= expectedCount && expectedCount > 0) {` | **判定材料が既にここにある**。削除条件と揃えることでログと挙動が一致する |
| `migrationBackup.ts:380-388` | per-record ループと空 `catch {}` | 変更しない（選択肢 3 を採る場合のみログを追加） |
| `migrationBackup.ts:360-365` / `:370-376` | 0 件 / 件数一致の早期 return | **変更しない**（回帰ガード） |
| `migrationBackup.ts:401-411` | 再検証 READ が throw したときの catch（`reverifyOk = false` + `logError`） | **残す分岐**。変更しない |

**呼び出し経路（現状を壊してはいけない点）**

| ファイル:行 | 役割 |
|---|---|
| `sqliteEngineHost.ts:223` | `await runMigrationBackup(this.migrationBackupState)` ― done が立っていれば `:202-203` で早期 return |
| `sqliteEngineHost.ts:232` | `await runMigrationRestore(this.migrationBackupState)` ― **done を読まない**。バックアップキーが残っていれば毎回走る |
| `migrationBackup.ts:238-248` | `isIdbMigrationDone()` ― 呼び出し元は `runMigrationBackup:202` のみ |
| `migrationBackup.ts:250-258` | `setIdbMigrationDone()` ― 書き込み失敗は warn のみで握りつぶす（自己修復） |
| `migrationBackup.ts:296-297` | バックアップ payload の生成。`{ version: 1, createdAt: Date.now(), records }` を `IDB_MIGRATION_BACKUP` に JSON 文字列で保存 |

**参照のみ（壊さない）**

| ファイル:行 | 役割 |
|---|---|
| `schema.ts:145` | `INSERT_IGNORE_SQL` = `INSERT OR IGNORE INTO browsing_logs (...) VALUES (...)` |
| `schema.ts:8-44` | `browsing_logs` の定義。`:19-21` に `CHECK`、`:44` に `UNIQUE(url, created_at)` |
| `utils/storage/types.ts:264-265` | `idb_migration_v2_done` / `idb_migration_backup` のキー定義（変更禁止） |
| `sqliteStatus.ts:82,103` | done フラグの読み出し（表示用途） |

### 「残す分岐」と「新設する分岐」の区別

この PBI で混乱しやすい点が 1 つある。`migrationBackup.ts` には「バックアップを削除しない」理由が **2 つ** あり、**別々の分岐として扱う**こと。

| 分岐 | 原因 | 現状の挙動 | 本 PBI での扱い |
|---|---|---|---|
| **残す分岐**（`:401-411`） | 再検証の COUNT **READ 自体が throw した**（エンジンが壊れている） | `reverifyOk = false` → バックアップは forensics 用に保留、`logError` で大声。done は立つ | **変更しない**。理由が「エンジンが壊れている」であり、「行が足りない」ではない。ログは `logError` のまま |
| **新設する分岐**（本 PBI の中心） | 再検証は**成功した**が `actualCount < expectedCount`（**行が足りない**） | 現状はバックアップを削除してしまう（バグ） | バックアップを**保留**し、`logWarn` で「未復元あり」を記録。ログは `logWarn`（エンジンが壊れたわけではないため `logError` は過剰） |

両者を同じログレベル・同じメッセージで書くと、原因の切り分けができなくなる。**メッセージとログレベルを別々にすること**（`ErrorCode` は現状どおり `MIGRATION_ROLLBACK_FAILED` を両方で使うのが簡潔だが、メッセージで原因を区別する）。

### 最小変更の選択肢

**選択肢 1（最小・推奨）**: 削除条件を `reverifyOk` から **`reverifyOk && actualCount >= expectedCount`** に変える

- 変更量: `migrationBackup.ts:412` の 1 行（+ `:414` の `else` で `logWarn` を 1 行）。`:416` の既存判定式と条件が一致するので、共通化しておくと読みやすい。
- 利点:
  - 本 PBI の BDD Scenario 1/2/3/5 をすべて満たす。`runMigrationRestore` が done を読まないため、**「バックアップが残る = 次の起動で再試行される」が自動的に成立する**（`:202-203` の確認済み）。
  - 正常系（`:370-376`）と 0 件（`:360-365`）に手を触らないため、回帰リスクが `:412` の 1 行に閉じてる。
  - 「残す分岐」（`:401-411`）はそのまま生き残るため、Scenario 4 の契約も保たれる。
- **欠点（実装前に必ず読むこと）**:
  1. **収束しないプロファイルでは復元ループが毎回走る**。`INSERT OR IGNORE` は `UNIQUE` / `NOT NULL` / `CHECK` 違反を**例外ではなく無言でスキップ**する（`schema.ts:19-21,44`）。したがって旧 DB 由来で `scroll_ratio > 1` や `is_starred = 2`、または旧 DB 内部の `(url, created_at)` 重複を持つユーザーでは、**何回再実行しても `actualCount` は期待値に届かず、バックアップが永久に残る**。結果として**毎回の初期化で**（a）`IDB_MIGRATION_BACKUP` の JSON を読む、（b）復元ループが走る、（c）`logWarn`（`:389-394`）が出る。
  2. 上記 (c) は `migrationBackup.ts:389-394` の既存 warn と重複するので、ログが増える。
  3. `IDB_MIGRATION_BACKUP` は全レコードを 1 キーの JSON 文字列（`:297`）。大量履歴ユーザーでは推定容量相当の領域が恒久的に残る。
  - → この 3 点を潰すには選択肢 3 を併用する。

**選択肢 2**: 「未復元あり」の状態を永続化し、次回 init で明示的に再試行する

- 変更量: `StorageKeys` に新キー（例 `idb_migration_restore_incomplete`）を追加し、`MigrationBackupPayload` に試行カウンタを持つ。`utils/storage/types.ts:264-265` と `:512-513` の型、`:161` の既定値にも追記が必要。
- 利点: 選択肢 1 の欠点 1/2/3（永続ループ・ログスパム・容量）を**初手から回避**できる。「何回試したか」が明示的になる。
- 欠点/費用:
  - **`StorageKeys` のキー追加は AGENTS.md が挙げる high-risk 事項（storage key structure）に該当する**。既存プロファイルが読めることの確認（既定値 `false` を `defaults.ts:161` 付近に追加）と、i18n / 状態表示（`sqliteStatus.ts:82,103`）側の追随が必要。
  - 核心はキーを 1 つ増やすだけで解決する。しかし `すでにバックアップキーの存在自体が「未復元あり」の状態を表している` という冗長な設計になり、**選択肢 1 で表現できる情報を二重定義するだけ**。**選択肢 1 で表現できる信息的再記になる**。
  - 推定: 🟢低の枠を🟡中へ押し上げる。

**選択肢 3（選択肢 1 の上に載せる推奨オプション）**: per-row の INSERT 失敗を無視せず記録し、**収束しないプロファイルには試行回数の有限化**を掛ける

- 変更量: `migrationBackup.ts:381-388` の per-record ループで、`catch {}`（`:385`）を `catch (error) { failed++; logWarn(...) }` に変え、`:391` の warn に `restored` / `failed` を取り出して追加。加えて**試行回数の上限**を設ける。
- **試行回数の上限の実装候補は 2 案**:
  - (a) `MigrationBackupPayload` に `attempts` を追加して書き戻す（`:296` の生成部と `:354` の parse 部の変更）。
  - (b) 既に `payload.createdAt`（`:296`）があるので、`Date.now() - createdAt > しきい値` で「古いバックアップは試行回数を待たずに放棄してログ」。**新しい storage キーが要らない**ため、選択肢 2 より安全。
- 利点: 選択肢 1 の欠点 1/2/3 を**選択肢 2 のキー追加なしで**潰せる。`failed` カウンタは Scenario 5 の「投入が成功しても制約で弾かれた行は復元済みに数えない」示す材料にもなる。
- 欠点: `:385` の空 catch を埋めるため、**ログ出力が増える**（特に収束しないプロファイルでは毎回 1 行）。`catch {}` が意図的に「黙って飛ばす」設計だった理由（旧 PBI でノイズ抑制）として文書化されていないため、**実装時にその意図を owner に確認する**こと。
- **上限に達した場合は「黙って削除」しない**。ログを `logError` で残したうえで削除する（この時点でログが静かになる）。

**推奨: 選択肢 1 ＋ 選択肢 3(b)（`createdAt` による陳腐化判定）。理由**:
- BDD Scenario 1/2/3/4/5 は選択肢 1 で全て通る。
- 選択肢 3(b) は **新しい storage キーを要さず**、既存 `payload.createdAt`（`:296`）という既に存在する事実だけを使うため、AGENTS.md の high-risk 抵触がない。
- 選択肢 2 は「予算を超えるが得られる価値は選択肢 1+3(b) で既に得られる」ため採用しない。**ただし BDD に書いた Scenario を全て通すだけなら選択肢 1 単独でも十分**であり、「上限の導入は副作用 🔴 の管理が本 PBI のスコープを超える」と判断した場合は選択肢 1 単独でも acceptable。**どちらを採っても BDD シナリオは変えない**（選択肢 3 はログの粒度と上限の値だけを変える）。

### per-row の INSERT は実際に失敗しうるか（ブロッカーの回答）

監査 blocker は「件数不一致時に per-row INSERT が実際に失敗しうるか」を問うている。`INSERT OR IGNORE`（`schema.ts:145`）の抑制範囲から source で答えを組み立てると、次のとおり。

- **抑制される（例外にならず、0 行だけ無視される）**: `NOT NULL`（`:11,15`）、`UNIQUE`（`:44`）、`CHECK`（`:19-21`）、`PRIMARY KEY` 衝突。**これらは `restored++`（`:384`）で数えられるものの実際には 1 行も入らないため、`restored` は過大報告になる**（Scenario 5）。
- **抑制されない（`execWithCache` が reject し、`catch {}`（`:385`）に落ちる）**:
  - `SQLITE_MISMATCH` ― 型不一致。INTEGER 列に非数値文字列`、`REAL` 列に非数値など。**旧 wa-sqlite DB は列型が緩い（SQL の型強制なし）ため、旧レコードの値が新スキーマの REAL/INTEGER と食い違う可能性が source だけでは否定できない**。
  - `SQLITE_TOOBIG` ― 文字列や blob がサイズ上限超過（`title` / `summary` / `content` は `TEXT`）。
  - `SQLITE_FULL` / `SQLITE_IOERR` / `SQLITE_NOLFS` ― IndexedDB 側のクォータ・I/O 障害。**IDB エンジン固有であり、この経路は現実にも起こりうる**。
  - エンジンが既に閉じている/未初期化（`execWithCache` の前提違反）。
- **結論**: `catch {}`（`:385`）が意味を持っていること自体が、失敗モードの存在を示す。`INSERT OR IGNORE` が制約違反を抑制するから **`restored` は過大報告になる**が、**一件も入らない等原因**（I/O・型不一致・サイズ超過）は別枠で reject されうる。したがって「監査の根本原因（削除条件が `reverifyOk`）」は **抑制されうる制約違反とは別の、独立して正しい指摘**である。
- なお `check` 制約が問題になるなら、それは **PBI 19（field drift）** の領域であり、本 PBI の修正（削除条件）を独立に正しいものとして実装できる。**blocker は「実装を止める理由」ではなく「ログの粒度（`failed` を数えるか否か）を決める材料」** と位置づける。

### ブロッカー（着手前に潰すべき owner 確認）

needs_validation の blocker は 1 件（`NEEDS-VALIDATION.md` 13番）:

> Bounded local observation that a per-row INSERT can fail during the mismatch restore while the COUNT read succeeds ― the unreachable-row outcome is deterministic given a partial failure, but confirming the failure mode occurs requires executing the engine, which is unavailable in this source-only run.

したがって**実装着手前に**、次の 2 段階を潰すこと。

1. **Red 確認（監査 local validation plan のそのまま）**: 上記「テスト戦略 → 単体」の Red pin を先に書き、**修正前に「確実に赤」であることを観測する**。`runMigrationRestore` を 3 レコード・1 件 reject / COUNT 成功で走らせ、`chrome.storage.local.remove` が `IDB_MIGRATION_BACKUP` で**呼ばれる**ことを確認する。**赤が出なかった場合、監査の根本原因が誤り**であり、設計に着手せず原因を再考して監査へ是正を返すこと。
2. **owner 観測（監査 deployment validation plan）**: オフラインのステージングコピーで `PRAGMA table_info(browsing_logs)` と旧 DB 内の `(url, created_at)` 重複数・`CHECK` 違反値の数を数え、「完全復元しても一度も収束しないプロファイル」が実在するかを確定する。**これが「選択肢 1 の欠点 1（収束しないプロファイル）」の頻度推定になる**ので、選択肢 3 を採るかどうかの判断材料にする。

**Red が出たら blocker は「実装可能」の印** として閉じたものとしてよい（blocker は「部分失敗に到達しうる」ことの確証を求めているが、本 PBI は「部分失敗時に誤って削除しない」ことを保証する修正なので、Red の観測自体が closure になる）。**観測できない profile で修正をリリースしても、「修正できた」と断定しきれない領域が残る**ことを実装者が認識しておくこと。

### ロールバック手順

- 変更は `src/offscreen/sqliteEngineContext/migrationBackup.ts`（`:412` の条件式と、その周辺のログ 1〜2 行）とそのテストに閉じており、`StorageKeys` のキー構造・`chrome.storage` への書き込み方式・schema・wire 契約を変更しない。**マイグレーション/version bump は不要**。`git revert <commit>` で即座に旧「`reverifyOk` だけで削除」に戻る。
- **ロールバック時に既存プロファイルの読み込みは壊れない**が、**修正中に削除されなかったバックアップが、再削除の対象に戻る**（＝修正前の既知バグに戻る）。リリースノートに 1 行だけ明記し、巻き戻しリリース時に旧 DB の残存を許容とすること。
- 選択肢 3 を採った場合の `attempts`（payload へのフィールド追加）は、**旧バージョンの `MigrationBackupPayload`（`version: 1`）Readers が未知フィールドを無視する**ため下位互換。`version` を上げる必要は無いが、採る場合は読み取り側のガード（`typeof payload.attempts === 'number'`）を必ず入れること。
- 修正によってバックアップが残ったプロファイルは、**修正前の挙動（次回起動で削除される）に巻き戻すと素直に元通り**。巻き戻しによる新規リスクはない（修正中はバックアップが残る＝可逆）。

## 見積もり

**2 SP**（🟢低）。理由: 実害は非可逆（データ復元手段の喪失）だが、変更の実体は `migrationBackup.ts:412` の条件式 1 行。Red-first で 0.5 日、Green + 既存テスト `:135-166` の読み替え + 回帰 + レビューで 1 日。支配的なのは「選択肢 3 を採るか否かの判断」と「既存テストの意図の読み替え」。1 スプリントに収まる。

（選択肢 2 を採る場合は **3 SP**（storage キー追加と既定値・型・状態表示の追随が加わる）。推奨は選択肢 1 ＋ 選択肢 3(b) の **2 SP** だが、**3(b) の上限値（新 storage キーは不要だが payload へのフィールド追加は入る）を入れるなら 2.5 SP** 程度。）

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス（Scenario 1〜5 の 5 件、うち Scenario 3/4 は既存テストの改変なし流用）
- [ ] `npm run validate` が緑（type-check + lint + 全テスト）。安定性は `npx vitest run src/offscreen/sqliteEngineContext/__tests__/migrationBackup.test.ts --repeats=20` で確認
- [ ] 監査 fingerprint `migrationBackup.runMigrationRestore:backup-removed-on-incomplete-restore` を完了記録（CHANGELOG / 監査 ledger）に残す
- [ ] コードレビュー完了（Security Review 観点: データ復元手段の破棄 = all-or-nothing な操作である。「より安全でない方向」には決して変わらないことを確認。かつ「残す分岐」（再検証 throw）と「新設する分岐」（件数不足）でログレベルと原因の区別が付いているか）
- [ ] ドキュメント更新済み（`pbi/00-INDEX.md` への行追加、`migrationBackup.ts` の JSDoc（`:395-399` の「Terminal guarantee」コメント）に「バックアップを捨てるには件数一致も必要」であることを明記、`CHANGELOG.md`）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: `IDB_MIGRATION_BACKUP` に 3 レコードを seed し、INSERT を 1 行だけ reject・COUNT は成功させて `runMigrationRestore` を実行すると、**バックアップキーの remove が呼ばれ、`IDB_MIGRATION_V2_DONE` が設定される**（削除条件が `reverifyOk` のみ）。`logWarn` に `{expectedCount:3, actualCount:0, restored:2}` が出る。`runMigrationRestore` は done を読まないため、バックアップを残せば次回 init で再試行が成立する
- 影響: 選択肢 1（条件を `actualCount >= expectedCount` へ）で BDD が通ることが確認できる。per-row INSERT の reject が COUNT 成功下で起こり得ることも証明済み

## 関連

- `pbi/00-INDEX.md`（本 PBI の登録先）
- 同じ移行領域の PBI との整合を確認すること:
  - **PBI 09「fallback partial wipe」**（`pbi/2026-10-18-09-fix-fallback-migration-partial-wipe.md`）― 同種の中核問題。fallback 経路も「部分失敗を投げて clearAll で消す」型。**「失敗ゼロを確認してから消す」規律を両者に適用**する必要がある。
  - **PBI 10「legacy count」**（`pbi/2026-10-18-10-fix-opfs-v2-verify-before-delete.md`）― **最も近い兄弟**。OPFS V2 経路は「件数を検証せず旧 DB を消す」問題で、その PBI の「選択肢 3」は **`migrationBackup.ts:370` 、つまり本 PBI の正常分岐を模範としている**。逆に言えば **本 PBI が直すと、兄弟が依拠している模範がさらに明示的になる**。PBI 10 に書かれた「`legacyMigration.ts:169` も同じ規律を持つ」という 3 者比較を再確認すること。
  - **PBI 17「rec snapshot」**（`pbi/2026-10-18-17-fix-recovery-migration-snapshot-remove.md`）― スナップショット除去のウィンドウが fail-open で status ゲートを通る問題。**同じく「安全網を捨てるタイミング」の判定漏れ**。3 件（本 + 09 + 17）で方策を揃えるべき。
  - **PBI 19「field drift」**（`pbi/2026-10-18-19-fix-recovery-field-mapping-drift.md`）― 旧レコードのフィールドが新スキーマに合わない問題。**本 PBI の「収束しないプロファイル」仮説の供給源**。19 が直せば選択肢 1 の欠点 1（永続ループ）の実在率が下がり、本 PBI は選択肢 1 単独で十分になる。**順序は 19 → 24 を推奨**。
  - `src/background/migration/legacyMigration.ts:169-175` / `:204-217` ― 3 つ目の移行経路。「部分成功は失敗」「original data preserved（元データを消さない）」という同じ規律を持つ。3 者比較の中継点。
  - `src/offscreen/sqliteStatus.ts:82,103` ― done フラグの表示側。done の意味を変えていないことの確認先。
- 既存テスト `src/offscreen/sqliteEngineContext/__tests__/migrationBackup.test.ts:135-166` ― 現行挙動を pin しており、**本 PBI の修正で意図が反転する**唯一のテスト。
- 監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 13番、`findings.json`、`REPORT.md`）