# SQLite ローカル永続化（OPFS + wa-sqlite + FTS5）設計仕様

- 日付: 2026-06-14
- ステータス: 合意済み（PBI 化前）
- 進め方の制約: **必ず TDD（Red → Green → Refactor）で進める**

## 1. ゴール

ブラウジング履歴をローカル SQLite に永続化し、**Obsidian がなくても単体で動作**する検索・閲覧基盤を提供する。

- ストレージ: OPFS + wa-sqlite + FTS5 全文検索
- SQLite は**恒久的に「二次ストア（検索・閲覧用）」**として位置づける。System of Record 化（Obsidian を任意のエクスポート先に格下げ）は今回のスコープ外
- Obsidian 連携は現状のまま変更しない

## 2. 背景・現状

既に相当量の実装が存在する。

- `src/offscreen/sqlite.ts`: CRUD・FTS5・LIKE フォールバック・リテンション・移行ロジック
- `src/background/pipeline/steps/saveSqliteStep.ts`: 記録パイプラインから SQLite へ書き込み
- `src/dashboard/sqliteHistoryPanel.ts`: 独立した SQLite History パネル（カレンダー・検索・star/delete）
- `src/dashboard/diagnosticsPanel.ts`: status / path / fallback / fts5 を表示
- `src/offscreen/storageFallback.ts`: OPFS 不可時に `chrome.storage.local` へ退避する `FallbackStorage`

**重要な乖離**: ゴール文言は OPFS だが、現状の VFS は IndexedDB ベース（`IDBBatchAtomicVFS`）。本仕様で OPFS へ移行する。

## 3. 決定事項

| 論点 | 決定 |
|------|------|
| ストレージ基盤 | **OPFS を正式採用**。IndexedDB VFS は段階的廃止 |
| OPFS 実装方式 | **まず調査スパイク**で案 A / 案 B の実現性を検証してから確定 |
| SQLite の位置づけ | 恒久的に二次ストア（検索・閲覧用）。Obsidian 連携は現状維持 |
| 変換元データ | レガシー `chrome.storage.local` の `savedUrls`（`SavedUrlEntry`） |
| 変換 UX | ダッシュボードの**手動ボタン**。元データは**残す**。`INSERT OR IGNORE` で再実行可・重複排除 |
| SQLite History パネル | 完成まで他機能から**独立**。レガシー History パネルと並存 |
| 診断 | ケイパビリティ・マトリクス（使えるか / 何が使えるか / 全機能に何が足りないか） |
| デバッグ情報 | 当面は詳細情報を多めに表示 |
| フォールバック階層 | OPFS →（不可なら）`chrome.storage.local` の `FallbackStorage` |

## 4. アーキテクチャ（4 本柱）

### 柱 1: OPFS ストレージ基盤（スパイク → 実装）

**スパイク（最初に実施）**
MV3 offscreen ドキュメント内で以下を検証し、採用方式を決める。成果物は動作可否＋判断メモ。

- 案 A: offscreen 内 Worker で OPFS **SyncAccessHandle VFS**（wa-sqlite 推奨・高性能・堅牢）
- 案 B: offscreen 直で **AccessHandlePool VFS**（Worker 不要だが並行性・ロックが弱い）

スパイクで確認すべき項目:
- `navigator.storage.getDirectory()` / `createSyncAccessHandle` の有無
- offscreen 内 Worker 生成可否（MV3 CSP・バンドル制約）
- wa-sqlite v1.0.0 npm 版の VFS 互換性（既知の `registerVFS`/`hasAsyncMethod` shim 問題を踏まえる）
- FTS5 ビルドとの整合

**実装（方式確定後）**
- `sqlite.ts` の VFS 層を OPFS 方式へ差し替え。IndexedDB VFS は段階的に廃止
- フォールバック階層は維持: OPFS → `FallbackStorage`（chrome.storage.local）

### 柱 2: レガシー記録履歴 → SQLite 変換機能（設定画面）

- ダッシュボードに手動実行ボタンを追加
- 変換元 = `chrome.storage.local` の `savedUrls`（`SavedUrlEntry`）→ `BrowsingLogRecord` へマッピング
- 元データは削除しない。`INSERT OR IGNORE`（UNIQUE(url, created_at)）で再実行可・重複排除
- 実行結果（対象件数 / 取り込み成功 / スキップ / 失敗）を表示（デバッグ可視性）

### 柱 3: SQLite History パネル（独立維持）

- 既存 `sqliteHistoryPanel.ts` を完成まで他機能から独立させる
- レガシー History パネルと並存。SQLite は二次ストアとして検索・閲覧を担う

### 柱 4: 診断パネル拡張（ケイパビリティ・マトリクス）

3 層で表示する。

1. **環境判定**: OPFS API 有無 / SyncAccessHandle 有無 / Worker 可否
2. **DB 状態**: 初期化成否 / VFS 種別（OPFS / IndexedDB / fallback）/ FTS5 有無 / レコード件数 / DB パス
3. **不足診断**: 全機能を有効化するために足りないものと対処を明示
   - 例: 「FTS5 なし → WASM 再ビルドが必要」「OPFS 不可 → fallback 動作中（理由）」

デバッグ期間中は `PRAGMA compile_options` / 初期化エラー全文 / FTS インデックス件数などの詳細も表示する。

## 5. データモデル

既存 `browsing_logs` スキーマ（`src/offscreen/sqlite.ts` の `SCHEMA_SQL`）を踏襲。変更は必要に応じてマイグレーションで追加（現行は `ALTER TABLE ... ADD COLUMN` パターン）。

## 6. テスト方針（TDD 必須）

- 各機能は Red → Green → Refactor。実装前にテストを書く
- 単体: VFS 抽象（モック）・変換マッピング・診断ロジック・サニタイズ
- 統合: offscreen ⇄ background のメッセージ往復、移行の冪等性（再実行で重複しない）
- フォールバック経路: OPFS 不可時に FallbackStorage へ落ちることを検証
- Chrome Extension API の制約上、OPFS/Worker の最終確認は実ブラウザで手動検証

## 7. スコープ外（YAGNI）

- SQLite を System of Record にする変更（Obsidian の格下げ）
- 真の `.db` バイナリ・シリアライズ（現状は JSON エクスポート）
- 自動バックグラウンド移行（今回は手動ボタンのみ）

## 8. 次のステップ

本仕様を基に PBI を作成する（柱ごと、かつスパイクを最初の PBI とする）。
