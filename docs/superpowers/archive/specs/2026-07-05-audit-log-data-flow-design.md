# 設計: 監査ログ / データ送信の可視化

- 元PBI: [dev-docs/plans/2026-07-04-11-feat-audit-log-data-flow.md](../../../dev-docs/plans/2026-07-04-11-feat-audit-log-data-flow.md)
- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)

## 目的

どのページの内容がどのAIプロバイダーへ送信されたかをユーザーが一覧で確認できるようにする。監査ログ自体が新たな漏洩面にならないよう、本文・PIIは含めず、メタデータのみを記録する。

## アーキテクチャ

既存の `src/utils/logger.ts` を拡張する。専用の保存領域は新設せず、既存の `addLog`/`getLogs`（`MAX_LOGS = 1000` 件、`chrome.storage.local` 保存、古い順に削除）をそのまま利用する。

### LogType 拡張

```ts
export const LogType = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  SANITIZE: 'SANITIZE',
  DEBUG: 'DEBUG',
  AUDIT: 'AUDIT', // 追加
} as const;
```

### 監査ログの詳細データ

```ts
interface AuditLogDetails {
  provider: string;          // AIプロバイダー名（例: "openai", "claude"）
  domain: string;            // 送信元ページのドメインのみ（パス・クエリは含まない）
  status: 'success' | 'failure';
  mode: string;              // 'full_pipeline' | 'masked_cloud'
}
```

`LogEntry.details` にこの構造を格納する。本文・要約・PII・フルURLは一切含めない。

## データフロー

### 記録箇所: `src/background/privacyPipeline.ts`

`process()` 内、L3クラウド送信部分（`this.aiClient.generateSummary` 呼び出し）にフックを追加する。

- **記録タイミング**: クラウドAIへの送信を試行した時点（成功・失敗いずれも記録）
- **成功時**: `_processCloudResult` 内で `addLog(LogType.AUDIT, ..., { provider, domain, status: 'success', mode })`
- **失敗時**: `generateSummary` が失敗した場合も同様に `status: 'failure'` で記録
- **ドメイン抽出**: 送信対象ページのURLからドメイン部分のみを抽出するユーティリティ関数を追加（パス・クエリ・フラグメントは破棄）

### 記録しないケース

- `local_only` モード: `useCloudAi = false` となり、クラウド送信自体が発生しないため自然に記録されない（既存の `_buildSanitizedSettings` ロジックのまま、追加の分岐は不要）

## ダッシュボード表示

### 新規パネル: `panel-audit-log`

既存の sidebar ナビゲーション（`data-panel="panel-*"`）に項目を追加する。専用モジュール `src/dashboard/auditLogPanel.ts` を新設。

- `getLogs()` を呼び出し、`LogType.AUDIT` のみをフィルタ
- 時系列（新しい順）でテーブル表示
- テーブル列: 日時 / プロバイダー / ドメイン / モード / ステータス（成功・失敗）

### スコープ外（今回は実装しない）

- フィルター・検索機能
- 個別ログの削除（既存の `clearLogs()` の対象に自然に含まれる）
- CSV等のエクスポート

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `addLog(LogType.AUDIT, ...)` が本文を含まないメタデータのみで記録されることの検証
- ドメイン抽出ユーティリティが URL からパス・クエリを除去することの検証
- `local_only` モードでは監査ログが記録されないことの検証

### 統合テスト
- `privacyPipeline.process()` を各モード（local_only/masked_cloud/full_pipeline）で実行し、監査ログの記録有無の差を検証
- クラウド送信失敗時に `status: 'failure'` で記録されることの検証

### E2Eテスト
- full_pipeline モードでページ記録 → ダッシュボードの監査パネルに送信イベントが表示されることを確認

## 受け入れ基準（PBIより再掲）

- [ ] クラウド送信イベント（送信先・対象ドメイン・日時・成功/失敗）を記録する
- [ ] ローカル完結時は送信記録を残さない
- [ ] ダッシュボードで時系列一覧を表示する
- [ ] 監査ログに送信本文そのものは残さない（メタのみ）
