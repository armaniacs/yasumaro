# PBI: IDB フォールバックパスの @subframe7536/sqlite-wasm 移行

## ユーザーストーリー

開発者として、IndexedDB フォールバックパスの SQLite VFS 初期化を旧 `wa-sqlite` から `@subframe7536/sqlite-wasm` へ移行したい、なぜなら旧ライブラリ依存を残したままだと技術負債が固定化し、バンドルサイズ・保守性の両面で不利になるから。

出典: `docs/blog-6_5/offscreen-opfs-sqlite-coexistence-deep-dive.md`「開発者の方向け: すぐに効く改善案」より。
関連ADR: `dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md`（ADR-014）。

本PBIは元 `pbi/2026-07-16-03-fix-offscreen-opfs-sqlite-coexistence.md`（brainstormingで深掘り後に3+1分割）の一部。関連: [[2026-07-16-04-fix-adr014-file-references]] [[2026-07-16-05-fix-sqlite-message-type-unification]] [[2026-07-16-07-decide-opfs-migration-v2-removal]]

## 前提（brainstormingで確認済み）

IDB フォールバックパス自体の要否は本PBIのスコープ外とする。OPFS Worker 初期化は COOP/COEP 制約・ブラウザバージョン・ストレージ制約等により失敗しうる仕様であるため、フォールバック戦略自体は妥当と判断済み。本PBIでは **移行方法のみ** を検討する。

## ビジネス価値

- IDB フォールバックパスの `@subframe7536/sqlite-wasm` 移行を完了し、旧 `wa-sqlite` 依存を除去できる状態にする（バンドル削減・保守性向上）
- ADR-014 が「移行完了まで併存」としたまま期限を設定していない状態を解消する

## 既実装確認（フェーズ0で実施済み）

```bash
# OPFS Worker パスは @subframe7536 に置換済み（対比として確認）
grep -n "subframe7536\|OPFSCoopSyncVFS\|FTS5" src/offscreen/opfsWorker.ts
# → L3, L55 (@subframe7536/sqlite-wasm), FTS5 使用を確認。OPFSパスは既に移行済み

# しかし IDB VFS 初期化は未だ wa-sqlite
grep -n "wa-sqlite" src/offscreen/sqliteEngineContext.ts
# → L9  import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'
# → L233 this.sqlite3 = SQLite.Factory(asyncModule)
# → 未実装（本PBIで対応する作業）: IDB VFS 初期化を @subframe7536/sqlite-wasm の IDB VFS に置き換える
```

ADR-014 は「旧 `wa-sqlite` 依存は IDB フォールバックと移行リーダ（`opfsMigrationV2Reader.ts`）に限定され、将来の除去が容易」としているが、移行完了の期限は設定されていない。

## BDD受け入れシナリオ

```gherkin
Feature: IDB フォールバックパスの @subframe7536 移行

  Scenario: IDB VFS 初期化が wa-sqlite に依存していない
    Given ADR-014 で「旧依存を移行完了まで併存」と決めている
    When  grep -n "wa-sqlite" src/offscreen/sqliteEngineContext.ts を実行する
    Then  該当する import / Factory 呼び出しが存在しない
    And   IDB パスも @subframe7536/sqlite-wasm の IDB VFS を使用している

  Scenario: 既存ユーザーの IDB データが移行後も読み書きできる
    Given wa-sqlite の IDBBatchAtomicVFS で書き込まれた既存の IDB データベースが存在する
    When  @subframe7536/sqlite-wasm の IDB VFS で同じデータベースを開く
    Then  既存レコードが読み取れる
    And   新規の insert/update/delete が正常に動作する

  Scenario: OPFS Worker が利用できない環境でフォールバックが機能する
    Given OPFS Worker の初期化が失敗する環境（ブラウザ制約等）
    When  SQLite エンジンが初期化される
    Then  @subframe7536/sqlite-wasm ベースの IDB VFS にフォールバックする
    And   FTS5 検索が引き続き利用できる
```

## 受け入れ基準
- [ ] `src/offscreen/sqliteEngineContext.ts` から `wa-sqlite` の import が削除されている
- [ ] IDB VFS 初期化が `@subframe7536/sqlite-wasm` ベースに置き換わっている
- [ ] 既存の wa-sqlite IDB データベースからの読み取り互換性が確認されている（既存データが失われない）
- [ ] FTS5 検索が IDB フォールバックパスでも引き続き動作する
- [ ] `package.json` から `wa-sqlite` 依存が削除されている（`opfsMigrationV2Reader.ts` が引き続き使用する場合は除く。除去は [[2026-07-16-07-decide-opfs-migration-v2-removal]] 待ち）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- **本PBI着手前に E2E スパイクを先行させること（必須）**。OPFS Worker を意図的に無効化した状態で拡張機能を起動し、IDB フォールバック経由で記録・検索が正常動作するかを実ブラウザで確認する
- 既存の wa-sqlite IDB データを持つ状態から拡張機能を更新し、データ損失なく新VFSで読み込めることを確認するシナリオ

### 統合テスト
- `sqliteEngineContext.ts` の IDB 初期化パスの単体/統合テスト（モックIDBを使用）
- 既存 wa-sqlite 形式データベースファイルの互換読み込みテスト

### 単体テスト
- VFS 切り替えロジックの境界値テスト（OPFS失敗→IDB成功、IDB失敗→chrome.storage.localフォールバック）
- FTS5クエリが新IDB VFS経由でも同じ結果を返すことのテスト

## 実装アプローチ
- **Outside-In**: E2Eスパイクで実現可能性とデータ互換性を先に検証してから、統合テスト・単体テストの順に実装する
- **Red-Green-Refactor**: 既存の3段フォールバック（OPFS Worker → IDB → chrome.storage.local）のテストを先に固定し、IDB層の内部実装のみを差し替える
- **リファクタリング**: `sqliteEngineContext.ts` 内のIDB初期化ロジックが `@subframe7536` 移行後も可読性を保っているか確認する

## 見積もり
13pt（最大工数・回帰リスク大、E2Eスパイク必須のため上振れの可能性あり。スパイク結果次第で再見積もりを推奨）

## 技術的考慮事項
- 依存関係: [[2026-07-16-04-fix-adr014-file-references]]・[[2026-07-16-05-fix-sqlite-message-type-unification]] とは独立し並行着手可能。ただし本PBI完了後に ADR-014 の「旧依存併存」記述も更新が必要になる（PBI-04が先に完了していれば追記のみで済む）
- テスタビリティ: 既存の wa-sqlite IDB データベースファイルのサンプルを用意し、回帰テストに使う必要がある
- 非機能要件: バンドルサイズ削減が主目的の一つ。移行前後でのバンドルサイズ比較を記録する

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "wa-sqlite" src/offscreen/sqliteEngineContext.ts
grep -n "subframe7536" src/offscreen/opfsWorker.ts src/offscreen/sqliteEngine.ts
grep -rn "wa-sqlite" package.json
```

### 実装手順
1. E2Eスパイク: OPFS Worker を無効化した状態で `@subframe7536/sqlite-wasm` の IDB VFS が動作するか検証する
2. 既存 wa-sqlite IDB データベースの読み取り互換性を検証する（バイナリフォーマットの互換性確認が最重要）
3. `sqliteEngineContext.ts` の IDB 初期化部分（L9, L233 周辺）を `@subframe7536/sqlite-wasm` ベースに置き換える
4. 既存テストを実行し、3段フォールバックの他の経路（OPFS Worker, chrome.storage.local）に影響がないことを確認する
5. `package.json` の `wa-sqlite` 依存について、`opfsMigrationV2Reader.ts` がまだ使用している場合はコメントで理由を明記し、完全除去は別PBI（[[2026-07-16-07-decide-opfs-migration-v2-removal]]）に委ねる

### 落とし穴
- `opfsMigrationV2Reader.ts` は wa-sqlite の同期ビルドに依存して旧DBを読んでいる。本PBIで wa-sqlite の IDB VFS 依存を除去しても、このファイルが引き続き wa-sqlite をimportし続ける可能性がある。除去の是非は「どれだけのユーザーが移行済みか」という別軸の判断（リリースからの経過期間・利用統計）が必要なため、[[2026-07-16-07-decide-opfs-migration-v2-removal]] で扱う。本PBIのスコープでは無理に同時除去しないこと
- IDBBatchAtomicVFS 特有のロック機構（`IDBBatchAtomicVFS.js`）と `@subframe7536` の IDB VFS 実装でロック戦略が異なる場合、同時書き込み時の挙動が変わる可能性がある。Mutex（`src/background/Mutex.ts`）との整合を確認すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] E2Eスパイクで既存データの読み取り互換性が実証されている
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] ADR-014 の「旧依存併存」記述が更新されている（またはフォローアップPBIとして記録されている）
