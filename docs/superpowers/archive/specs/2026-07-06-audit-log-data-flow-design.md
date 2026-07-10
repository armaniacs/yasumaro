# 設計: 監査ログ / データ送信の可視化

- 元PBI: [dev-docs/plans/2026-07-04-11-feat-audit-log-data-flow.md](../../../dev-docs/plans/2026-07-04-11-feat-audit-log-data-flow.md)
- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)

## 背景・現状分析

PBI原文は「full_pipelineモードのみクラウド送信イベントを記録する」としているが、実装を調査した結果これは不正確だった。

`src/background/privacyPipeline.ts` の `_buildSanitizedSettings()`（140-146行目）:

```typescript
useCloudAi: this.mode !== 'local_only',
```

`masked_cloud` モードでも `useCloudAi` は `true` になり、実際にクラウドへの送信が発生する。したがって監査ログの記録条件は「モード名」ではなく「実際にクラウドAIプロバイダーへ送信したかどうか」で判定する。

また、送信先プロバイダー名（gemini/openai等）は `privacyPipeline.ts` からは分からない。`privacyPipeline.ts` は L3 段で `this.aiClient.generateSummary()` を呼ぶのみで、実際のプロバイダー選択・フォールバック処理は `src/background/aiClient.ts` の `generateSummary()` 内部（`resolveProviderSlots()` で得た `slot.provider` ごとにループ）で行われる。監査ログのフックはこの内部に置く必要がある。

## 対象スコープ

- クラウドAIプロバイダーへの要約リクエスト送信イベントを、送信の成否によらず記録する（「送信を試みた」事実の記録）
- 記録するのはメタデータのみ：`provider`（プロバイダー名）、`url`（対象ページURL）、`timestamp`（送信日時）
- ページ本文・送信テキスト・要約結果・PIIは一切含めない
- `local_only` モードでは送信自体が発生しないため、記録も発生しない

## データ設計

新規SQLiteテーブルを `src/offscreen/schema.ts` に追加する。既存の `browsing_logs` とは独立したテーブルとし、突合は行わない（履歴側の記録失敗・成功と監査ログは非同期に扱う）。

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
```

- 保持期間・件数上限は設けない（`browsing_logs` と同様の方針）。将来的な削除機能はスコープ外（YAGNI）
- マイグレーションは既存の `src/offscreen/schema.ts` の適用フローに乗せる（`sqlite.ts` / `opfsWorker.ts` 双方から参照される単一ソース）

## コンポーネント設計

### 1. `src/offscreen/schema.ts`（拡張）
- `AUDIT_LOG_SCHEMA_SQL` として上記DDLを追加し、既存のスキーマ適用箇所から実行する

### 2. `src/background/aiClient.ts`（拡張）
- `generateSummary()` のプロバイダーループ内（68-88行目）、`providerInstance.generateSummary(content, tagSummaryMode)` を呼び出す**直前**に監査イベントを発行する
- 送信成否・結果内容によらず「送信を試みた」時点で記録する（成功/失敗の分岐は監査ログの対象外。プロバイダー名とURLと日時のみで十分）
- 記録のための新規関数 `recordAuditLog({ provider, url })` を新規モジュール `src/utils/auditLog.ts` に定義し、background側から呼び出す
- `url` はどこから取ってくるか：`generateSummary()` の引数に `content` はあるが `url` は現状渡っていないため、`generateSummary(content, tagSummaryMode, url)` のようにシグネチャを拡張する（呼び出し元 `privacyPipeline.ts` の `_processCloudResult` 呼び出し元から `url` を渡せるよう連鎖的に伝播させる）

### 3. `src/utils/auditLog.ts`（新規）
- `recordAuditLog({ provider, url }: { provider: string; url: string }): Promise<void>`
  - background実行コンテキストから、既存の `sqliteClient.ts` の書き込み経路（offscreen documentへのメッセージパッシング）を再利用してSQLiteに1行追加する
  - 新規メッセージタイプ `RECORD_AUDIT_LOG` を `src/background/sqliteClient.ts` および `src/background/handlers/dashboardSqliteHandlers.ts` に追加し、offscreen側で `INSERT INTO audit_log (...)` を実行する
- `getAuditLogs({ limit, offset }): Promise<AuditLogEntry[]>`
  - ダッシュボードから時系列（`created_at DESC`）で取得するための読み取り関数

### 4. `src/dashboard/auditLogPanel.ts`（新規）
- 既存の `sqliteHistoryPanel.ts` のクエリ・レンダリングパターンを踏襲
- `entrypoints/options/index.html` にサイドナビ項目（`data-panel="panel-audit-log"`）を追加
- 一覧表示: プロバイダー名・URL・日時を新しい順に表示。ページネーションは既存パネルの方式に合わせる
- 0件時は空状態メッセージを表示（既存パネルの空状態パターンを踏襲）

## エラーハンドリング

- 監査ログの書き込み失敗（offscreenメッセージ送信失敗等）は記録処理自体をブロックしない。`recordAuditLog()` の失敗は `logError()` でログに残すのみとし、要約処理は継続する（監査ログはベストエフォート。要約機能の可用性を監査ログの成否に依存させない）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `recordAuditLog()`: 正常系（SQLite書き込み呼び出しの引数検証）
- `recordAuditLog()`: 書き込み失敗時に例外を投げず `logError` のみ呼ばれること
- `aiClient.generateSummary()`: `useCloudAi` 相当の呼び出し時に `recordAuditLog` が呼ばれること（プロバイダーごと、フォールバック発生時は複数回呼ばれること）
- `getAuditLogs()`: 時系列ソート・limit/offsetの検証

### 統合テスト
- `local_only` モード（`useCloudAi: false`）ではクラウドAI呼び出し自体が発生せず、`recordAuditLog` も呼ばれないこと
- `masked_cloud` / `full_pipeline` 双方のモードで `recordAuditLog` が呼ばれること（PBI原文の誤りを踏まえた回帰テスト）
- スキーマ適用: `audit_log` テーブルが正しく作成されること（`sqlite.ts` / `opfsWorker.ts` 両経路）

### E2Eテスト
- クラウド送信が発生する記録 → ダッシュボードの監査パネルに新しい行が時系列で表示される
- `local_only` 設定で記録 → 監査パネルに新しい行が現れない

## 実装アプローチ

Outside-In / Red-Green-Refactor。`recordAuditLog()` の単体テストから着手し、次に `aiClient.ts` への結線、最後にダッシュボードUIを実装する。

## 技術的考慮事項

- 依存: なし
- 再利用: `src/background/sqliteClient.ts`（offscreenへの書き込み経路）、`src/dashboard/sqliteHistoryPanel.ts`（一覧表示パターン）、`src/offscreen/schema.ts`（スキーマ管理）
- `generateSummary()` のシグネチャ変更（`url` 引数追加）は呼び出し元（`privacyPipeline.ts` の `_processCloudResult` 経路）を含めた連鎖的な修正が必要。既存の全呼び出し箇所・テストモックを洗い出すこと

## スコープ外（YAGNI）

- 監査ログの保持期間上限・自動削除機能
- 監査ログエントリの手動削除・エクスポート機能
- `browsing_logs` との突合・関連付け

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
