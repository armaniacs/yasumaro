# 設計: 記録漏れの検知とリカバリ通知

- 元PBI: [dev-docs/plans/2026-07-04-06-feat-missed-record-recovery.md](../../../dev-docs/plans/2026-07-04-06-feat-missed-record-recovery.md)
- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)

## 背景・現状分析

`src/utils/pendingStorage.ts` には既に pending 機構が存在するが、これは `checkPrivacyHeadersStep.ts` から呼ばれる **ヘッダーブロック専用**（`reason: 'cache-control' | 'set-cookie' | 'authorization'`）であり、実際の記録処理の失敗はカバーしていない。

`src/background/pipeline/RecordingPipeline.ts` の現状:

- FATAL/RETRY 戦略のステップ（`domainFilter`, `permission`, `trust`, `duplicate` 等）が失敗すると `buildErrorResult()` が呼ばれ、Chrome通知を出すだけで `success: false` を返す。**この失敗はどこにも永続化されず、通知を見逃すと記録漏れに気づけない。**
- BEST_EFFORT 戦略の `saveObsidian` ステップが失敗しても `context.errors` に積まれるだけで、パイプライン全体は `buildResult()` により `success: true` を返す。**Obsidianへの書き込みが実際には行われていないのに、UI上は成功したように見える。**

この2つの記録漏れパターンを、既存の pending 機構を拡張して一元的にカバーする。

### 既存の再記録UIの挙動（重要な前提）

`src/dashboard/historyPendingPanel.ts` と `src/popup/pendingPages.ts` の「今すぐ記録」ボタン（`executeRecord`）は、**既に** `content: ''` で `MANUAL_RECORD` メッセージを送信しており、`src/background/service-worker.ts` の `handleManualRecord()` が `manualContentFetcher.fetchContent(url)` でページ本文をURLからライブ再取得してからパイプライン全体を再実行している。

つまり、失敗したページの本文やAI要約済みデータを `PendingPage` に保存しておく必要はない。**既存の再記録ボタンをそのまま使い回せば、`pipeline-error` と `obsidian-write-failed` のどちらのケースも「URL再取得 + パイプライン全体を再実行」で回復できる。** AI要約が再度実行される（コスト・レイテンシが再発生する）が、実装を一元化しシンプルに保つことを優先する。

## 対象スコープ

1. **`pipeline-error`**: FATAL/RETRYステップで失敗し `success: false` になったケース（パイプライン全体の失敗）
2. **`obsidian-write-failed`**: `saveObsidian` のみが BEST_EFFORT で失敗し、他は成功しているケース（部分的失敗）

両方を pending として集約し、既存の「今すぐ記録」ボタンによるワンクリック再記録の対象とする。

## データ設計

既存の `PendingPage` 型（`src/utils/pendingStorage.ts`）を拡張する。新規ストアは作らず、同一の `osh_pending_pages` キー・同一UIコンポーネントを再利用する。

```typescript
export interface PendingPage {
  url: string;
  title: string;
  timestamp: number;
  reason: 'cache-control' | 'set-cookie' | 'authorization' | 'pipeline-error' | 'obsidian-write-failed';
  headerValue?: string;
  expiry: number;

  // 記録失敗系（pipeline-error / obsidian-write-failed）のみ使用
  errorMessage?: string;  // 失敗理由の詳細（UI表示用）
}
```

- TTL（`expiry`）は既存のヘッダーブロック系と同じ24時間を使用する
- 件数上限は設けない（既存同様、`expiry` 経過時の自動削除のみ）
- 本文やAI要約済みデータの保存は行わない（既存の再記録パスがURLからのライブ再取得でカバーするため）

## コンポーネント設計

### 1. `src/utils/pendingStorage.ts`（型拡張のみ）
- `PendingPage` 型に `errorMessage` を追加
- `addPendingPage` / `getPendingPages` / `removePendingPages` / `clearExpiredPages` は変更不要（型が広がるのみ）

### 2. `src/background/pipeline/RecordingPipeline.ts`（拡張）
- `buildErrorResult()`: 通知作成に加えて `addPendingPage({ url, title, timestamp: Date.now(), reason: 'pipeline-error', errorMessage: error.message, expiry: Date.now() + 24h })` を呼ぶ
- `buildResult()`: `context.errors` に `step === 'saveObsidian'` のエラーが含まれる場合、`addPendingPage({ url, title, timestamp: Date.now(), reason: 'obsidian-write-failed', errorMessage: <該当エラーのmessage>, expiry: Date.now() + 24h })` を呼ぶ

### 3. 再記録（変更なし・既存パスを再利用）
- `src/dashboard/historyPendingPanel.ts` / `src/popup/pendingPages.ts` の `executeRecord()` はそのまま使う（`force: true` で `MANUAL_RECORD` を送信 → `handleManualRecord()` がURL再取得 → パイプライン全体を再実行）
- 成功時は既存通り `removePendingPages([page.url])` が呼ばれる
- 失敗時は既存通り `showRecordError()` でエラー表示のみ行い、pendingエントリはそのまま一覧に残る（追加の実装は不要）

### 4. UI（表示ラベルのみ追加）
- `src/dashboard/historyFilters.ts` の `renderPendingReason()` に `pipeline-error` / `obsidian-write-failed` 用の日本語表示ラベルを追加する

## エラーハンドリング

- Service Worker終了時の永続化は既存の `chrome.storage.local` ベースの実装を踏襲するため対応不要
- 再記録失敗時は何もしない（pendingエントリは既存ロジックにより一覧に残り続け、ユーザーは再度「今すぐ記録」を押せる）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 記録失敗（pipeline-error） → pending表示 → 再記録 → 成功で除去
- Obsidian書き込み失敗（obsidian-write-failed） → pending表示 → 再記録 → 成功で除去

### 統合テスト
- `RecordingPipeline` の FATAL/RETRY失敗時に `pipeline-error` として正しい `errorMessage` でpending登録されること
- `RecordingPipeline` の `saveObsidian` のみ失敗時に `obsidian-write-failed` として正しい `errorMessage` でpending登録されること
- `RecordingPipeline` の `saveObsidian` 以外のBEST_EFFORTステップ（`saveLocalMarkdown`, `saveSqlite`, `saveMetadata`）が失敗した場合は `obsidian-write-failed` としてpending登録**されない**こと（スコープ外の誤検知防止）

### 単体テスト
- `PendingPage` 型拡張後の `pendingStorage.ts` の add/get/remove（既存テストの回帰確認、`errorMessage` フィールドを含むケースの追加）
- `renderPendingReason()` の新しいreason値（`pipeline-error` / `obsidian-write-failed`）の表示ラベル

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新（`docs/i18n-guide.md` 経由でreasonラベルの翻訳キーを追加）
