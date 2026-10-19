# PBI: IDB 版 insert が `last_insert_rowid()` を別クエリで読むため、同時挿入時に他行の id を返し `obsidian_synced` が別の行に付く（INSERT ... RETURNING へ置き換える）

## ユーザーストーリー

個人ユーザーとして、IDB ラング（SQLite の VFS を wa-sqlite の IDB に載せる経路）で記録を保存したとき、返される番号が必ず「その呼び出しが自分で書いた行」の番号になるようにしてほしい。なぜなら Mirroring 済みノートの `obsidian_synced` マークはその番号をキーに 1 行へ付けるため、番号が別の行を指すと**実際に Mirroring した行は未マークのまま残り、別の行が「送信済み」と誤って扱われる**から。Mirroring の対象から外れるのは、ユーザーが自分で選んだ記録が黙って対象から外れる仕組みの中核だから。

## 優先度

- 順位: 23 / 25
- RICE: 333（Reach=100 / Impact=0.25 / Confidence=50% / Effort=0.3）
- 根拠 / 種別: 🔧非機能追加（fix） / 難易度: 🟢低 / 副作用: 🟡軽微
  - 種別・難度の根拠: 記録の保存そのものではなく「保存後に付ける行の識別子」の正しさの修正。atomic な `INSERT ... RETURNING` 形式をリポジトリが既に保持しており（`schema.ts:154`）、既存のエンジン経路（`sqliteBoot.ts:84-86`）が `query()` も同じ `db.run()` に写すため、差し替えは 1 関数ぶんの変更で閉じる。スキーマ変更も移行も要らない。
  - 副作用「🟡軽微」の根拠: 影響するのは Mirroring 済みノートの再送と、行の取り違えという Mirroring の対象選定のみ。行そのものの消失ではなく、予約履歴の実体（`browsing_logs` の行）もスキーマも変えない。RETURNING へ寄せたあとも単発の insert が返す番号は従来と同一である（`idbScalarRead-golden.test.ts:56-59` が 1 と 2 を固定しており、この固定がそのまま通る）。

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `IdbVfsBackend.insert:last-insert-rowid-interleave`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/

- 判定: `needs_validation`（NEEDS-VALIDATION.md 3番）
- claimed root cause: 番号の読み出しが insert と atomic でない（トランザクションも insert 経路の RETURNING も無い）。一方でリポジトリは atomic な RETURNING 形式（`schema.ts:154`）を既に持ち、batch 書き込みは `withTransaction` で包んでいる。
- entrypoint: `src/offscreen/offscreen.ts:96` ― メッセージ 1 件ごとに独立した async IIFE を立てる（`:96-128`）。同時 `SQLITE_INSERT` は直列化されず、mutex も共有しない。
- propagation: `src/offscreen/sqliteMessageHandlers.ts:344` ― `SQLITE_INSERT` は `handleSqliteWire('insert', …)` を通り `recordsRepo.insert`（`recordsRepo.ts:17-19`）経由で `backend.insert` に到達する。振り分け経路に直列化キューは無い（`offscreen.ts:34-59` の `dispatchSqliteMessage` はサイズ検査と Map 引きのみ）。
- propagation: `src/offscreen/IdbVfsBackend.ts:100-101` ― `await execWithCache(INSERT_SQL, params)` の後に `await this.scalar('SELECT last_insert_rowid()')` を別 await で実行し、その間にトランザクションが無い。対照的に `insertBatch` は `:111-119` で `withTransaction` に包んでいる。`execWithCache`（`idbEngineLifecycle.ts:55-69`）はキューを通さずそのまま wasm エンジンへ渡す。
- sink: `src/background/pipeline/steps/saveSqliteStep.ts:91` ― 返された番号をキーにした `update { id: mutateResult.data.id, changes: { obsidian_synced } }` が走るため、同時挿入された行が `obsidian_synced=1` になり、実際に Mirroring した行は未マークのまま残る。

補足（実ファイルで確認した事実）:

- **OPFS ラングには同型の非 atomic な組があるが、そこは直列化されている。** `src/offscreen/opfsWorker/crudHandlers.ts:22-28` の `handleInsert` も `INSERT_SQL` のあとに `SELECT last_insert_rowid() AS id` を読む 2 段構成だが、`src/offscreen/opfsWorker.ts:386-392` のリクエスト直列化キュー（`:448-458` の `processQueue`）がその間に入り込む余地を塞いでいる。**IDB ラングにはこのキューが無い**ことが、本件の非対称の本体である。
- `insertAuditLog`（`IdbVfsBackend.ts:302-310`。`:304-307` が `AUDIT_INSERT_SQL`、`:308` が `SELECT last_insert_rowid()`）にも同型の組がある。ただし返された番号を実際に使っているのは `src/messaging/sqliteWireTable.ts` の `decodeGateway` のみで、呼び出し側の `src/messaging/auditLogGateway.ts:43-53`（`recordAuditLog`）は返却値を一切参照しない。現時点の被害は `insert` 側だけだが、**同じ誤り方が 2 箇所に複製されている状態**はそのまま残さない。
- `wrapDb`（`src/offscreen/sqliteBoot.ts:74-103`）は `exec` と `query` の両方を同じ `db.run(sql, params)` に写す。`INSERT ... RETURNING` は OPFS ワーカー側で既に `sqlQuery` 経由で使われている（`crudHandlers.ts:113` の `INSERT_IGNORE_RETURNING_SQL`）ので、`execWithCache` のコールバック付き経路でも RETURNING を扱える（実機での確認は下記のブロッカー）。
- `schema.ts:147-153` のコメントが既に RETURNING の正しさを論証している。「`OR IGNORE` で無視された行と、FTS5 同期トリガが書いた行は結果セットに現れないので件数が正確」という議論が、そのまま `insert` の番号取得にも使える。
- `browsing_logs` の FTS5 同期トリガは `last_insert_rowid()` の値を変えない（トリガ本体が実行されている間は元の値に戻される）。したがって本件の原因はトリガではなく、あくまで INSERT と SELECT の間の窓。

## BDD受け入れシナリオ

```gherkin
Scenario: 1: 同時に走った 2 件の保存は、それぞれ自分が書いた行の番号を受け取る
  Given 同じ閲覧履歴データベースに 2 件の記録が同時に保存要求として届く
  When  2 件の保存が重なって実行される。片方の保存が「行を書く」工程と
        「書いた行の番号を読み戻す」工程のあいだに、もう片方の保存が行を書く
  Then  それぞれの保存が受け取る番号は、その保存自身が書いた行の番号である
  And   保存後に「Mirroring 済み」と印を付ける更新が走ったとき、
        その印は実際に Mirroring した行に付き、別の行には付かない
  And   Mirroring したはずの行が未印のまま残ることがない

Scenario: 2: 1 件だけの保存は従来と同じ番号を返す（回帰ガード）
  Given 記録が 1 件だけ保存される
  When  その保存が実行される
  Then  返される番号は従来どおり、挿入順に採番されたその行の番号である
  And   2 番目、3 番目と続けて保存した場合も、採番は 1 ずつ増える（既存の採番規則が変わらない）

Scenario: 3: 境界値（同時に走るのは何件でも、各呼び出しは自分の行を指す）
  Given 同時に 10 件の記録の保存が要求として届く
  When  それらが重なって実行される
  Then  10 件すべてが、それぞれ自分が書いた行の番号を受け取る
  And   返された 10 個の番号は重複せず、挿入された 10 行と 1 対 1 で対応する
```

## 受け入れ基準

- [ ] `IdbVfsBackend.insert()`（`IdbVfsBackend.ts:96-103`）が返す `id` は、その呼び出し自身が `browsing_logs` に書いた行の `id` であること。実装は `INSERT ... RETURNING id` へ差し替える、または INSERT と SELECT を同一トランザクションで包む、のいずれか。
- [ ] `saveSqliteStep.ts:91` の後続 update が、Scenario 1 の条件（保存が重なって走った場合）でも実際に Mirroring した行に付くことを統合テストで固定すること。**`npm run validate` が緑であることは受け入れの必須条件**とする。
- [ ] 単発の insert が従来と同じ番号を返すこと（回帰ガード）。既存の golden 固定 `idbScalarRead-golden.test.ts:56-59`（番号が 1 と 2）がそのまま緑であることを確認し、期待値を書き換えて通さないこと。
- [ ] `insertAuditLog`（`IdbVfsBackend.ts:302-310`）にも同型の非 atomic な組が残らないこと。返された番号が現状使われていない（`auditLogGateway.ts:43-53` は参照しない）である点を理由に**据え置かない**。一方だけ直して同じ誤り方が 2 箇所に残る状態を禁止する。
- [ ] IDB ラングと OPFS ラングで「insert が返す番号」の意味が一致すること。現状 `opfsWorker/crudHandlers.ts:22-28` にも同型の組があるが、`opfsWorker.ts:386-392` の直列化キューが守っているため実害はない。**守っているものを理由に IDB 側を放置しない**一方、OPFS 側を本 PBI で書き換えても差し支えはないことを明記する。
- [ ] `obsidian_synced` の印が外れる側の失敗（実際に Mirroring した行が未印のまま残る）が存在しないこと。Scenario 1 の最後の `And` がその保証であり、期待値は「印が付く」であること。
- [ ] 実害の向きを片側に倒さないこと。本件の失敗は片方向（未マークの行が残る）で、印が意図しない行に付いただけではない。両方向をテストで書き分けていること。
- [ ] 変更が `manifest.json` の権限、`web_accessible_resources`、ストレージキーの構造、`browsing_logs` のスキーマのいずれにも触れていないこと（いずれも変更不要。`npm run build` と `npm run validate` の緑で担保する）。

## テスト戦略

- 単体: `src/offscreen/__tests__/sqliteBackendParity.realEngine.test.ts` の方式（`:14-29` の better-sqlite3 読み取り、`:32-49` の `openEngine`、`:52-65` の `makeBackends`、`:65` の `ensureDb` 上書き）に乗せる。`insert()` の 2 つの promise を同時に開始し（`Promise.all` ではなく**両方を起動してから**待つ形）、各返却 id がその呼び出しが書いた行の `url` と一致することを `--repeats=20` で確認する。加えて `handleSqliteWire('insert', …)` 経由の重複 `SQLITE_INSERT` ディスパッチ（`sqliteMessageHandlers.ts:344`）を重なって起こし、offscreen 経路が直列化を加えない（= 窓が実在する）ことも併せて確認する。Scenario 3 の 10 件版も同じテスト内で回す。**実時間待ちは入れない**（`AGENTS.md`「Async / Timing Failures」）。窓を確実に作るには promise の起動順をテスト側で制御し、一定時間待つのではなく完了の合図を待つ。
- 統合: `src/background/pipeline/steps/saveSqliteStep.ts:90-92` の後続 update が正しい行に付くこと。既存の `src/background/pipeline/__tests__/saveSqliteStep.test.ts:91-114`（`id: 1` 固定のモック）を土台に、2 件の保存が重なり、各保存が自分の行に `obsidian_synced` を付ける状況を作り、行番号と印の対応を検証する。
- E2E: **owner 観測（読み取り専用）**。IDB ラングを使うプロファイルで `browsing_logs` の行番号と挿入順を比較し、Mirroring 済み行（`obsidian_synced=1`）のうち、Mirroring の対となる行が未マークのまま残っているものが存在するかを見る。書き込みも実ターゲットへの probing も行わない。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認 / HEAD `56f1d7c1`）

| ファイル | 行 | 該当箇所 |
|---|---|---|
| `src/offscreen/IdbVfsBackend.ts` | `:96-103` | `insert()` の全体。`:100` が `await this.engine.execWithCache(INSERT_SQL, params)`、`:101` が `const id = await this.scalar('SELECT last_insert_rowid()')`、`:102` が `{ success: true, id }` を返す |
| 同上 | `:74-78` | `scalar()` ヘルパー。`:76` が `execWithCache(sql, params, callback)` で第 1 セルを `Number()` で取る |
| 同上 | `:62-64` | `transaction` ゲッター。`{ exec: (sql) => this.engine.execWithCache(sql) }` ― `withTransaction` に渡す実体 |
| 同上 | `:105-121` | `insertBatch()`。`:111-119` が `withTransaction(this.transaction, async () => { … })`、`:114` が `INSERT_IGNORE_SQL`、`:115` が `SELECT changes()` ― **本件が包まれている対照実装** |
| 同上 | `:302-310` | `insertAuditLog()`。`:304-307` が `AUDIT_INSERT_SQL`、`:308` が `const newId = await this.scalar('SELECT last_insert_rowid()')`、`:309` が番号を返す |
| 同上 | `:11` | `import { INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams } from './schema.js'` ― 差し替え時に触る import |
| `src/offscreen/schema.ts` | `:114` | `INSERT_SQL`。`RETURNING` を持たない（監査 evidence） |
| 同上 | `:145` | `INSERT_IGNORE_SQL` |
| 同上 | `:154` | `INSERT_IGNORE_RETURNING_SQL` ― **リポジトリが既に持つ atomic 形式**。`:147-153` のコメントが RETURNING の正しさを論証 |
| `src/offscreen/sqliteEngineContext/idbEngineLifecycle.ts` | `:55-69` | `execWithCache`。`:61-64` はコールバック無しで `idbEngine.exec`、`:65-68` はコールバック有りで `idbEngine.query`。**キューを通さずそのまま渡す** |
| `src/offscreen/sqliteBoot.ts` | `:74-103` | `wrapDb`。`:80-82` の `exec` と `:84-86` の `query` が**両方とも** `db.run(sql, params)` を呼ぶ。RETURNING を `query` 経由で取る経路が存在する根拠 |
| `src/offscreen/offscreen.ts` | `:34-59` | `dispatchSqliteMessage`。`:42-46` のサイズ検査、`:48-51` の Map 引き。**直列化が無い** |
| 同上 | `:96-128` | メッセージ 1 件ごとの独立した async IIFE（`:108` が `dispatchSqliteMessage` の呼び出し） |
| `src/offscreen/sqliteMessageHandlers.ts` | `:344` | `SQLITE_INSERT` → `handleSqliteWire('insert', msg, sendResponse)` |
| 同上 | `:347` | `SQLITE_AUDIT_LOG_INSERT` → `handleSqliteWire('insertAuditLog', …)` |
| 同上 | `:120-` | `handleSqliteWire` の定義。振り分けに直列化キューは無い |
| `src/offscreen/recordsRepo.ts` | `:17-20` | `insert()` → `backend.insert(record)` |
| `src/offscreen/auditLogRepo.ts` | `:17-19` | `insertAuditLog()` → `backend.insertAuditLog(record)` |
| `src/offscreen/queryPlan.ts` | `:668-669` | `AUDIT_INSERT_SQL`。RETURNING を持たない |
| `src/background/pipeline/steps/saveSqliteStep.ts` | `:75` | `mutate({ type: 'insert', … })` ― 番号を取得する最初の呼び出し |
| 同上 | `:90-92` | `:91` が `update { id: mutateResult.data.id, changes: { obsidian_synced } }` ― **sink** |
| `src/background/pipeline/savePhase.ts` | `:83` | `obsidianSynced: context.obsidianDuration !== undefined ? true : undefined` ― 印が付く条件の出所 |
| `src/messaging/auditLogGateway.ts` | `:43-53` | `recordAuditLog`。`:46` で insert を呼ぶが、返却 id を参照しない |
| `src/offscreen/opfsWorker/crudHandlers.ts` | `:22-28` | OPFS 側の `handleInsert`。`:24` が `INSERT_SQL`、`:26` が `SELECT last_insert_rowid() AS id` ― **同型の非 atomic 組（キューが守っている）** |
| 同上 | `:113` | `INSERT_IGNORE_RETURNING_SQL` の使用箇所 ― RETURNING が OPFS 経路で既に動く証拠 |
| `src/offscreen/opfsWorker.ts` | `:386-392` | リクエスト直列化キューの宣言。`:400` が `MAX_QUEUED_REQUESTS = 200` |
| 同上 | `:448-458` | `processQueue` ― 逐次実行ループ。**IDB ラングに無いもの** |
| `src/offscreen/__tests__/sqliteBackendParity.realEngine.test.ts` | `:14-29` / `:32-49` / `:52-65` | 実エンジン fixture。better-sqlite3 と `bootSqliteEngine` で `IdbVfsBackend` を組み立てる |
| 同上 | `:65` | `(idb as unknown as { ensureDb: () => void }).ensureDb = () => {}` ― テスト側の差し替え点 |
| `src/offscreen/__tests__/idbScalarRead-golden.test.ts` | `:56-59` | insert の golden 固定。`toEqual({ success: true, id: 1 })` と `id: 2` |
| 同上 | `:89-92` | insertAuditLog の golden 固定。`id: 1` と `id: 2` |
| `src/offscreen/__tests__/schema-comprehensive.test.ts` | `:116-131` | `INSERT_SQL` の 3 制約（placeholder 数 / 全カラムを含む / `OR IGNORE` を含まない） |
| 同上 | `:133-143` | `INSERT_IGNORE_SQL` の 2 制約 |
| `src/offscreen/__tests__/opfsWorker-transactionIntegrity.test.ts` | `:44-49` | `queryMock` が既に `sql.includes('RETURNING')` を分岐し `[{ id: 1 }]` を返す |
| 同上 | `:107` | `expect(result.result).toEqual({ count: 1, inserted: 1, skipped: 0 })` ― **完全一致の赤化候補** |
| `src/offscreen/__tests__/search-sort-parametric.test.ts` | `:29-32` | Idb の `execWithCache` スタブ。`/SELECT COUNT\|SELECT changes\|last_insert_rowid/i` に一致したときだけ `callback([0])` |
| `src/offscreen/__tests__/query-backends-parametric.test.ts` | `:34` | 同じ正規表現のスタブ |
| `src/background/pipeline/__tests__/saveSqliteStep.test.ts` | `:91-114` | `obsidian_synced` 更新の固定（`id: 1` 固定） |

### 最小変更の選択肢

1. **`INSERT_SQL` を `INSERT ... RETURNING id` へ差し替え、`SELECT last_insert_rowid()` を撤回して返却 id にする**
   - 変更量: `schema.ts` に `INSERT_RETURNING_SQL`（`INSERT_SQL` に `RETURNING id` を足したもの）を 1 定数追加し、`IdbVfsBackend.ts:100-102` を「コールバック付きの 1 回 exec」に書き換える。`insertAuditLog` 側（`:304-309`）も同様に `AUDIT_INSERT_RETURNING_SQL` で揃える。
   - 利点: **窓そのものが消える**（2 回の await が 1 回になる）。トランザクションの開始と終了が入らないので他クエリへの影響もない。`wrapDb` が `query` も `db.run()` に写す（`sqliteBoot.ts:84-86`）ため既存の経路でそのまま番号を取れる。`schema.ts:147-153` のコメントが既に RETURNING の正しさを論証している。`idbScalarRead-golden.test.ts:56-59` の番号 1 と 2 の固定が**期待値無変更で通る**。
   - 難点: `RETURNING` は SQLite 3.35 以上が要る。`schema.ts:152` のコメントによれば同梱 wasm は 3.53.2 なので要件は満たすが、**テスト側の better-sqlite3 と実機の IDB エンジンで RETURNING が同じ形で返るかは下記のブロッカーで確認する**。
   - **推奨: 選択肢 1。** 他の二つ（特に選択肢 3 の「今は使われていないから」で片付ける方針）を上回る。

2. **INSERT と SELECT を `withTransaction` で包む（`insertBatch` と同じ形）**
   - 変更量: `IdbVfsBackend.ts:96-103` の本体を `withTransaction(this.transaction, …)` で包む。`:62-64` の `transaction` ゲッターが既に用意されている。
   - 利点: 実装パターンが既存の `insertBatch`（`:111-119`）と一致するので、レビュー時に「この関数は同じ形になった」と確認できる。
   - 難点: **1 回の記録保存ごとに BEGIN と COMMIT が 1 往復増える**（単発の insert のたびに）。wa-sqlite の `BEGIN IMMEDIATE` はロックを取得するため、**他の読み書きとの競合で `SQLITE_BUSY` が増える可能性がある**。窓が消える点は選択肢 1 と同じで、副作用だけが大きい。

3. **`insertAuditLog` にも同じ組があるので併せて対応する**
   - 変更量: `:302-310` を選択肢 1 と同じ形に揃える（`AUDIT_INSERT_RETURNING_SQL` を `queryPlan.ts:668` 付近に追加）。
   - 現状の事実: 返された番号は**どこからも使われていない**（`auditLogGateway.ts:43-53` は参照しない。wire の `decodeGateway` だけが整形している）。
   - **推奨: 選択肢 1 の範囲に含めて併せて対応する。** 番号が未使用である理由が「現状では壊れる経路が無い」なら、**どこかで使われるようになった瞬間に同じ誤り方が復活する**。「今は使われていない」は「直す必要がない」の根拠にならないため、受け入れ基準にも明記した。

4. **（非推奨）OPFS 側の `handleInsert`（`crudHandlers.ts:22-28`）も同時に書き換える**
   - `opfsWorker.ts:386-392` の直列化キューが既に同じ保証を与えているため実害はない。書き換えは差分を膨らませ、本 PBI の主題（IDB ラング）から目を逸らす。**本 PBI では触らない**（キューが守っている旨のコメントだけ残す）。

**総合推奨: 選択肢 1 と選択肢 3 を併せて適用（`insert` と `insertAuditLog` の両方を `RETURNING id` へ）。** 変更は `schema.ts`（定数追加）、`queryPlan.ts`（定数追加）、`IdbVfsBackend.ts`（2 関数の内部）、テスト 1〜2 ファイルに閉じる。

### 既存テストが赤くなる可能性（先出し）

- **`src/offscreen/__tests__/opfsWorker-transactionIntegrity.test.ts:107`** ― `expect(result.result).toEqual({ count: 1, inserted: 1, skipped: 0 })` は**完全一致**。`:44-49` の `queryMock` は既に `RETURNING` を分岐して `[{ id: 1 }]` を返すので `insertBatch`（`:113` の `INSERT_IGNORE_RETURNING_SQL`）は現状も緑。`insert` 側を RETURNING にしてもこのテストは `insertBatch` だけを実行している想定で、**基本は緑のはず**。赤になったら「`insert` も同じモックを通るようになった」ことによる想定外の失敗である可能性が高いので、**期待値を書き換えて通すのではなく、モック側の不足を特定する**。
- **`src/offscreen/__tests__/schema-comprehensive.test.ts:116-131`** ― `INSERT_SQL` 自体の 3 制約。選択肢 1 は `INSERT_SQL` を**書き換えず** `INSERT_RETURNING_SQL` を**追加**するなら、この 3 制約は緑のまま。**`INSERT_SQL` 自体に `RETURNING` を足す実装を選ぶと**、`crudHandlers.ts:24` や `rowCodec.test.ts:170` が参照する `INSERT_SQL` の意味が変わるため、`INSERT_SQL` は触らず新定数を追加する形を推奨する。
- **`src/offscreen/__tests__/idbScalarRead-golden.test.ts:56-59` / `:89-92`** ― `toEqual({ success: true, id: 1 })` と `id: 2`。RETURNING へ寄せても**同じ番号が返るため緑のまま**が正しい。ただしこのテストの `makeBackend`（`:30-49`）は `execWithCache` を better-sqlite3 に直接繋いでおり、`:40` は `/^\s*SELECT/i` で分岐している。`INSERT ... RETURNING` は `SELECT` で始まらないため `:44` の `db.prepare(sql).run(…)` に落ち、**コールバックが発火せず id が 0 になる**。つまりこのスタブは「RETURNING を読む」能力を持っていない。**実装前にこのスタブを RETURNING 対応に直すか、テストの分岐条件（`RETURNING` や `PRAGMA` など `SELECT` 以外の読み出し経路）にも広げる必要がある**。ここを直さないと「RETURNING に直したのに golden が赤くなる」という混乱が起きる。
- **`src/offscreen/__tests__/search-sort-parametric.test.ts:31` / `query-backends-parametric.test.ts:34`** ― Idb の `execWithCache` スタブが `/SELECT COUNT|SELECT changes|last_insert_rowid/i` に一致したときだけ `callback([0])` を呼ぶ。この正規表現は `INSERT ... RETURNING id` に一致しない。ただし現状この 2 ファイルで `insert()` を呼んでいるのは `FallbackStorage`（`search-sort-parametric.test.ts:61-63`）だけで、IdbVfsBackend の `insert()` は通っていないため**現状は緑のまま**。ただし **「RETURNING で id を取るスタブ」を書くとコールバックが発火せず id が黙って 0 になる**型の見えない罠なので、正規表現に `/RETURNING/i` を含めておくのが安全。
- **`src/background/pipeline/__tests__/saveSqliteStep.test.ts:91-114`** ― `id: 1` 固定のモック。本 PBI の変更で `saveSqliteStep.ts` 自体は触らない（呼び出し規約が変わらない）ので緑のままのはず。

### 着手前に潰すべき owner 確認（ブロッカー）

**本 PBI の最大リスクは実装ではなく、事実未確定である。** 着手前に owner が次の 1 点を確定させること:

> **実機の wa-sqlite engine（およびテスト側の better-sqlite3）で、2 つの `insert()` 呼び出しが `INSERT` と `SELECT last_insert_rowid()` の間で実際に交錯しうるか？ すなわち `execWithCache` の並行 await はエンジンの接続上で交錯するのか？**

- 現状把握: `last_insert_rowid()` は**接続スコープ**の値であり、ソースからは「並行した JS 実行の下でエンジンの接続が交錯するか」を確定できない。監査 blockers も同点を挙げている。`wrapDb`（`sqliteBoot.ts:74-103`）は `db.run()` に素通ししているが、`run()` の内側で wasm の呼び出しがどう直列化されるかは本 run の外にある。
- 解消手段（監査の validation plan 準拠）: `sqliteBackendParity.realEngine.test.ts` の fixture を使い、`insert()` の 2 つの promise を同時に開始して各返却 id を照合するテストを `--repeats=20` で回す。交錯が観測できれば本件は実在の欠陥として確定し、そのまま選択肢 1 の実装に進む。
- **交錯が観測できなかった場合の方針**: 「再現できなかった」を「無害」の根拠にしない。`insert` と `SELECT last_insert_rowid()` の間にトランザクションも RETURNING もなく、その窓は**構文的に存在する**。このため **選択肢 1（`INSERT ... RETURNING id`）は、交錯の実測の如何にかかわらず採用する**（窓を構造的に消すことが目的であり、交錯の有無と修正の要否は独立している）。`RETURNING` が実機で 1 行を返すことの確認だけを、実装の合間に実エンジンテストで確かめる。
- **なお、OPFS ラングは `opfsWorker.ts:386-392` の直列化キューが同じ窓を塞いでいる**ため、観測は IDB ラングについてのみ行う。

### ロールバック手順

- 変更は `schema.ts`（定数追加）、`queryPlan.ts`（定数追加）、`IdbVfsBackend.ts`（2 関数の内部）、テスト 1〜2 ファイルに閉じる。`git revert` で戻せる。
- **ストレージスキーマの変更は無い。** `browsing_logs` と `audit_log` の定義も migration も変えない（`schema.ts` は定数の追加のみなので `migrations-comprehensive.test.ts` にも影響しない）。revert 後も保存済みデータは壊れない。
- ロールバック時に確認すること: **印が付かなかった行が再送対象に戻る**（「未マークの行が残る」方向の失敗が、revert 戻しで実際に起きる）。そのためロールバック後は、旧来の誤ったマークが残っている環境で日次 Mirroring の対象選定が 1 周期ずれる可能性があるので、`obsidian_synced` の値を owner が目視確認する手順をロールバック手順に含める。

## 見積もり

2 SP（単位: ストーリーポイント）

内訳の目安: `INSERT_RETURNING_SQL` と `AUDIT_INSERT_RETURNING_SQL` の定数追加 = 0.2 / `IdbVfsBackend.insert` の差し替え = 0.3 / `insertAuditLog` の同時対応 = 0.3 / 実エンジン fixture による並行 insert テスト = 0.6 / `saveSqliteStep` の後続 update に対する統合テスト = 0.3 / 既存テストのスタブ対応（`idbScalarRead-golden.test.ts:30-49` の分岐条件、`search-sort-parametric.test.ts:31` と `query-backends-parametric.test.ts:34` の正規表現）= 0.3。

※ owner 確認（実エンジンでの交錯観測）の待ち時間は**工数に含めない**。実装（選択肢 1）は交錯の実測と独立に進められるため、確認待ちで実装が止まらない。

## Definition of Done

- [ ] BDDシナリオ（3 本）が自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint `IdbVfsBackend.insert:last-insert-rowid-interleave` を完了記録に残す
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現。実機での interleave 観測は範囲外）
- 決め手: mock `execWithCache` を手動 interleave（A: insert 完了 → B: insert 完了 → A: `last_insert_rowid` 読み取り）すると、**A が `{success:true, id:2}` を受領**する（自分の行は id 1）。構造 pin として、insert 経路の execWithCache は 2 回 `[INSERT_SQL, 'SELECT last_insert_rowid()']` を呼び、`BEGIN`/`COMMIT`/`IMMEDIATE` を含まず（トランザクション無し）、`INSERT_SQL` は RETURNING を含まない。`sqliteBackendParity.realEngine.test.ts` は better-sqlite3 経路で wasm build 不要のため実行でき、19 件 GREEN
- 影響: 修正選択肢 1（既存の `INSERT_IGNORE_RETURNING_SQL` へ差し替え）が最小。OPFS ラングはリクエスト直列化キューで守られるため対象外

## 関連

- `pbi/00-INDEX.md`
- `src/offscreen/IdbVfsBackend.ts`（本 PBI の本体）/ `src/offscreen/schema.ts`（INSERT 定数の SSOT）/ `src/offscreen/opfsWorker.ts`（OPFS ラングの直列化キュー。IDB ラングに無いもの）
- `src/background/pipeline/steps/saveSqliteStep.ts`（返却 id を使う sink）
- `src/offscreen/__tests__/sqliteBackendParity.realEngine.test.ts`（実エンジン fixture の参照先）/ `dev-docs/TEST_RULE.md`（テスト追加前に必読。`--repeats` の扱いを含む）
- `dev-docs/ARCHITECTURE_MAP.md`（IDB ラングと OPFS ラングの位置づけ）