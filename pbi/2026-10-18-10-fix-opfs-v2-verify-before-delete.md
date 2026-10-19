# PBI: 旧 OPFS V2 移行の完了判定を「件数未検証のまま旧DBを消す」から「新DB側の実体を再検証してから安全網を捨てる」へ

## ユーザーストーリー

古い OPFS（wa-sqlite AccessHandlePoolVFS）の閲覧履歴を新しい SQLite DB へ移したユーザーとして、**移行が「全部移った」と確認できたときだけ元のデータを消してほしい**。移行は一度きり・自動・.background 側で行われるため、ユーザーは「移行は自動で安全」と(MigrationResult が例外を投げなければ)前提で、拡張機能を更新する（〔復元不能: 原文には「〜まで」で表される条件が入っていた。語は失われている〕）。そして移行は**データ復元の最後のひとつの機会**であり、移っていない行を黙って破棄することは、復元手段そのものを消すことに等しいからである。

現状、`migrateOldOpfsDb` は旧DBから読んだ行数と実際に新DBへ入った行数を一度も突き合わせずに、旧 OPFS ディレクトリを削除し（`deleteOldDb`）、`opfs_migration_v2_done` を立てて再試行を永久に止める。 **`count` は 1 つの成功シェイプに過ぎず、「重複でスキップ」「行単位で失敗」「トランザクションごとロールバック」のいずれも throw せず返り得る**ため、壊れた result を「全部成功」と読んで旧データを消す経路が開いている。

## 優先度

- 順位: 10 / 25
- RICE: 1500（Reach=300 / Impact=1 / Confidence=100% / Effort=0.2）
- 根拠: 監査10位。`migrateOldOpfsDb` は `insertBatch` から `{count}` だけを取り出し（`src/offscreen/opfsMigrationV2.ts:58`）、`records.length` との比較なしに `deleteOldDb`（`:59`）と `setMigrationDone`（`:60`）を**無条件**実行する。本番の `insertBatch` は INSERT OR IGNORE で skip を別 counter に回し（`crudHandlers.ts:116`）、per-row エラーは `index === 0` だけログして握りつぶし（`:118-122`）、transaction エラーはログのみで再throwしない（`:125-127`）。これらは例外ではなく `count` が小さい／**大きい**「成功Shape」で返る。よって skip/failed 行が旧ディレクトリごと破壊され、done フラグが再試行を止める。
  - 特に危険なのは**過大報告**側。`withTransaction` は COMMIT 失敗時も `ROLLBACK` して再throw する（`sqliteTransaction.ts:27-39`）のに対し、`handleInsertBatch` の transaction catch（`crudHandlers.ts:125-127`）はログのみでcatchし、**ロールバック済みのトランザクション内で積み上げた `inserted` カウンタをそのまま `count` として返す**（`:128`）。結果として「1行も永続化されていないのに `count = 3`」という oldest-first に最も〔復元不能〕な非 throw パスが存在する。`count === records.length` 比較だけではこの経路を捕まえられる保証がない。
  - 一方、**「重複で skip」は失敗ではない**（〔復元不能: 原文の主語〕）。INSERT OR IGNORE の skip は「その `(url, created_at)` が既に新DBにある」= 既に移行済み or 新 UNIQUE 制約で縮退しただけで、その行の内容自体は新DBに存在する。したがって素朴な `count === records.length` ゲートを入れると、旧DB内部に `(url, created_at)` 重複を持つユーザーでは**永久に done が立たず**、worker 起動のたびに再読込＋warn を繰り返す〔復元不能〕な副作用が生じる（`runMigrationV2` の module-level ガード `migrationV2.ts:22-26` があるため再試行は worker 世代単位）。
  - 兄弟の `migrationBackup.ts` は「件数を再検証してから安全網を捨てる」方針を持つが（`:367-376`）、レガシー tripling の V2 経路には同等チェックが無い。**さらに、同じ codebase 内の第3のマイグレーション（`legacyMigration.ts`）は既に正しい形をしている**: `:169` で `count < batch.length` を部分成功と判定し `hasErrors = true`、`:204-207` で完了に到達せず returnし、`:209-217` で **「original data preserved」**（＝元のデータを消さない）と明言している。V2 経路だけがこの規律から外れている。
  - 既存テストは throwing のみを pin しており（`opfsMigrationV2.test.ts:103`）、非 throw の部分 count の順序を固定していない。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低（orchestrator 1 ファイル + 型 1 か所 + テスト 1 ファイル）
- 副作用: 🔴あり（**理由**: 移行の終端条件そのものは、移行の「完了」の定義そのものを変えるため。現時点では不可解だった profile でも修正後は確実に警告が出る。誤って早期 done を打つと旧DB再読込という**データ復元の一手段が消滅**し、巻き戻しても復元できない。逆に done を立たせなかった結果、warn の継続・起動時オーバーヘッド・容量の二重保有という「動かなくなる」方向の副作用は避けられない（選択肢 1 のみ採用時の重複スキップ profile もこの部類）。加えて `deleteOldDbFile` は本番で**例外を投げない**（`opfsMigrationV2Reader.ts:159-166` が全エラーを握り潰す）ため、既存テスト `:132` が pin している「delete が失敗したら done を立てない」エスケープは**本番には存在しない**。修正時に「テストは緑でも本番は違う」錯覚しないよう注意が必要（本 PBI のスコープ外だが、把握しておくこと）。

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `opfsMigrationV2.migrateOldOpfsDb:unverified-count-delete-old-db`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 15番 / `findings.json`）。

根本原因（claimed root cause）: Count-unverified destructive delete ― orchestrator が skipped/failed 行の情報を捨て、throw しない `insertBatch` の戻り値すべてに対して不可逆な `deleteOldDb` + `setMigrationDone` を実行する。一方 callee は部分失敗モードを「throw しない部分 count」に変換する。

trace（entrypoint → sink）:

| # | ファイル:行 | 役割 |
|---|---|---|
| 1 | `src/offscreen/opfsWorker.ts:484` | entrypoint。`self.onmessage`。engine が null の非INITリクエストはトラフィック提供前に `initSqliteInner` を駆動 |
| 2 | `src/offscreen/opfsWorker.ts:139-152` | `initSqliteInner` が新DB engine を作り、`await runMigrationV2(migrationCtx)` でトラフィック提供前に移行を.await する |
| 3 | `src/offscreen/opfsWorker.ts:148` | `handleInsertBatch` を `ctx.handleInsertBatch` として注入（count チェックのラッパ無し） |
| 4 | `src/offscreen/opfsWorker/migrationV2.ts:37-55` | 本番 deps を配線: `readOldRecords: readOldDbRecords` / `insertBatch: ctx.handleInsertBatch` / `deleteOldDb: deleteOldDbFile` |
| 5 | `src/offscreen/opfsWorker/crudHandlers.ts:109-128` | per-row INSERT OR IGNORE ループ。重複は `skipped++`、行エラーは index 0 のみログ、transaction 失敗はログのみで再throwせず、いずれも成功Shape `{count}` を返す |
| 6 | `src/offscreen/opfsMigrationV2.ts:58` | `{count}` のみ destructure。`records.length` との比較なし。skipped/failed 情報そのものを捨てている |
| 7 | `src/offscreen/opfsMigrationV2.ts:59-60` | sink。無条件の破壊: `deleteOldDb` が旧 OPFS プールディレクトリを削除し、`setMigrationDone` が将来の再試行を永久に終了させる。到達しなかった行は復元不能 |

**行番号の実ファイル照合（監査 ref `d49d70a3` と現在 HEAD `56f1d7c1`）**: 上記8ファイル（`opfsMigrationV2.ts` / `opfsMigrationV2Reader.ts` / `opfsWorker/migrationV2.ts` / `opfsWorker.ts` / `opfsWorker/crudHandlers.ts` / `sqliteEngineContext/migrationBackup.ts` / `__tests__/opfsMigrationV2.test.ts` / `schema.ts`）すべて `git diff --numstat d49d70a3 HEAD` が空＝**ドリフトなし**。監査証拠の行番号は現在の HEAD でそのまま有効（`:58` / `:59` / `:116` / `:118` / `:125` / `:46` / `:370` / `:103`）。

部分 count に到達しうる機構（`schema.ts`）:

- `src/offscreen/schema.ts:46` ― `UNIQUE(url, created_at)`。旧DB内部の重複キーはこの制約下で skip になる
- `src/offscreen/schema.ts:17-20` ― `CHECK`（`visit_duration >= 0`、`0 <= scroll_ratio <= 1`、`is_starred IN (0,1)`、`is_deleted IN (0,1)`）。旧スキーマ由来値がこれに違反すれば per-row 例外になる
- `src/offscreen/opfsMigrationV2Reader.ts:119-136` ― reader は 10 列だけ SELECT しており pragma/`table_info` を行わない。**旧プールの DDL も per-row 値域も source 上に存在しない**ため、以下 BLOCKER が「実データで部分パスに到達するか」をソースから封じ込められない理由そのもの

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 3件中1件しか入らなかった非 throw の部分 count で、旧DBは消えない
  Given 旧データベースに 3 件の閲覧履歴があり、うち 1 件は制約違反で新DB上帝らない
  And   一括投入が「失敗せずに戻るが件数が 1 だけ」という結果を返す
  When  拡張機能のバックグラウンドが起動して移行が走る
  Then  移行は「完全には終わっていない」状態として扱われる
  And   旧データベースのデータは削除されない
  And   「移行済み」の目印は立たない
  And   次回の起動で同じ旧データベースの読み込みがもう一度試みる

Scenario: 2. 全件成功時だけ旧DB削除と移行済み設定が行われる（正常系の回帰ガード）
  Given 旧データベースに 3 件の閲覧履歴があり、その 3 件すべてが新データベースに入る
  When  拡張機能のバックグラウンドが起動して移行が走る
  Then  旧データベースのデータは削除される
  And   「移行済み」の目印が立つ
  And   移行済みログに「3件を移行」と記録される
  And   既存の正常系テスト（投入→削除→目印立つ の順序）が引き続き緑

Scenario: 3. 新DBに既に同キーの行がある（重複スキップ）だけでは完了を止めない
  Given 旧データベースに 3 件の閲覧履歴があり、そのうち 1 件は新データベースに既に同じキーで存在する
  When  移行が走る
  Then  その 1 件は「重複スキップ」として扱われ、移行は完了とみなされる
  And   旧データベースのデータは削除され、「移行済み」の目印が立つ
  And   黙って止まるような警告ログを出し続けない

Scenario: 4. 「全件入った」ように見えても、実体が消えていれば旧DBは残す
  Given 一括投入が「全件成功」を示す件数を返すが、実際には投入が取り消されている
  When  移行が新データベースの実体を照合する
  Then  照合結果が投入の件数に足りなければ、旧データベースのデータは削除されない
  And   「移行済み」の目印は立たない
  And   取り消された投入の事実が警告ログとして残る
```

Scenario 4 は「件数の自己申告」を信用しないという、本 PBI の核心（`withTransaction` の ROLLBACK 後にカウンタだけが残る経路への対策）です。

## 受け入れ基準

- [ ] 旧DBから読み出した行数と投入結果を照合し、**照合が通らない限り `deleteOldDb` を呼ばない**こと
- [ ] 照合が通らない-path で `setMigrationDone` を呼ばないこと（結果として `opfs_migration_v2_done` が立たない）
- [ ] 照合が通らない-path で、不完全な結果を `error` 相当として表面化し、`runMigrationV2` が警告ログを出すこと（`OPFS Worker: V2 migration failed (will retry next init)` の経路）
- [ ] 重複スキップ（既に新DBに同キーあり）を「失敗」として扱わないこと（＝Scenario 3 が通る）
- [ ] 全件成功時の既存順序（`insertBatch` → `deleteOldDb` → `setMigrationDone`）を壊さないこと（既存テスト `opfsMigrationV2.test.ts:79-101` が緑のまま）
- [ ] `insertBatch` 呼び出しに依存する wire 契約（`src/messaging/sqliteWireTable.ts:185-188` の `insertBatch` decode）を壊さないこと。返り値へのフィールド追加は decode 側で無視されるため問題ないことをテストで確認
- [ ] `StorageKeys` のキー構造・`chrome.storage` への書き込み方式を変更しないこと（既存プロファイルが読めること）
- [ ] 本番で `deleteOldDbFile` が例外を投げない（`opfsMigrationV2Reader.ts:159-166`）という事実を、コードコメントとして残すこと（既存テスト `:132` の前提が本番と乖離している）

## テスト戦略

### 単体

- **本 PBI の Red（まずこれを書いて「確実に赤」を観測する）**: `src/offscreen/__tests__/opfsMigrationV2.test.ts` に stub `MigrationDeps` を差し込み、`readOldRecords` が 3 件、`insertBatch` が **throw せず** `{ count: 1 }` を返す非 throw 部分 count。.Red 期待: `deleteOldDb` が呼ばれず、`setMigrationDone` が 1 度も呼ばれず、結果に error が含まれ、警告ログ用の情報が返る。
- **正常系ガード**: 既存 `:79-101` の `callOrder === ['insertBatch', 'deleteOldDb', 'setMigrationDone']` を**改変せず残す**（回帰ガード）。
- **重複スキップ**: `insertBatch` が `{ count: 1, inserted: 1, skipped: 2 }` を返す 3 件 scenario で、スキップを失敗扱いせず完了とする（Scenario 3）。
- **過大報告**: `insertBatch` が `{ count: 3, inserted: 3, skipped: 0 }` を返しても、実体照合（`deps` に追加した「新DB件数読み出し」stub）が 0 を返すケースで、完了しない（Scenario 4）。
- **既存テストの改変禁止**: `:103`（throwing）、`:118`（readOldRecords throwing）、`:132`（deleteOldDb throwing）、`:52`（skip 済み）、`:66`（0件）は**そのままで残す**。追加は「隣に追加」方式。
- 合格条件: `npx vitest run src/offscreen/__tests__/opfsMigrationV2.test.ts --repeats=20`。AGENTS.md の test rule に従い、**実時間 sleep を追加しない**（全部 Promise ベースの stub）。

### 統合

- `src/offscreen/opfsWorker/migrationV2.ts:37-55` の配線経路に対する統合テスト。`migrateOldOpfsDb` に実 deps（`readOldDbRecords` の 「旧ディレクトリなし → []」 スタブ）と `handleInsertBatch`（`src/offscreen/__tests__/opfsWorker-transactionIntegrity.test.ts:88` の mock engine の流儀）を注入し、`runMigrationV2` が partial で `opfs_migration_v2_done` を立てないことを確認する。
- `src/offscreen/__tests__/insertBatch-counting-parametric.test.ts` / `sqliteBackendParity.realEngine.test.ts` 系に、**「COMMIT 失敗 → ROLLBACK 後も `count` が残る」現挙動の pin** を 1 件追加してよい（※本 PBI で直さない場合、直さない事実を固定する）。

### E2E

- owner 観測（オフラインのステージングコピー）: 移行前プールの DB を複製し、`PRAGMA table_info(browsing_logs)` と `(url, created_at)` 重複数・CHECK 違反値の数を数えて「部分パスに到達しうる実データが存在するか」を確定する。移行後は**旧DBの行数と新DBの行数を比較**し、不一致があれば**削除せずにログに出す**（監査の deployment validation plan と対応）。
- これは BLOCKER の Closure そのものなので、実装の Red/Green より前に owner が 1 回実行して結果を PBI に記録すること。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（現在 HEAD `56f1d7c1` で確認・監査 ref `d49d70a3` と差分ゼロ）

**変更の中心**

| ファイル:行 | 現状 | 備考 |
|---|---|---|
| `src/offscreen/opfsMigrationV2.ts:58` | `const { count } = await deps.insertBatch(records);` | skipped/failed を捨て、`records.length` 比較なし |
| `src/offscreen/opfsMigrationV2.ts:59-60` | `await deps.deleteOldDb(); await deps.setMigrationDone();` | sink。throw しない戻り値すべてに無条件実行 |
| `src/offscreen/opfsMigrationV2.ts:63-66` | catch。done を立てず error を返す | 既存の正しいエスケープ。**ここに「部分 count」の扱いを寄せる** |
| `src/offscreen/opfsMigrationV2.ts:23-24` | `insertBatch(records): Promise<{ count: number }>` | deps 型。選択肢 2 を採るならここに `skipped` / `failed` を足す |
| `src/offscreen/opfsMigrationV2.ts:53-56` | 0 件なら delete せず done を立てる | 現状で正しい挙動。維持すること |

**呼び出し経路（現状を壊してはいけない点）**

| ファイル:行 | 役割 |
|---|---|
| `src/offscreen/opfsWorker.ts:484` | entrypoint（`self.onmessage`） |
| `src/offscreen/opfsWorker.ts:139-152` | `initSqliteInner`。`:148` で `handleInsertBatch` を注入、`:151` で `await runMigrationV2` |
| `src/offscreen/opfsWorker/migrationV2.ts:14` | `MigrationContext.handleInsertBatch` の型が `{ count: number }` に狭い（実体は 3 フィールド返す） |
| `src/offscreen/opfsWorker/migrationV2.ts:37-55` | deps 配線。`:57-63` で `result.migrated` を storage に記録（partial を成功として書かないこと） |
| `src/offscreen/opfsWorker/migrationV2.ts:22-26` | module-level ガード。**同じ worker 世代内では再試行しない**。部分失敗時のリトライは「次 worker 生成」から |
| `src/offscreen/opfsWorker/crudHandlers.ts:109-123` | per-row ループ。`:116` `inserted++` / `skipped++`、`:118-122` per-row catch（index 0 のみログ） |
| `src/offscreen/opfsWorker/crudHandlers.ts:125-127` | transaction catch。ログのみ・再throw なし |
| `src/offscreen/opfsWorker/crudHandlers.ts:128` | `return { count: inserted, inserted, skipped }` ― **`inserted` はロールバック済みでも残る** |
| `src/offscreen/sqliteTransaction.ts:27-39` | `BEGIN IMMEDIATE` → 失敗時 `ROLLBACK` して**再throw**。`:30` の COMMIT 失敗も roll-back 対象 |
| `src/offscreen/opfsWorker/handlers.ts:38-40` | worker 側の `withTransaction` アダプタ |

**参照のみ（壊さない）**

| ファイル:行 | 役割 |
|---|---|
| `src/offscreen/opfsMigrationV2Reader.ts:119-136` | 旧 reader。10 列 SELECT、pragma なし |
| `src/offscreen/opfsMigrationV2Reader.ts:159-166` | `deleteOldDbFile`。**全エラーを握り潰す＝本番では throw しない** |
| `src/offscreen/schema.ts:17-20, 46` | CHECK 制約と `UNIQUE(url, created_at)` |
| `src/messaging/sqliteWireTable.ts:185-188` | `insertBatch` の decodeGateway。`inserted ?? count` を明示的に拾うので、返り値への未知フィールド追加は wire-safe |
| `src/utils/storage/types.ts:259-262` | `opfs_migration_v2_{done,last_attempted_at,completed_at,record_count}` |

**先例（この PBI がombraす形）**

| ファイル:行 | 役割 |
|---|---|
| `src/offscreen/sqliteEngineContext/migrationBackup.ts:367-376` | `SELECT COUNT(*)` で実測 → `actualCount >= expectedCount && expectedCount > 0` を満たすときだけ**バックアップを捨てる** |
| `src/background/migration/legacyMigration.ts:169-175` | `count < batch.length` を部分成功と判定し `hasErrors = true` |
| `src/background/migration/legacyMigration.ts:204-217` | `hasErrors` なら完了せず return、ログは **"original data preserved"**（元のデータを消さない） |

### 最小変更の選択肢

**選択肢 1（最小・推奨）**: `migrateOldOpfsDb` で `count` と `records.length` を比較し、一致時のみ `deleteOldDb` + `setMigrationDone`

- 変更量: `opfsMigrationV2.ts:58-60` の 3 行 + ログ 1 行 + deps 型（任意）。
- 利点: `MigrationDeps` の型を変えない（wire も既存テストも無傷）。`:63-66` の既存 catch と同じ「error を返して done を立たない」形に着地するので、既存契約の拡張を 1 箇所に閉じ込められる。
- **欠点（実装前に必ず読むこと）**:
  1. 旧DB内部に `(url, created_at)` 重複があるユーザーでは `count < records.length` が**恒久的に**成立し、`deleteOldDb` が永久に起きない。`runMigrationV2` の module-level ガード（`:22-26`）があるため、**worker 生成のたびに**旧プールの再読込 + warning が走る。→ Scenario 3 が壊れる設計。回避するには「count 不一致 = 失敗」ではなく「`count + skipped === records.length` なら完了」とする（選択肢 1 の改良形）。
  2. `count` の**過大報告**（ROLLBACK 後もカウンタが残る経路、`crudHandlers.ts:125-128`）は捕まらない。`count === records.length` でも実体が 0 のまま旧DBを消す可能性がある。

**選択肢 2**: `insertBatch` 側から `skipped` / `failed` を返し、`migrateOldOpfsDb` が「失敗ゼロ」を条件にする（`crudHandlers` 側の API 変更を伴う）

- 変更量: `crudHandlers.ts:98` の戻り値型に `failed` を追加（per-row catch で `failed++`）、`opfsWorker/migrationV2.ts:14` の `MigrationContext.handleInsertBatch` 型、`opfsMigrationV2.ts:24` の deps 型を緩める。判定は `inserted + skipped + failed === records.length`、すなわち `failed === 0`。
- 利点: **選択肢 1 の欠点 1 を自然に解消する**（skip は失敗ではない）。`legacyMigration.ts:169` と同じ「部分成功は失敗」の規律に揃う。判定が意味的に明快で、ログ文言もそのまま書ける。
- 欠点/費用:
  - `handleInsertBatch` は wire の `INSERT_BATCH` ハンドラでも使われる（`opfsWorker.ts:356`）。ただし `sqliteWireTable.ts:185-188` の decodeGateway が `inserted`/`count`/`skipped` を明示的に選ぶため、未知フィールド追加は **wire-safe**。既存テスト `opfsWorker-transactionIntegrity.test.ts:107` は `toEqual({ count: 1, inserted: 1, skipped: 0 })` で**完全一致**しているため、`failed` を足すと**このテストが赤くなる** → 期待値の更新が必要（契約の明示であり、破壊ではない）。
  - ただし **選択肢 2 だけでは過大報告（欠点 2）は捕まらない**。そこは選択肢 3 の実体照合が必要。

**選択肢 3**: 兄弟 `migrationBackup.ts:370` と同じ「count 一致確認後に安全網を捨てる」形へ統一

- 変更量: `MigrationDeps` に「新しい DB の現在件数を読む」関数を 1 つ追加（`migrationBackup.ts:368` の `SELECT COUNT(*) FROM browsing_logs` と同形）、`migrationV2.ts:37-55` の配線で注入、`opfsMigrationV2.ts:59-60` の前に照合を置く。判定は `actualCount >= records.length && records.length > 0`。
- 利点: **orchestrator が自分の戻り値を信用しなくなる**。ROLLBACK による過大報告・per-row 失敗・skip を**すべて**捕まえる。`migrationBackup.ts:357-365` の「0件は早期 return して照合条件を永久に満たさないことがある」ガードも、`:53-56` が既に同じ扱いになっているため同形対応できる。
- 欠点: deps インターフェースが 1 つ増える（テストの stub も 1 つ増える）。`migrationBackup.ts` のやり方（実測してから捨てる）は 1 クエリ増えるだけで、移行は一度きりの経路なので**コストは無視できる**。

**推奨: 選択肢 2 + 選択肢 3 の併用（2 の「失敗ゼロ」で意味的なゲート、3 の「実体照合」で過大報告を潰す）。最低ラインは選択肢 1 の改良形（`count + skipped === records.length`）で、Scenario 1 と 3 は通るが Scenario 4（過大報告）は通らない。Scenario 4 を BDD に書いた以上、実装は 3 まで踏み込むこと。** すでに低難度なので、2+3 の工数は「🟢低」の範囲で収まる（選択肢 3 の照合関数追加が実質的な差分）。

### 既存テスト（`src/offscreen/__tests__/opfsMigrationV2.test.ts`）への追加項目

現行 147 行・6 テスト。このうち `:103` は **throwing のみ**を pin しており、「throw しない部分 count で `deleteOldDb` + `setMigrationDone` が呼ばれる」順序を固定していない。追加は**改変せず隣に追加**する。

- `:103` の throwing テスト ― **そのまま残す**（throw 経路は引き続き「delete せず done 立たない」の契約）。
- `:79-101` の happy path ― **そのまま残す**（`callOrder` の順序が回帰ガード）。選択肢 2/3 を採ると `insertBatch` 以降に照合が入るため、`callOrder` への追加要素があれば expected も更新する（順序の意味は「insert → 確認 → delete → done」のまま不変であることを assert する）。
- `:132` の delete 失敗テスト ― **そのまま残す**が、本番 `deleteOldDbFile` は throw しない（`opfsMigrationV2Reader.ts:159-166`）ため、このエスケープが本番に無い旨をコメントで残す。
- `:66` の 0 件テスト ― そのまま残す。選択肢 3 で実体照合を入れる場合、`actualCount` スタブの初期値（0 でも 3 でも）で判定が変わらないことを確認する（`migrationBackup.ts:357-365` と同じ「0件は照合条件を待たない」扱い）。
- 新規: 非 throw 部分 count（Scenario 1）／重複スキップ（Scenario 3）／過大報告（Scenario 4）の 3 件。

### ブロッカー（着手前に潰すべき owner 確認）

needs_validation の blocker は 1 件（`NEEDS-VALIDATION.md` 15番）:

> 実データの移行前 OPFS プール DB が、throw しない部分パスを誘発する行を持つかどうか: 新 `UNIQUE` 制約下で縮退する旧DB内部の `(url, created_at)` 重複か、`visit_duration` / `scroll_ratio` / `is_starred` / `is_deleted` の新スキーマ `CHECK` に違反する旧値か。**旧プールの DDL と per-row 値域は source に無く**（reader は pragma/`table_info` を行わず 10 列だけ SELECT する: `opfsMigrationV2Reader.ts:119-136`）、対象制御下の実行は不可のため、部分パスへの到達可能性はソースだけでは封じ込められない。

したがって**実装着手前に**、次の 2 段階を潰すこと:

1. **Red 確認（監査 local validation plan のそのまま）**: 上記「テスト戦略 → 単体」の非 throw 部分 count の pin を先に書き、修正前に「確実に赤」であることを観測する。**赤が出なかった場合、監査の根本原因が誤り**であり、設計に着手せず原因を再考して監査へ是正を返すこと。
2. **owner-observed 確認（監査 deployment validation plan）**: オフラインのステージングコピーで上記プロシージャを実行し、「旧DBの行数と新DBの行数の差」と「不一致時に削除しないこと」を 1 回実機観測して結果を PBI に記録する。

この 2 つが閉じるまで「修正できた」と宣言しない。特に **選択肢 1 を採る場合は blocker 1 の結果（重複の実在率）で Breaking Change リスクが跳ね上がる**ため、先に観測すること。

### ロールバック手順

- 変更は `src/offscreen/opfsMigrationV2.ts`（+ 採用した場合 `opfsWorker/migrationV2.ts` / `opfsWorker/crudHandlers.ts` の型と 1 counter）とそのテストに閉じており、`StorageKeys` のキー構造・`chrome.storage` の書き込み方式・schema・wire 契約を変更しない。`git revert <commit>` で即座に旧「count 検証なし destroy」に戻る。マイグレーション/version bump は不要。
- **ロールバック時に既存プロファイルの読み込みは壊れない**が、**修正中に実際に削除されなかった旧DBが、再削除の対象に戻る**（＝修正前の既知バグに戻る）。リリースノートに 1 行だけ明記し、巻き戻しリリース時に旧DBの残存を許容とすること。
- **修正によって done が立たなかった profile**が巻き戻す際、enum師に `opfs_migration_v2_done` が立っていない profile は「次 worker 生成時に旧DBを再読込して削除」される。これは修正前の挙動そのものなので、巻き戻しによる新規リスクはない（修正中は旧DBが残る=可逆）。

## 見積もり

**3 SP**（🟢低）。理由: 実害は破壊的だが変更は orchestrator 1 ファイル + 型数行 + テスト 4 件。支配的なのは「blocker を潰す owner 観測」と「選択肢 3 を選んだ場合の deps インターフェース追加」。Red-first で 1 日、Green + 回帰 + レビューで 1 日。1 スプリントに収まる。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス（Scenario 1〜4 の 4 件）
- [ ] `npm run validate` が緑（type-check + lint + 全テスト）。安定性は `npx vitest run src/offscreen/__tests__/opfsMigrationV2.test.ts --repeats=20` で確認
- [ ] 監査 fingerprint `opfsMigrationV2.migrateOldOpfsDb:unverified-count-delete-old-db` を完了記録（CHANGELOG / 監査 ledger）に残す
- [ ] コードレビュー完了（Security Review 観点: データ復元手段の破棄=all-or-nothing な操作である。「 MORE 安全でない方向」には決して変わらないことを確認）
- [ ] ドキュメント更新済み（`pbi/00-INDEX.md` への行追加、`opfsMigrationV2.ts` の JSDoc に「完了＝安全網を捨てる条件」を明記、`CHANGELOG.md`）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: readOldRecords=3 件 / insertBatch=`{count:1}`（非 throw の部分 count）で **`deleteOldDb` と `setMigrationDone` が呼ばれた**。加えて実 `handleInsertBatch` で COMMIT 失敗を起こすと **ROLLBACK 後も `{count:3, inserted:3, skipped:0}` を返す過大報告**を再現（自己申告 count では不完全性を検出できない）
- 影響: 修正は count と records.length の比較だけでは不足する。`skipped ≠ failure` の扱いと実体 COUNT(*) 照合の併用が必要

## 関連

- `pbi/00-INDEX.md`（本 PBI の登録先）
- 同じ移行領域の PBI との整合を確認すること:
  - **PBI 09「fallback partial wipe」**（監査 `fallbackMigration.tryMigrateFallbackToSqlite:partial-failure-clearall-wipe`）― **同種の中核問題**。fallback 経路も「部分失敗を投げて clearAll で消す」型なら、**同じ「失敗ゼロを確認してから消す」規律**を両者に適用する必要がある。選択肢 2/3 の判定ロジックは共有できる可能性がある（別モジュールにあるが、`legacyMigration.ts:169` の `count < batch.length` 判定と並べて読むこと）。
  - **PBI 13「field drift」**（監査 `opfsRecovery.convertFallbackRecord:fallback-reason-field-drift`）― 旧レコードのフィールドが新スキーマに合わない問題。**本 PBI の Scenario 4 と直接関連する**: フィールドが欠損/型が違う行は `crudHandlers.ts:118` の per-row catch に落ち、`failed` として数えられるべき行になる。13 が直すと決めるなら、本 PBI で「field drift を migration 前に正規化して直す」選択肢を 1 案追加すること。
  - **PBI 17「rec snapshot」**（監査 `opfsRecovery.migrate:snapshot-remove-window-fail-open-status-gate`）― スナップショット除去のウィンドウが fail-open で status ゲートを通る問題。**同様に「安全網を捨てるタイミング」の判定漏れ**で、3 件（本 + 09 + 17）で方策を揃えるべき。3 件すべてが「検証→比較→安全に捨てる」を各自行っているため、`migrationBackup.ts:367-376` を共通言語にして統一することを推奨。
  - 既存テスト `opfsMigrationV2.test.ts:103`（throwing のみ pin）― 追加項目の起点。
- 監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 15番、`findings.json`、`REPORT.md`）
