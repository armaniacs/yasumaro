# PBI: OPFS VFS 実現性スパイク（MV3 offscreen 内）

> 種別: スパイク（技術的不確実性の解消）
> 関連設計: `dev-docs/specs/2026-06-14-sqlite-opfs-persistence-design.md`
> 進め方: **TDD 必須**（スパイクの検証コードも自動テスト化できる範囲はテスト先行）

## ユーザーストーリー

開発チームとして、MV3 offscreen 環境で OPFS ベースの wa-sqlite VFS が動作するかを確証したい、なぜなら本実装（IndexedDB VFS からの差し替え）の方式を確定し、手戻りを防ぎたいからだ。

## ビジネス価値

- OPFS 採用の技術リスクを着手前に潰す。後続 PBI（OPFS 実装）の見積もり精度が上がる
- 測定: 「案A/案B の動作可否」と「採用方式の決定メモ」が成果物として残る

## 背景（現状確認済み）

- 現状の VFS は `IDBBatchAtomicVFS`（IndexedDB ベース、`src/offscreen/sqlite.ts:136`）。OPFS は未使用
- `src/` に `new Worker` の利用は**ゼロ**（offscreen は main thread のみ）
- wa-sqlite v1.0.0 npm 版には既知の互換 shim 問題あり（`registerVFS`→`vfs_register`、`hasAsyncMethod` 欠如。`sqlite.ts:128-143` 参照）

## 検証対象（2案）

- **案A**: offscreen 内 Worker で OPFS **SyncAccessHandle VFS**（同期・高性能・wa-sqlite 推奨）
- **案B**: offscreen 直で OPFS **AccessHandlePool VFS**（Worker 不要・並行性弱い）

## BDD 受け入れシナリオ

```gherkin
Scenario: OPFS 環境が利用可能で案A が動作する
  Given Chrome の offscreen ドキュメントが起動している
  And   navigator.storage.getDirectory() と createSyncAccessHandle が利用できる
  When  offscreen 内 Worker で wa-sqlite を OPFS SyncAccessHandle VFS で初期化し、テーブル作成・INSERT・SELECT・FTS5 検索を実行する
  Then  全操作が成功し、ドキュメント再起動後もデータが永続化されている

Scenario: Worker 生成が MV3 制約で不可な場合に案B へ切り替えられる
  Given offscreen 内で new Worker が CSP / バンドル制約により失敗する
  When  案B（AccessHandlePool VFS, main thread）で同じ操作を試す
  Then  動作可否が記録され、採用判断メモに反映される
```

## 受け入れ基準

- [ ] 案A・案B それぞれについて「初期化／CRUD／FTS5／永続化（再起動後 read）」の可否が記録されている
- [ ] MV3 制約（offscreen 内 Worker 生成可否、CSP、bundler でのワーカー出力）の検証結果が残っている
- [ ] wa-sqlite v1.0.0 の OPFS VFS 互換 shim が必要かどうか判明している
- [ ] **採用方式（A or B）と理由**を設計仕様 or 本 PBI に追記している

## テスト戦略（t_wada スタイル）

スパイクだが、再利用可能な検証は自動テスト化する。

### 統合テスト
- offscreen ⇄ Worker メッセージ往復（案A）のモック検証
- VFS 初期化〜FTS5 検索のラウンドトリップ

### 単体テスト
- OPFS 機能検出ロジック（`getDirectory` / `createSyncAccessHandle` 有無）
- 案A 不可時に案B へフォールバックする分岐

### 手動検証（必須）
- 実 Chrome での OPFS 永続化（ドキュメント再起動後の read）
- DevTools → Application → OPFS で `yasumaro.db` の存在確認

## 実装アプローチ

- Outside-In: 「offscreen から OPFS 上の DB に書いて読める」E2E を先に失敗させ、内側へ
- スパイクのコードは破棄可能。ただし機能検出とフォールバック分岐は本実装へ引き継ぐ

## 見積もり

3〜5 pt（要チーム見積もり。不確実性が高いため上振れ前提）

## 技術的考慮事項

- 依存: なし（最初の PBI）。後続「OPFS 実装」PBI をブロックする
- wa-sqlite の OPFS VFS は `wa-sqlite/src/examples/` 配下に複数実装あり。どれが v1.0.0 で動くか要確認
- バンドラ（現状の build 設定）で Worker チャンクを出力できるか要確認

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rn "IDBBatchAtomicVFS\|vfs_register\|new Worker" src/offscreen/ src/
ls node_modules/wa-sqlite/src/examples/   # OPFS 系 VFS 実装の確認
```

### 落とし穴

- OPFS SyncAccessHandle は **Worker 内でのみ同期利用可**。main thread では使えない（案A が Worker 前提なのはこのため）
- wa-sqlite v1.0.0 npm の VFS は upstream と API がずれている（既存 shim 参照）
- MV3 の offscreen は単一インスタンス・ライフサイクル制限あり。長時間ハンドル保持に注意

## Definition of Done

- [x] 引き継ぐ検証コード（機能検出・フォールバック）は自動テスト付き — `src/offscreen/opfsCapabilities.ts`（9 tests, TDD）
- [x] 案A/案B の検証結果が文書化されている（上記マトリクス）
- [x] 採用方式が決定し、後続 PBI に引き継げる状態 — 案A（Worker + 同期FTS5ビルド + AccessHandlePoolVFS）
- [ ] レビュー完了

---

## スパイク進捗・所見（2026-06-14）

### 完了

- **再利用成果物（自動テスト付き）**: `src/offscreen/opfsCapabilities.ts`
  - `detectOpfsCapabilities(env)`: `navigator.storage.getDirectory` / `FileSystemFileHandle.prototype.createSyncAccessHandle` / `Worker` の有無を依存注入でプローブ
  - `selectVfsStrategy(caps)`: `opfs-sync-worker`（案A）→ `opfs-async-main`（案B）→ `fallback` を選択
  - `detectLiveVfsStrategy()`: 実環境を一括判定
  - テスト `src/offscreen/__tests__/opfsCapabilities.test.ts`（9 件、TDD Red→Green）。型チェック通過

### 構成面の所見（コード調査で判明）

- wa-sqlite v1.0.0 npm に OPFS VFS 実装が同梱: `node_modules/wa-sqlite/src/examples/`
  - 案A 用: `AccessHandlePoolVFS.js`（SyncAccessHandle、Worker 前提）
  - 案B 用: `OriginPrivateFileSystemVFS.js`（`name='opfs'`、非同期、main thread 可）
- offscreen は `entrypoints/offscreen.html` が `../src/offscreen/offscreen.js` を直接ロード（`entrypoints/offscreen.ts.bak` は未使用の残骸 → 整理候補）
- **`src/` 配下に `new Worker` の利用はゼロ**。案A は WXT/Vite で Worker チャンクを出力・MV3 で実行できるかが未検証の最大リスク

### 検証ハーネス（案B・実機検証用）— 実装済み

- 実行ロジック: `src/offscreen/opfsSpike.ts`
  - `runSpikeSteps()`（逐次実行・最初の失敗で停止・レポート組み立て、単体テスト 2 件）
  - `runOpfsSpikeB()`: `OriginPrivateFileSystemVFS` に対し open→create table→FTS5→insert→select→FTS5 MATCH→close を実行し、各ステップの ok/詳細を返す（手動検証用）
- 配線: offscreen `SQLITE_OPFS_SPIKE` → `SqliteClient.runOpfsSpike()` → dashboard `opfs_spike` subtype → `dashboardSqliteService.runOpfsSpike()`
- UI: 診断パネルに「OPFS スパイク実行」ボタン（`#diagOpfsSpikeBtn`）。結果はステップ単位で表示
- `npm run build` 成功を確認済み

**実機での確認手順**
1. `npm run build`
2. Chrome `chrome://extensions` で `dist/chromium-mv3` を再読み込み
3. ダッシュボード → 診断 → 「OPFS スパイク実行」
4. 全ステップ ✓ かつ `strategy=opfs-async-main` を確認
5. 永続化確認: DevTools → Application → OPFS に `opfs-spike.db` が残ること。拡張を再起動して再度ボタンを押し row count が維持されること

### 実機検証 結果（2026-06-14, 実 Chrome）

- `opfs-root (navigator.storage.getDirectory)`: **✓** — OPFS 自体は offscreen メインスレッドで動作（ファイル書き込み成功）
- `open-db (OriginPrivateFileSystemVFS)`: **✗ SQLITE_CANTOPEN(14)**
- 根本原因: `node_modules/wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js:340` が `createSyncAccessHandle()` を使用。Chrome では **Worker 内でのみ許可**されるため、offscreen メインスレッドでは open に失敗
- 機能検出は正しく「メインスレッドは syncAccessHandle 不可」と判定し案B を選択していたが、**案B（純メインスレッド）で使える純非同期 OPFS VFS が wa-sqlite v1.0.0 に存在しない**（同梱の OPFS VFS 2 種はいずれも `createSyncAccessHandle` 依存）

### 確定した採用方式

**案A（Worker + AccessHandlePoolVFS, 同期ビルド）が必須。案B は不可。**
理由: OPFS の SQLite アクセスは `createSyncAccessHandle`（Worker 限定）を要するため。

### Worker 内での組み合わせ検証（実 Chrome, 2026-06-14）

`src/offscreen/opfsWorker.ts` を offscreen から `new Worker(new URL('./opfsWorker.js', import.meta.url), {type:'module'})` で起動して検証。

| 組み合わせ | open | create-table | fts5-create |
|---|---|---|---|
| **同期ビルド `wa-sqlite.mjs` + AccessHandlePoolVFS** | **✓** | **✓** | ✗ `no such module: fts5` |
| 非同期ビルド `wa-sqlite-async.mjs` + AccessHandlePoolVFS | ✗ CANTOPEN(14) | — | — |
| 非同期ビルド + OriginPrivateFileSystemVFS | ✗ CANTOPEN(14) | — | — |

確定事項:
- **WXT/Vite は offscreen 用の Worker をバンドルできる**（`dist/.../assets/opfsWorker-*.js` 生成、起動成功）← 最大リスク解消
- **Worker + 同期ビルド + AccessHandlePoolVFS で OPFS への open / DDL が成功**（OPFS 永続化の道が実証された）
- 非同期（asyncify）ビルドは v1.0.0 ラッパー + OPFS VFS との噛み合わせで open 不可（既知のバージョン不整合）。OPFS には同期ビルド + 同期 VFS が正解
- **唯一の不足は FTS5**。同梱の同期 npm ビルドに FTS5 が無いだけ。`vendor/wa-sqlite/build-wasm.sh` は現状**非同期ビルドのみ** FTS5 付きで生成している（`make ... dist/wa-sqlite-async.mjs`）

### 追加検証（FTS5 同期ビルド, 2026-06-14）

FTS5 を同期ビルドに入れるため WASM を自前再ビルドして検証した結果:

| 同期 WASM | open (AccessHandlePoolVFS @ Worker) | FTS5 |
|---|---|---|
| npm 配布バイナリ（558KB）| ✓ | ✗（未同梱）|
| 自前ビルド HEAD + `-DSQLITE_ENABLE_FTS5`（725KB）| ✗ CANTOPEN(14) | （到達せず）|
| 自前ビルド v1.0.0 タグ + `-DSQLITE_ENABLE_FTS5`（700KB, SQLite 3.46.0）| ✗ CANTOPEN(14) | （到達せず）|

- **バージョン整合（v1.0.0 タグ）でも自前ビルドの同期 WASM は CANTOPEN**。npm 配布バイナリのみが AccessHandlePoolVFS で open 可能
- 原因は wa-sqlite JS API と自前ビルド WASM のバイナリ非互換（emscripten 5.0.7 / リンクフラグ / SQLite バージョンのいずれか）。**FTS5 + OPFS 同期ビルドの両立は、ビルド環境の作り込み or wa-sqlite のバージョン更新が必要**で、PBI-12 の実装課題
- 非同期 FTS5 ビルド（HEAD, emscripten 5.0.7）は IDBBatchAtomicVFS で動作実績あり（本番）。よって emscripten 自体が壊れているわけではなく、**同期ビルド + OPFS VFS の組み合わせ特有**の問題
- `vendor/wa-sqlite/build-wasm.sh` に v1.0.0 タグ pin + 同期ターゲットを追加する WIP 変更を入れたが、生成物が CANTOPEN のため未完。要継続調査

### PBI-12（OPFS 実装）への引き継ぎ事項

1. **同期 FTS5 WASM を再ビルド**: `vendor/wa-sqlite/build-wasm.sh` に `make WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_FTS5" dist/wa-sqlite.mjs`（同期ターゲット）を追加し、`wa-sqlite.wasm`/`wa-sqlite.mjs` を vendor/node_modules へ配置（要 emscripten）
2. 本番ストレージ層を **Worker（offscreen 内）+ 同期ビルド + AccessHandlePoolVFS** で再構成（現状 `sqlite.ts` は main-thread + IDBBatchAtomicVFS）
3. OPFS 不可環境は既存 `FallbackStorage`（chrome.storage.local）へ
4. スパイクの `opfsWorker.ts` がそのまま雛形になる（同期ビルド + AccessHandlePoolVFS の open/CRUD/FTS5/persist シーケンス）

### 残作業（実機検証が必須・自動化不可）

1. 案B（`OriginPrivateFileSystemVFS`、offscreen main thread）で init→CRUD→FTS5→再起動後 read を実 Chrome で確認
2. 案A（Worker + `AccessHandlePoolVFS`）について WXT/Vite で Worker をバンドルできるか build で確認 → 可なら実機で同検証
3. wa-sqlite v1.0.0 の OPFS VFS が既存 shim（`registerVFS`/`hasAsyncMethod`）を要するか確認
4. 上記を踏まえ **採用方式（A or B）を確定**し本節に追記

### 暫定推奨

案A の Worker バンドルが WXT で素直に通らない場合、**案B（main thread 非同期 OPFS）を初手の採用**とし、性能要件が満たせなければ案A へ移行する段階導入が現実的。最終判断は残作業 1〜2 の実機結果による。
