# 設計: 記録漏れの検知とリカバリ通知

- 元PBI: [dev-docs/plans/2026-07-04-06-feat-missed-record-recovery.md](../../../dev-docs/plans/2026-07-04-06-feat-missed-record-recovery.md)
- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)

## 背景・現状分析

`src/utils/pendingStorage.ts` には既に pending 機構が存在するが、これは `checkPrivacyHeadersStep.ts` から呼ばれる **ヘッダーブロック専用**（`reason: 'cache-control' | 'set-cookie' | 'authorization'`）であり、実際の記録処理の失敗はカバーしていない。

`src/background/pipeline/RecordingPipeline.ts` の現状:

- FATAL/RETRY 戦略のステップ（`domainFilter`, `permission`, `trust`, `duplicate` 等）が失敗すると `buildErrorResult()` が呼ばれ、Chrome通知を出すだけで `success: false` を返す。**この失敗はどこにも永続化されず、通知を見逃すと記録漏れに気づけない。**
- BEST_EFFORT 戦略の `saveObsidian` ステップが失敗しても `context.errors` に積まれるだけで、パイプライン全体は `buildResult()` により `success: true` を返す。**Obsidianへの書き込みが実際には行われていないのに、UI上は成功したように見える。**

この2つの記録漏れパターンを、既存の pending 機構を拡張して一元的にカバーする。

## 対象スコープ

1. **`pipeline-error`**: FATAL/RETRYステップで失敗し `success: false` になったケース（パイプライン全体の失敗）
2. **`obsidian-write-failed`**: `saveObsidian` のみが BEST_EFFORT で失敗し、他は成功しているケース（部分的失敗）

両方を pending として集約し、ワンクリック再記録の対象とする。

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
  errorMessage?: string;           // 失敗理由の詳細（UI表示用）
  recordingData?: RecordingData;   // pipeline-error用: 最初から再実行するための元データ
  resumeData?: {                   // obsidian-write-failed用: AI処理済みデータを再利用
    summary?: string;
    tags?: string[];
    markdownContent: string;
  };
}
```

- TTL（`expiry`）は既存のヘッダーブロック系と同じ24時間を使用する
- 件数上限は設けない（既存同様、`expiry` 経過時の自動削除のみ）

### 再開ポイントの使い分け

| reason | 保持データ | 再記録時の動作 |
|---|---|---|
| `pipeline-error` | `recordingData`（元の RecordingData） | パイプライン全体を最初から再実行 |
| `obsidian-write-failed` | `resumeData`（AI要約済みmarkdown等） | AI・プライバシーパイプラインをスキップし、Obsidianへの書き込みのみリトライ |

AI要約済みデータを再利用することで、AI APIの再呼び出しによるコスト・レイテンシ・要約内容のブレを避ける。

## コンポーネント設計

### 1. `src/utils/pendingStorage.ts`（型拡張のみ）
- `PendingPage` 型に `errorMessage` / `recordingData` / `resumeData` を追加
- `addPendingPage` / `getPendingPages` / `removePendingPages` / `clearExpiredPages` は変更不要（型が広がるのみ）

### 2. `src/background/pipeline/RecordingPipeline.ts`（拡張）
- `buildErrorResult()`: 通知作成に加えて `addPendingPage({ reason: 'pipeline-error', recordingData: context.data, errorMessage: error.message, expiry: Date.now() + 24h, ... })` を呼ぶ
- `buildResult()`: `context.errors` に `saveObsidian` 由来のエラーが含まれる場合、`addPendingPage({ reason: 'obsidian-write-failed', resumeData: { summary: privacyResult?.summary, tags: privacyResult?.tags, markdownContent: context.markdown }, ... })` を呼ぶ（`context.markdown` は `formatMarkdownStep` の出力）

### 3. 再記録ハンドラ（新規: `src/background/pipeline/recoverPendingPage.ts`）
- `reason === 'pipeline-error'` → `recordingData` を使い `RecordingLogic.record()` をフル実行
- `reason === 'obsidian-write-failed'` → `resumeData.markdownContent` を `ObsidianClient.appendToDailyNote()` に直接渡す（`saveToObsidianStep` が内部で呼んでいるのと同じAPI）
- どちらも成功時は `removePendingPages([url])` を呼ぶ
- 再記録がさらに失敗した場合は、同一URLのエントリを一度 `removePendingPages` してから `addPendingPage` で再登録し、`timestamp`/`expiry`/`errorMessage` を更新する（既存の重複排除ロジックは「存在すれば何もしない」ため、明示的な差し替えが必要）

### 4. UI（変更は最小限）
- `src/popup/pendingPages.ts` と `src/dashboard/historyPendingPanel.ts` の再記録ボタンは既存のものをそのまま使う
- `src/dashboard/historyFilters.ts` の `renderPendingReason()` に `pipeline-error` / `obsidian-write-failed` 用の日本語表示ラベルを追加する

## エラーハンドリング

- Service Worker終了時の永続化は既存の `chrome.storage.local` ベースの実装を踏襲するため対応不要
- 再記録失敗時はpendingエントリを削除せず、理由・タイムスタンプを更新して一覧に残す

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 記録失敗（pipeline-error） → pending表示 → 再記録 → 成功で除去
- Obsidian書き込み失敗（obsidian-write-failed） → pending表示 → 再記録（AI再呼び出しなし） → 成功で除去

### 統合テスト
- `RecordingPipeline` の FATAL/RETRY失敗時に `pipeline-error` として正しいデータでpending登録されること
- `RecordingPipeline` の `saveObsidian` のみ失敗時に `obsidian-write-failed` として正しいresumeDataでpending登録されること
- 再記録ハンドラが reason ごとに正しい経路（フル再実行 / Obsidian書き込みのみ）を通ること

### 単体テスト
- `PendingPage` 型拡張後の `pendingStorage.ts` の add/get/remove（既存テストの回帰確認）
- 再記録失敗時のpendingエントリ更新（タイムスタンプ・expiry・errorMessageの上書き）

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新（`docs/i18n-guide.md` 経由でreasonラベルの翻訳キーを追加）
