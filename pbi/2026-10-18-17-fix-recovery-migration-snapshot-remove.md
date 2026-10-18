# PBI: OPFS 復旧移行の fail-open な status ゲートを閉じ、snapshot 後に書かれた fallback 行を消さないようにする

## ユーザーストーリー

yasumaro を OPFS が使えない環境（プライベートモード、拡張機能の権限が制限されたブラウザなど）で使い続けているユーザーとして、起動時の OPFS 復旧移行が「SQLite の状態は分からない」というだけの理由で走っても、履歴が失われないようにしてほしい、なぜなら fallback ストアは拡張機能側が保持する唯一のコピーで、移行が成功を返したとしても実際に1件も SQLite へ着地していないままストア全体を消すと、そのユーザーの閲覧履歴は二度と復元できないまま消えるから（ユーザー側のバックアップにも問い合わせログにも痕跡が残らない）。

さらに、移行の snapshot 読み込みより後・最終 remove より前にブラウザ側の通常記録が 1 件でも fallback ストアへ書かれた場合、その行は「移行対象。入っていないはず」とみなされて永久に消える。移行が「自分に触っている最中のストア」を壊している問題は、この移行が持つ最後の破壊的経路であり、ほかの移行 PBI が守っている「count を照合してから安全網を捨てる」方針から外れている。

## 優先度

- 順位: 17 / 25
- RICE: 600（Reach=100 / Impact=1 / Confidence=50% / Effort=0.2）
- 根拠: 監査17位で、移行 destructive パスの最後の一本。`needsMigration` のゲートが `statusResult.fallback === true` だけを見ており、`SQLITE_STATUS` が FAILED を返す（`{initialized:false, fallback:false}`）と fail-open で通過する（`initialized` シグナルは読まれない）。`migrate` はキーを1回だけ snapshot して（ロック・マーカー・再読差分なし）、最後にキー全体と `OPFS_FALLBACK_MODE` を無条件に remove する。snapshot 後に fallback へ書き込まれた行は永久に消える。さらにエンジンがまだ fallback モードだと、各バッチが `FallbackStorageAdapter` へ集まり、`url\0created_at` の dedupe で移行自身のバッチが `count:0` の黙った no-op になり、SQLite に0件のまま「成功」を報告してからストア全体を削除する。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中
- 副作用: 🔴あり（移行の成否判定が変わるため、再試行の経路も変わる）

### 副作用が🔴である理由

1. **fail-closed 化は「移行をやめる」方向への変更**である。現状は「status が壊れていても移行を試みる」ことで、移行は（虚偽の）成功を返しうる。修正後は status が不明なら**移行しない**ので、回復途中の環境では fallback 行が Chrome storage に残り続ける。ストレージ使用量が増加し、続くと `chrome.storage.local` のクォータ（10MB）に到達して通常記録の書き込み自体が壊れる（→ PBI 13 のクォータ sweep の領分）。
2. **「消せる行だけを消す」方式へ変えると、重複行が残る**。`INSERT OR IGNORE` で既に SQLite にある行は `skipped` になるが、fallback 側のストアからは消える前提になる。将来 fallback レーンへ退行（OPFS 障害の再現）したとき、SQLite に同内容が存在する行が fallback に二重で残る可能性がある。これは idempotent なので致命的ではないが、PBI 09 と同じ「孤児残置」の論点を再検討が必要になる。
3. **再実行ループの恐れ**。マーカーを残して移行を再試行する設計にすると、失敗が恒久的（エンジンが本当に fallback のまま）な場合、サービスワーカー起動ごとに再試行が積み重なる。ガードを入れないと起動時の遅延が伸び、入れすぎると無意味な再試行になる。**「何が恒久的な失敗で何が 一時的な失敗か」を決める判断が本 PBI の実質的な作業**であり、これを実装中に後回しにしないこと。
4. **既存テストが現行挙動を固定している**。`src/background/__tests__/migrationService-opfs.test.ts:138-155` は `mutate` が `count: 2` を返した瞬間に両キーを消すことを前提にしており、`:244-264` は remove の順序そのものを pin している。判定基準を変えると複数 pin の期待値変更が必須。

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `opfsRecovery.migrate:snapshot-remove-window-fail-open-status-gate`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（NEEDS-VALIDATION.md 17番 / `findings.json` の `needs_validation`）。

claimed root cause: `needsMigration` は `statusResult.fallback === true` だけを信頼し、失敗した `SQLITE_STATUS` 呼び出しは `fallback:false` と `initialized:false` を返す。そのうえで `migrate()` は snapshot 読み込みと全キー remove の間に協調（ロック・マーカー・再読差分）を一切持たず、セッション途中の degrade によってバッチループ中に同じキーへのライブ fallback 書き込みが再開されうる。

verdict: `needs_validation`（Confidence 50% は、この前提状態が実行環境で実際に成立するかが未観測であることに由来する。実装は可能だが、観測なしに「起きている」と断定してはいけない）。

### Trace（現在 HEAD `56f1d7c1` で実ファイル確認済み）

- [entrypoint] `src/background/deferredMigrations.ts:62`（background service worker）— サービスワーカー起動ごとの一度限りの deferred ランナーが、最初のメッセージハンドラ発火時に `needsOpfsRecoveryMigration()` を呼ぶ。`:65` で `migrateOpfsRecovery()` を起動。ランナーは `:50` の `let ran = false` と `:53` の `if (ran) return;` で同一 SW ライフタイム中は1回だけ。`:53-54` は `await` の**前**に `ran = true` を立てるため、失敗しても同じ SW 内では再試行されない。
- [propagation] `src/background/sqlite/offscreenGateway.ts:209`（status gate input）— `getStatus()` は `SQLITE_STATUS` が失敗すると、モード不明を返す代わりに `{ initialized: false, path: '', fallback: false, fts5: false, initError: ... }` を返す。ゲートが消費する fail-open 側の既定値。
- [propagation] `src/background/migration/opfsRecovery.ts:94`（migration gate）— `if (!statusResult || statusResult.fallback === true) { return false; }`。`fallback` フラグしか見ておらず、失敗した status は素通りする。`initialized: false` は一度も読まれない。なお `initialized` は `src/messaging/sqliteMessages.ts:167` で `boolean`（任意ではない）として型付けされているので、fail-closed 判定に使える。
- [propagation] `src/background/migration/opfsRecovery.ts:122`（snapshot）— `migrate()` は `FALLBACK_STORAGE_DATA` を1回だけ読む。この後を実行している残り時間の間、そのキーを保護するロック・マーカー・再読差分のいずれも存在しない。
- [propagation] `src/offscreen/sqliteEngineHost.ts:404`（並行ライター）— セッション途中の OPFS degrade（`:373` の呼び出し → `#enterFallbackStorage`）が新しい `FallbackStorage` を作り、同じキーへのライブ書き込みを再開する。`:410` で `usingFallbackStorage = true` を立て、`init()` の早期 return（`:184`）と再初期化パスの早期 return（`:438`）により、このコンテキストは fallback から登り直さない。
- [propagation] `src/background/migration/opfsRecovery.ts:137`（バッチ経路）— 各バッチは `sqliteClient.mutate({ type: 'insertBatch', records: batch })` で offscreen の**その時点の**バックエンドに送られる。エンジンが fallback なら `FallbackStorageAdapter.insertBatch`（`src/offscreen/FallbackStorageAdapter.ts:15-19`）に到達し、`{ success: true, inserted: 0, skipped: N }` を返す。
- [propagation] `src/messaging/sqliteWireTable.ts:186`（結果正規化）— `count: (response.inserted as number | undefined) ?? (response.count as number)` により wire 上の `inserted` が `count` に読み替えられる。`:187` で `skipped` も正規化されるが、`opfsRecovery.ts:141` は `normalized.data.count` しか加算せず、`skipped` を読み飛ばす。
- [sink] `src/background/migration/opfsRecovery.ts:159`（破壊）— `chrome.storage.local.remove(FALLBACK_STORAGE_KEY)` が snapshot 後に書かれたすべての行（循環ケースでは SQLite に1件も到達していない全行）を消す。`:160` が `OPFS_FALLBACK_MODE` を落とし、以後の移行による回復の可能性も消す。

### Evidence

- `src/background/sqlite/offscreenGateway.ts:209` — 失敗した status は `fallback:false` と `initialized:false` を返す。ゲートが消費する fail-open 方向。
- `src/background/migration/opfsRecovery.ts:94` — ゲートは `fallback` フラグしか読まず、`initialized` は読まない。
- `src/background/migration/opfsRecovery.ts:159` — 無条件の全キー remove（snapshot 読み込みは `:122`）。マーカーの remove は `:160`。
- `src/offscreen/storageFallback.ts:138` — `const existingKeys = new Set(data.records.map(r => \`${r.url}\0${r.created_at}\`))`。`:143` で既存・バッチ内重複を弾き、`:149` で `return { success: true, count: 0 }` を返す（＝黙った no-op）。
- `src/offscreen/sqliteEngineHost.ts:404` — `#enterFallbackStorage` はコンテキスト間の協調なしにライブ fallback 書き込みを再開する。`:184` が、このコンテキストが fallback モードを離れないことを示す。

### 補遺: 件数一致だけで守れない理由（実装時に必ず踏む）

「`migrated` が `records.length` に一致したときだけ消す」という単純なガードは**成立しません**。正常系の `insertBatch` は `INSERT OR IGNORE ... RETURNING`（`src/offscreen/schema.ts:154`、`src/offscreen/opfsWorker/crudHandlers.ts:109-117`）を使い、既に SQLite にある行は `inserted` ではなく `skipped` として数えられます。したがって PBI 09 が描く「部分失敗後に次回起動で再試行」シナリオでは、2回目の起動時に `totalMigrated < records.length` が**正常**に起こります。件数一致で失敗扱いすると、そこが永久の再実行ループになります。

`inserted + skipped === records.length` による検証も無効です。fallback アダプタは `FallbackStorageAdapter.ts:17` で `skipped: records.length - result.count` を機械的に返すため、循環 no-op（`inserted: 0, skipped: N`）でも合計は `records.length` になりません。しかも同じ `skipped` が、SQLite 側では「既に DB にある（＝捨ててよい）」を、fallback 側では「これから消すストアにある（＝捨ててはいけない）」を意味しており、意味が反転します。

**結論: 循環 no-op を検出できるのは「その時点でバックエンドが本当に SQLite か」という問いだけ**です。よって fail-closed な status ゲートが本修正の中心であり、後述の実装メモで示す「remove 直前の status 再確認」が必要になります。

### 対照: ハードニング済みの兄弟

`src/offscreen/sqliteEngineContext/migrationBackup.ts` は同じ「移行したあと元データを捨てる」型として、捨てる前に必ず SQLite 側の実数を測っています（`:355` expectedCount、`:368` `SELECT COUNT(*)` による実測、`:370` `if (actualCount >= expectedCount && expectedCount > 0)` を満たしたときだけバックアップを削除）。PBI 09（`fallbackMigration.tryMigrateFallbackToSqlite` の部分失敗）と PBI 13 もこの方向に進んでいる。本 PBI はその方針を **background 側の OPFS 復旧移行**に持ち込むものです。

## BDD受け入れシナリオ

1. **Scenario: SQLITE_STATUS が失敗しても fallback ストアは削除されず、次の移行機会に残る（fail-open 入力の固定）**
   - **Given** `opfs_fallback_mode` が `true` で、`FALLBACK_STORAGE_DATA` に 1 件のレコードがある状態で、`SQLITE_STATUS` の transport が失敗する（timeout ＋ 自動リトライ枯渇）gateway
   - **When** `needsMigration()` が評価される
   - **Then** モードが不明であることを理由に `false` を返すこと（`{ initialized: false, fallback: false }` で fail-open しない）
   - **And** `migrate()` が呼ばれても（呼び出し側がゲートを迂回しても）、関数冒頭で status を再確認し、**何も削除せず**中断すること
   - **And** `opfs_fallback_mode` と `FALLBACK_STORAGE_DATA` の両方がそのまま残ること

2. **Scenario: 移行が実際に SQLite へ着地した行だけを確認し、その行だけを fallback ストアから消す（snapshot-remove ウィンドウの封鎖）**
   - **Given** `opfs_fallback_mode` が `true`、`FALLBACK_STORAGE_DATA` に 2 件あり、status は `{ initialized: true, fallback: false }` で健全
   - **When** `migrate()` が `:122` で snapshot として 2 件を読んだ後、バッチループ中に（通常の記録経路が）`FALLBACK_STORAGE_DATA` へ 3 件目を書き込む
   - **Then** snapshot の 2 件が SQLite に着地したこと
   - **And** 最終削除の前に `FALLBACK_STORAGE_DATA` を**再読**し、snapshot に含まれる行だけを間引くこと
   - **And** ループ中に追加された 3 件目が `FALLBACK_STORAGE_DATA` に**残る**こと
   - **And** `opfs_fallback_mode` も残ること（完全移行ではないため、マーカーを落とさない）

3. **Scenario: エンジンがまだ fallback モードのとき、移行は保留してCircular no-op を作らない**
   - **Given** `opfs_fallback_mode` が `true`、`FALLBACK_STORAGE_DATA` に 2 件あり、status は `{ initialized: true, fallback: true }`（＝`FallbackStorageAdapter.getStatus()` が返す形状）
   - **When** `migrate()` が走る
   - **Then** `insertBatch` を1回も発行しないこと（`FallbackStorageAdapter.ts:15-19` へCircular しない）
   - **And** `success: false` 相当の中断を返し、`FALLBACK_STORAGE_DATA` 2 件とも無傷であること
   - **And** `opfs_fallback_mode` が残るため、次のサービスワーカー起動で再試行できる状態になること

4. **Scenario: 部分失敗時は残りを残す（PBI 09 との整合ガード）**
   - **Given** snapshot した 2 件のうち、バッチ 2（=2 件目）が失敗して `success: false` を返す
   - **When** `migrate()` が終了する
   - **Then** `FALLBACK_STORAGE_DATA` の 2 件がそのまま残ること（現状どおり）
   - **And** `opfs_fallback_mode` が残ること
   - **And** 次回起動で再試行されたとき、既に SQLite にある行は `skipped` になるだけで**失敗扱いにならない**こと（件数一致で判定していないことの回帰ガード）

5. **Scenario: 全件が正常に着地した場合は従来どおりキーとマーカーを消す（正常系の回帰ガード）**
   - **Given** 2 件がすべて SQLite に着地し、追加書き込みも無かった
   - **When** `migrate()` が終了する
   - **Then** `FALLBACK_STORAGE_DATA` と `opfs_fallback_mode` の両方が削除されること
   - **And** 削除順序が「データ → フラグ」の順であること（既存 pin `migrationService-opfs.test.ts:244-264` を壊さない）
   - **And** `success: true` と正しい `migrated` 件数が返ること

6. **Scenario: バッチループの途中でエンジンが degrade したら、中断して安全網を捨てる前に止まる**
   - **Given** 冒頭の status は健全だが、`insertBatch` の 2 バッチ目の途中で offscreen が `#enterFallbackStorage()`（`sqliteEngineHost.ts:404`）を実行する
   - **When** remove へ到達しようとする
   - **And** 最終削除直前の status 再確認が `{ fallback: true }` を返す
   - **Then** remove を実行せず中断すること
   - **And** fallback ストアとマーカーが両方残ること

## 受け入れ基準

- [ ] `opfsRecovery.ts` の status ゲートが fail-closed になっている。`fallback === true` に加えて `initialized !== true` を拒否条件にし、不確実（`getStatus()` が `null` を返す／transport 失敗による `{initialized:false, fallback:false}`）を「移行不可」に分類する
- [ ] `migrate()` が関数冒頭で status を再確認し、fallback モード・未初期化・status 取得失敗のいずれでも `insertBatch` を1回も発行せずに中断し、削除を一切行わない
- [ ] 最終削除の直前に `FALLBACK_STORAGE_DATA` を再読し、snapshot に含まれる行だけを間引いてからキーを削除する。snapshot に無かった行（移行中に書かれた行）は必ず残る
- [ ] 全件着地していない場合（部分失敗・追加行あり）は `OPFS_FALLBACK_MODE` を削除せず、次のサービスワーカー起動で再試行できる状態を維持する
- [ ] 成否判定は「件数一致」ではない。正規 SQLite の `skipped`（既に DB にある行）を失敗扱いせず、判定の根拠はバックエンド同一性（status）に基づく
- [ ] 「エンジンがまだ fallback なのに移行を走らせない」ガードが、**ゲート（`needsMigration`）と `migrate` 内の二か所**の双方に存在する（片方だけだとループ途中で degrade した隙間を捕捉できない）
- [ ] 恒久的な失敗（エンジンが本当に fallback のまま）で、サービスワーカー起動ごとの再試行が連鎖しない上限が明示されている（現状は `deferredMigrations.ts:50-54` の1回限りランナーが唯一の限界で、SW 間には上限がない）
- [ ] 上記シナリオ 1〜6 を単体テストで pin し、既存テスト `src/background/__tests__/migrationService-opfs.test.ts` と `src/background/__tests__/deferredMigrations.test.ts` の期待値を新方針に合わせて更新する

## テスト戦略

- 単体:
  - `mock chrome.storage.local` で `SQLITE_STATUS` を reject／失敗応答にして、`needsMigration()` の fail-closed を pin する。**注意**: 既存テスト `migrationService-opfs.test.ts:128-134`（`getStatus.mockRejectedValue`）は `opfsRecovery.ts:108-111` の **catch** をカバーしているだけで、本 PBI の fail-open 経路（`getStatus` が reject ではなく `{initialized:false, fallback:false}` を**返す**）は未 pin である。実 gateway（`offscreenGateway.ts:206-210`）は throw せず値返すので、mock も throw ではなく値を返す形にすること
  - `migrate()` が `migrated: 0` で fallback 行が消えることを pin する（現状の壊れた挙動の固定）。snapshot 後に1件書き込んでから remove を走らせ、その行が消えることを pin
  - `mutate` の `mockImplementation` の中で `storageMock['FALLBACK_STORAGE_DATA']` にレコードを追記すれば、バッチループ中の追加書き込みを実時間待ちなしで再現できる（`migrationService-opfs.test.ts:206-212` の書式で十分）
  - 「全件着地したのに再読差分が空なら削除する」正常系と、「差分に残る行があれば削除しない」異常系の両方向を pin する
- 統合:
  - `deferredMigrations` の1回限りランナー（`src/background/__tests__/deferredMigrations.test.ts`、全182行）。現状は `vi.mock('../migrationService.js')`（`:50-59`）でサービス全体をモックしているため、OPFS 復旧経路の実挙動は見えていない。fail-closed 化により「status が不明なら `migrateOpfsRecovery` が呼ばれない」ことを、この層で1つ pin すると多層防御として価値がある
  - `migrationService` の委譲（`src/background/migrationService.ts:79-81` と `:84-86`）は薄いので、追加テストは不要
- E2E:
  - owner 観測（OPFS 無効の Firefox プライベートモードで fallback 行を溜め、移行中の status 失敗を発生させて、移行前後の fallback 行数と SQLite 行数を比較する）
  - 既存 `testDir/e2e/firefox-opfs-probe.spec.ts` は OPFS 可用性のプローブなので、この観測の土台にできる可能性はある（要確認）

## 実装メモ（実装者向け）

### 対象ファイルと該当行（現在 HEAD `56f1d7c1` で実ファイル確認済み）

| ファイル | 行 | 内容 |
|---|---|---|
| `src/background/migration/opfsRecovery.ts` | `:19` | `BATCH_SIZE = 100` |
| 同上 | `:82` | `async needsMigration()` |
| 同上 | `:85-86` | `chrome.storage.local.get(StorageKeys.OPFS_FALLBACK_MODE)` → `isFallbackMode` |
| 同上 | **`:94`** | **fail-open ゲート。`if (!statusResult \|\| statusResult.fallback === true) { return false; }`。`initialized` を読まない** |
| 同上 | `:100-105` | フォールバックデータの存在確認（`records.length === 0` で早期 return） |
| 同上 | `:108-111` | catch → `return false`（安全側） |
| 同上 | `:117` | `async migrate()` 関数頭。ここで2回目の status 確認を入れる |
| 同上 | **`:122`** | **snapshot: `chrome.storage.local.get(FALLBACK_STORAGE_KEY)`** |
| 同上 | `:133-134` | バッチループ（`BATCH_SIZE` 刻み） |
| 同上 | `:137` | `sqliteClient.mutate({ type: 'insertBatch', records: batch })` |
| 同上 | `:140-141` | `if (normalized.success) { totalMigrated += normalized.data.count; }` ← `skipped` を読み飛ばしている |
| 同上 | **`:159`** | **`chrome.storage.local.remove(FALLBACK_STORAGE_KEY)`（破壊の sink）** |
| 同上 | `:160` | `chrome.storage.local.remove(StorageKeys.OPFS_FALLBACK_MODE)` |
| `src/background/sqlite/offscreenGateway.ts` | `:197`, `:202` | `status()` → `callInternal('SQLITE_STATUS', ...)` |
| 同上 | `:206` | `async getStatus(): ... \| null` |
| 同上 | **`:209`** | **失敗時 `{ initialized: false, path: '', fallback: false, fts5: false, initError: ... }` を返す** |
| `src/background/deferredMigrations.ts` | `:49` | `createDeferredMigrationRunner` |
| 同上 | `:50`, `:53-54` | `let ran = false` / `if (ran) return; ran = true;` ← 1回限り（`await` の前にフラグを立てる） |
| 同上 | `:62`, `:65` | `needsOpfsRecoveryMigration()` → `migrateOpfsRecovery()` |
| `src/background/migrationService.ts` | `:79-81`, `:84-86` | `OpfsRecoveryService` への薄い委譲 |
| `src/offscreen/sqliteEngineHost.ts` | `:179` | `async init()` |
| 同上 | **`:184`** | **`if (this.#state.usingFallbackStorage) return false;` ← 一度 fallback に入ると登り直さない** |
| 同上 | `:373` | `#enterFallbackStorage()` の呼び出し |
| 同上 | **`:404`** | **`async #enterFallbackStorage()` ← ライブ fallback 書き込みを再開する並行ライター** |
| 同上 | `:438` | 再初期化パスの同名早期 return |
| `src/offscreen/storageFallback.ts` | `:131` | `async insertBatch(...)` |
| 同上 | **`:138`** | **`existingKeys`（`url\0created_at` の dedupe 集合）** |
| 同上 | `:143` | `if (existingKeys.has(key) \|\| seen.has(key)) continue;` |
| 同上 | **`:149`** | **`return { success: true, count: 0 };` ← 黙った no-op** |
| `src/offscreen/FallbackStorageAdapter.ts` | `:15-19` | `insertBatch` → `{ success: true, inserted: result.count, skipped: records.length - result.count }` |
| 同上 | `:86` | `getStatus()` → `{ initialized: true, path: 'chrome.storage.local', fallback: true, ... }` |
| `src/messaging/sqliteWireTable.ts` | `:186` | `count: (response.inserted as number \| undefined) ?? (response.count as number)` |
| 同上 | `:187` | `skipped: (response.skipped as number \| undefined) ?? 0` |
| `src/messaging/sqliteMessages.ts` | `:167` | `initialized: boolean`（任意フィールドではない。fail-closed 判定に使える） |
| `src/offscreen/schema.ts` | `:144`, `:154` | `INSERT_IGNORE_SQL` / `INSERT_IGNORE_RETURNING_SQL` |
| `src/offscreen/opfsWorker/crudHandlers.ts` | `:109-117` | `RETURNING` による正確な `inserted` / `skipped` 計数 |

### 既存テスト（書式と pin の追加位置）

- **`src/background/__tests__/migrationService-opfs.test.ts`（全287行）— 主な追加先**
  - `:12-36` の `vi.stubGlobal('chrome', ...)` がファイル内で `storageMock` プレーンオブジェクトを実装している（`get`/`set`/`remove`）。追加 pin はこの書式にそのまま足せる
  - `:83` `describe('needsOpfsRecoveryMigration')` に、**fail-closed** の pin を追加する。既存の `:104-110`（`fallback: true` で false）と `:128-134`（`getStatus` が reject で false）は別経路を既にカバーしている
  - `:137` `describe('migrateOpfsRecovery')` に、**削除前再読＋差分**の pin を追加する。`:206-212` の `mockImplementation` の中で `storageMock` に追記すれば、バッチループ中の追加書き込みを実時間待ちなしで再現できる
  - **要変更の既存 pin**: `:138-155`（`count: 2` → 両キー削除。判定基準が変わると期待値も変更が必要になる）、`:244-264`（remove 順序の pin。データ→フラグの順は維持する）、`:266-285`（remove が例外を投げたとき両方残る pin）
  - `:74` の既定 mock（`{ fallback: false, initialized: true }`）は健全系の既定としてそのまま使える
- **`src/background/__tests__/deferredMigrations.test.ts`（全182行）**
  - `:50-59` で `MigrationService` 全体をモックしているため OPFS 復旧の実挙動は観測されていない。fail-closed 化により「status 不明なら `migrateOpfsRecovery` が呼ばれない」ことを1つ pin する
  - `:121-131` / `:133-144` は現行のログ挙動の pin。判定を変えない限り据え置き
- **`src/offscreen/sqliteEngineContext/__tests__/fallbackMigration.test.ts`**（PBI 09 の領分）は、offscreen 側の別経路。本 PBI の変更対象に含まれない

### 最小変更の選択肢

1. **`needsMigration` ゲートを fail-closed にする**（`opfsRecovery.ts:94`）
   - `if (!statusResult || statusResult.fallback === true || statusResult.initialized !== true) { return false; }`
   - 単独では**不十分**。ゲートは `deferredMigrations.ts:62` で1回だけ評価される点時刻の事実であり、その後に `migrate()` の非同期ループが走る間に offscreen が degrade しうる（`sqliteEngineHost.ts:404`）
2. **`migrate` 内で「実際に着地した行数」を照合してから remove する**（snapshot と remove の間に再読＋差分）
   - snapshot と remove の間に `FALLBACK_STORAGE_DATA` を再読し、snapshot に含まれる行だけを間引く
   - ただし「補遺」のとおり**件数一致による判定は使えない**。使うのは「再読した行のうち snapshot に含まれる行だけを消す」集合演算で、「全部消せたか」は集合として検証できるので判定に使える
   - この方式は新規ロックや新規マーカーを要求しないため、offscreen 側の writer を変更せずに済む点で最小
3. **fallback モード中の再入を検出したら circular no-op をやめ、移行を保留してマーカーを立てずに終了する**
   - `migrate()` 冒頭と、**最終 remove の直前**の2か所で `getStatus()` を取り、`fallback === true` / `initialized !== true` なら `insertBatch` を発行せず（または remove せず）中断し、`OPFS_FALLBACK_MODE` を残す
   - マーカーを「立てずに終了する」のは、既存マーカー（`OPFS_FALLBACK_MODE` = 移行機会がまだあることを示す）そのものを残すという方針であり、`JOB` 相当の新キー（例 `OPFS_RECOVERY_IN_PROGRESS`）を新設しないという方針である。**新規キーは「ストレージキー構造の高リスク変更」に当たり、`manifest.json` および `public/PRIVACY.md` との同期確認も必要になる**ので、既定は既存マーカーの再利用を推す

### 「エンジンがまだ fallback なのに移行を走らせない」ガードをどこに入れるか

**二か所、どちらも必須**:

- **(A) ゲート** — `opfsRecovery.ts:94`（`needsMigration`）。「移行を始める前の判断」。fail-open を塞ぐ第一防衛線。
- **(B) 実行直前と remove 直前** — `opfsRecovery.ts:117`（`migrate` 冒頭）と **`:159` の直前の再確認**。(B) の冒頭でバッチループ中の degrade（`sqliteEngineHost.ts:404`）を早期に検知し、remove 直前の再確認で「最後の瞬間まで無傷だったか」を確定してから捨てる。**remove 直前の確認を省略すると、その直前の数ミリ秒の間に起きた degrade を取り逃す**ので、両方必要。

**(A) だけ**ではループ途中が抜け、**(B) だけ**では初回から無駄なバッチを fallback 側へ流して `storageFallback.ts:149` の circular no-op を生む。両方入れて初めて fail-open・循環 no-op・degrade 途中の隙間の三経路を塞げる。

### ブロッカー（needs_validation: 着手前に潰すべき owner 確認）

本 PBI は verdict が `needs_validation`（Confidence 50%）である。**実装着手前に owner に確認すべき前提**が2点ある。いずれも「実行環境で本当に起きるか」を実環境で観測するもので、コードからは証明できない。

1. **`SQLITE_STATUS` が失敗しうるか（=timeout ＋ transport の自動リトライ枯渇が実際に発生するか）**。これが真なら gate の fail-open は現実の経路に到達するが、偽なら fail-closed 化は「理論上の防御」に留まる。観測方法: OPFS 無効環境で fallback 行を溜めた状態で `chrome.runtime.sendMessage` の SQLITE_STATUS 応答を DevTools から採取し、失敗応答（`success:false`）が実際に返る状況を再現する。監査 blockers も「実行プロファイルでこれが起きるかは runtime fact」と明記している
2. **`chrome.storage.local` の「set 後の remove」の順序**（snapshot 読み込みと最終 remove の間に書かれた行が本当に消えるか）。ブラウザ実挙動の観測が必要。監査 blockers の2番目がこれ。Vitest のモック（`migrationService-opfs.test.ts:12-36` の自前 `storageMock`）ではモック自身が定義した順序をなぞるだけなので、**モックテストだけでは blocker を潰せない**。owner の実ブラウザ観測を1回だけ受け、その結論を BDD シナリオ2の pin に反映させること

上記2点が「NO（起きない）」と判明した場合、修正自体は（防御として）価値が残るが、RICE の Confidence を上げられる。いずれの場合も実装自体は進めてよいが、**監査 fingerprint の完了記録に「blocker の観測結果」を必ず残す**こと。

### ロールバック手順

1. 本 PBI の変更は `src/background/migration/opfsRecovery.ts`（必要に応じ `src/background/deferredMigrations.ts` の再試行上限追加）に閉じており、**offscreen 側（`sqliteEngineHost.ts` / `storageFallback.ts` / `FallbackStorageAdapter.ts`）は変更しない**方針を保つ。これによりロールバックは background 1〜2 ファイルの revert だけで済む
2. revert 手順: `git revert <commit>`（または変更箇所の `git checkout --`）。データの消失はないが、revert すると**修正前に消えていた行が今後また消える**ことに注意（ロールバック自体がデータ破壊の再開に等しい。緊急時は revert ではなく、判定の閾値を緩めて「実在確認できるようにする」方向的トグルを先に検討する）
3. テスト側は `src/background/__tests__/migrationService-opfs.test.ts` と `src/background/__tests__/deferredMigrations.test.ts` の期待値変更も同時に戻す。**片方だけ戻すと pin が壊れる**ので、必ず同じ commit で揃える
4. 本番で移行が失敗し続けて再試行が連鎖した場合は、`opfs_fallback_mode` を手動で外す（`chrome.storage.local.remove('opfs_fallback_mode')`）ことで移行機会を止める。**データは残る**（fail-closed 化後は削除しないため）ので、この一手で復元可能

## 見積もり

[3pt]

🟡中（2pt目安）のベースに対して 1pt 上乗せしている。理由は3点:

- 判定材料が`initialized` 1 フィールドの追加で済むのではなく、**「消せる行」の集合演算（再読＋差分）と、その上の「バックエンド同一性」による成否判定**という2段構えになる
- 副作用🔴の4番目にある通り、**恒久的失敗と transient 失敗の切り分け**（再試行上限の要否）という設計判断が別途必要
- 既存 pin 4 件（`migrationService-opfs.test.ts:138-155` / `:244-264` / `:266-285` と、`deferredMigrations.test.ts` への追加）の期待値変更が別途かかる

ブロッカー観測（owner 確認2点）が実測時間として別枠でかかる点は、見積もりから分離して前提条件として扱うこと。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint (`opfsRecovery.migrate:snapshot-remove-window-fail-open-status-gate`) を完了記録に残す（ブロッカー観測結果も併せて）
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み

## 調査結果（2026-10-18）

- 判定: **PARTIAL**（コード上の 2 経路は局所再現、実環境の前提は owner 確認）
- 決め手: (1) `getStatus` が `{initialized:false, fallback:false}` を値として返すと **`needsMigration()` が true（fail-open 通過）** になり、`migrate()` が `{success:true, migrated:0}` で成功して fallback 行を全滅させる（`FALLBACK_STORAGE_DATA` と `opfs_fallback_mode` の両 remove を観測）。(2) snapshot 後に live 行を 1 件書き込むと、移行完走時に **post-snapshot 行が破壊**される
- 影響: 実装メモの二重ガード（ゲートと remove 直前の再確認）の必要性が再現で裏付けられた。実環境で SQLITE_STATUS の transport 失敗が起きるかは owner 観測が残る

## 関連

- `pbi/00-INDEX.md`
- 同じ移行領域の PBI 09（[fallback 移行の部分失敗](../pbi/2026-10-18-09-fix-fallback-migration-partial-wipe.md)）— offscreen 側。`migrated > 0` だけで `clearAll()` する問題の修正。「count を照合してから安全網を捨てる」方針元。**本 PBI の bg 側と対になる pair**
- 同じ移行領域の PBI 10（[OPFS v2 verify-before-delete](../pbi/2026-10-18-10-fix-opfs-v2-verify-before-delete.md)）— 「削除前に検証する」同じ方針の別実装例
- 同じ移行領域の PBI 13（[fallback クォータ sweep の順序](../pbi/2026-10-18-13-fix-fallback-quota-purge-order.md)）— fallback ストアが枯渇したときの一時しのぎ。**副作用🔴の1で述べた「fail-closed 化により fallback 行が残り続ける」影響は本 PBI と PBI 13 で共有する論点**
- `dev-docs/TEST_RULE.md` — 実時間待ちの禁止（シナリオ2の追加書き込み再現に wait を入れないこと）
- `dev-docs/ARCHITECTURE_MAP.md` — OPFS/SQLite/fallback の構成
- 監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/NEEDS-VALIDATION.md` 17番 / `findings.json`