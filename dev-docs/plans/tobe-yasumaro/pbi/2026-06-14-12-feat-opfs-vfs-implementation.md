# PBI: OPFS VFS への移行実装（IndexedDB VFS 廃止）

> 種別: feat（ストレージ基盤の差し替え）
> 関連設計: `dev-docs/specs/2026-06-14-sqlite-opfs-persistence-design.md`
> 依存: PBI-10（OPFS スパイク）完了が前提
> 進め方: **TDD 必須**

## ユーザーストーリー

拡張機能のユーザーとして、ブラウジング履歴が OPFS 上の SQLite に永続化されてほしい、なぜなら IndexedDB より高速・堅牢で、大量データでも安定して検索・閲覧できるからだ。

## ビジネス価値

- ゴール「OPFS + wa-sqlite + FTS5」の中核を満たす
- 測定: OPFS で初期化・CRUD・FTS5 検索・永続化が動作。診断パネルで VFS 種別が `OPFS` と表示される

## 背景（現状確認済み）

- 現状 `src/offscreen/sqlite.ts` は `IDBBatchAtomicVFS`（IndexedDB）を使用
- OPFS 不可時の `FallbackStorage`（chrome.storage.local）は既存・維持する
- スパイク（PBI-10）で採用方式（案A: Worker+SyncAccessHandle / 案B: AccessHandlePool）が確定している前提

## BDD 受け入れシナリオ

```gherkin
Scenario: OPFS 上で履歴が永続化される
  Given OPFS が利用可能な Chrome 環境
  When  記録パイプラインがページを保存し、ブラウザ再起動後に SQLite History を開く
  Then  保存した履歴が OPFS 上の DB から読み出されて表示される

Scenario: OPFS 不可環境でフォールバックする
  Given OPFS / SyncAccessHandle が利用できない環境
  When  履歴を保存する
  Then  chrome.storage.local の FallbackStorage に保存され、診断で fallback 中と表示される
```

## 受け入れ基準

- [ ] VFS 層が OPFS 方式（PBI-10 で決定した A or B）に差し替わっている
- [ ] IndexedDB VFS（`IDBBatchAtomicVFS`）への依存が除去されている
- [ ] OPFS → FallbackStorage のフォールバック階層が動作する
- [ ] 既存の CRUD・FTS5・リテンション・移行の全テストがグリーン
- [ ] 診断パネルが VFS 種別を正しく報告する（OPFS / fallback）

## テスト戦略（t_wada スタイル）

### E2E / 手動
- 実 Chrome で保存 → 再起動 → 読み出し（OPFS 永続化）

### 統合テスト
- offscreen ⇄ background のメッセージ往復（insert/query/search/status）
- OPFS 不可 → FallbackStorage への切替

### 単体テスト
- VFS 初期化・OPFS 機能検出
- 既存 CRUD / FTS5 / sanitizeFtsQuery / purge のリグレッション

## 実装アプローチ

- Outside-In: 「OPFS で保存→再読込できる」統合テストを先に失敗させる
- 既存 `sqlite.ts` の VFS 登録部（`sqlite.ts:134-152`）を中心に差し替え。CRUD ロジックは温存
- Red-Green-Refactor。グリーン後に shim/初期化処理を整理

## 見積もり

5〜8 pt（要チーム見積もり）

## 技術的考慮事項

- 依存: PBI-10
- 案A 採用時は offscreen ⇄ Worker のメッセージ層が増える。`sqliteClient` / offscreen ハンドラの構造見直しが必要
- `manifest.json` の web_accessible_resources / Worker チャンク出力に注意（CLAUDE.local.md のモジュール分割ルール参照）

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rn "IDBBatchAtomicVFS\|vfs_register\|registerVFS" src/offscreen/sqlite.ts
grep -rn "OPFS_FALLBACK_MODE\|FallbackStorage" src/offscreen/
```

### 落とし穴

- 既存 `tryMigrateFallbackToSqlite()` は OPFS 初期化成功後に fallback データを取り込む。VFS 差し替え後も整合するか確認
- WAL モード設定（`PRAGMA journal_mode=WAL`）が OPFS VFS で有効か検証
- IndexedDB に残った旧 DB データ（PBI-11 で変換済みの履歴を含む）は**破棄してよい**。OPFS 側で PBI-11 の変換を再実行すれば、レガシー元データから冪等に再投入できる（元データは削除していないため）

## Definition of Done

- [ ] 全 BDD シナリオが自動テスト化されパス
- [ ] OPFS / fallback 両経路の統合テストがグリーン
- [ ] 実 Chrome での永続化を手動確認
- [ ] レビュー・リファクタリング完了
- [ ] 設計仕様の VFS 記述を実態に更新
