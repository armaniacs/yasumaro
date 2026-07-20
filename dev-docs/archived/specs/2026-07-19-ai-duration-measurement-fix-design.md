# Design: AI処理時間（aiDuration）計測ロジックの修正

**Date:** 2026-07-19
**Status:** Draft

---

## Architecture Overview

### Current State (Problem)

Popup UIの記録成功メッセージには「5.8秒 / AI: 3ms」のように、全体所要時間とAI処理時間が並記される（`src/popup/errorUtils.ts` の `formatSuccessMessage`）。全体所要時間は正しいが、AI処理時間が実態とかけ離れた極端に小さい値（数ms）になる不具合がある。

**原因の連鎖:**

1. `PREVIEW_RECORD` 処理では `PrivacyPipeline.process()` が `previewOnly=true` のとき、PIIマスキング完了直後（クラウドAI要約を呼ぶ**前**）に早期returnする（`src/background/privacyPipeline.ts:122-133`）。
2. しかし `aiDuration` の計測区間（`aiStartTime`〜`aiEndTime`）は `process()` 呼び出し全体を囲んでいる（`src/background/pipeline/steps/processPrivacyPipelineStep.ts:30-41`）。そのため実際にはローカルAI要約＋PIIマスキングのみの所要時間（数msのオーダー）が `aiDuration` として計測される。クラウドAI要約はこの時点でまだ呼ばれていない。
3. この誤った値が `previewResponse.aiDuration` としてpopupに返る。
4. ユーザーがプレビュー確認後、popupは `SAVE_RECORD` 送信時にこの値をそのままpayloadに乗せて送る（`src/popup/recordCurrentPage.ts:329`）。
5. `SAVE_RECORD` の実処理（`alreadyProcessed=true`）では、`useCloudAi` が `alreadyProcessed` を見ないため（`privacyPipeline.ts:150-152`）、ここで実際にクラウドAI要約が呼ばれる。
6. にもかかわらず `processPrivacyPipelineStep.ts:43` は `alreadyProcessed=true` のとき実測をスキップし、ステップ3で伝播してきた誤った値（`context.aiDuration`）をそのまま使い回す。

結果、**実際にクラウドAI要約を呼び出している所要時間はどこにも正しく計測されておらず**、UIにはプレビュー段階のローカル処理時間が「AI処理時間」として誤表示される。

```
Before:
  PREVIEW_RECORD:
    aiStartTime = performance.now()
    pipeline.process({ previewOnly: true })
      → ローカルAI + マスキングのみ実行、早期return（クラウドAI未呼び出し）
    aiEndTime = performance.now()
    aiDuration = aiEndTime - aiStartTime   // ← 数ms（クラウド抜き）

  popup: previewResponse.aiDuration をそのまま SAVE_RECORD payload に積んで送信

  SAVE_RECORD (alreadyProcessed=true):
    pipeline.process({ alreadyProcessed: true })
      → useCloudAi=true のため実際にクラウドAI要約を呼び出す（未計測）
    aiDuration = context.aiDuration   // ← プレビュー由来の誤った値を再利用
```

### Downstream Consumers（変更不要であることの確認）

graphify調査により、`aiDuration` は本設計が対象とする popup 表示だけでなく、以下の下流でも消費されていることが判明した。いずれも `context.aiDuration`（`processPrivacyPipelineStep.ts` が設定する値）を参照する構造であり、**値の出所を実測値に差し替えるだけで自動的に正しい値が伝わる**。これらのファイル自体への変更は不要。

- `src/background/pipeline/mappers/BrowsingLogRecordMapper.ts`: `ai_duration_ms: aiDuration ?? null` としてSQLite保存レコードに反映（`context.aiDuration` を参照）
- `src/background/pipeline/steps/saveMetadataStep.ts`: `setUrlAiDuration()` を介して `chrome.storage.local` にも二重保存（レガシー経路、`context.aiDuration` を参照）
- `src/dashboard/historyEntryRow.ts`: 履歴一覧の各行で「処理時間 X.X秒」として表示（保存済みSQLite値を参照するため、保存時点で正しい値であれば自動的に正しく表示される）
- `src/background/migrationService.ts`: 旧データ移行時に `entry.aiDuration` をそのままコピー（既存データの移行ロジックであり、今回の計測ロジック修正の影響を受けない）

これらは全て「`context.aiDuration` が正しい実測値であること」に依存しているだけで、本設計の Changes #1・#2（計測ロジックの修正）が適用されれば連鎖的に正しくなる。Changes #3〜#6 は popup↔background 間の誤った値の伝播経路（不要になった中継）を除去するものであり、下流の保存・表示ロジックには影響しない。

### Target State

`aiDuration` は常に**クラウドAI要約の実呼び出し区間のみ**を計測した値とする。計測は `PrivacyPipeline.process()` 内部、`aiService.generateSummary()`（L3呼び出し）の直前直後で行い、戻り値に含める。プレビュー段階では（クラウド呼び出しが発生しないため）計測しない。popup経由でのプレビュー値伝播は廃止し、`SAVE_RECORD` 実行時に必ず実測し直す。

```
After:
  PrivacyPipeline.process():
    previewOnly=true → 早期return、aiCallDurationMs は含めない（未呼び出しのため）
    L3クラウド呼び出し実行時のみ:
      aiCallStart = performance.now()
      aiResult = await this.aiService.generateSummary(...)
      aiCallDurationMs = performance.now() - aiCallStart
      → PrivacyPipelineResult.aiCallDurationMs にセットして返す

  processPrivacyPipelineStep.ts:
    aiDuration = pipelineResult.aiCallDurationMs  // 実測値をそのまま使用、alreadyProcessed分岐は削除

  popup: SAVE_RECORD payload から aiDuration フィールドを削除（伝播不要）
```

---

## Changes

### 1. `PrivacyPipeline.process()` でクラウドAI呼び出し区間を計測

`src/background/privacyPipeline.ts`:

```ts
// Before
if (sanitizedSettings.useCloudAi) {
  const aiResult = await this.aiService.generateSummary(processingText, {
    mode: 'full_pipeline',
    tagSummaryMode: options.tagSummaryMode,
    url,
  });
  return this._processCloudResult(aiResult, maskedCount, originalTokens, cleansedTokens);
}

// After
if (sanitizedSettings.useCloudAi) {
  const aiCallStart = performance.now();
  const aiResult = await this.aiService.generateSummary(processingText, {
    mode: 'full_pipeline',
    tagSummaryMode: options.tagSummaryMode,
    url,
  });
  const aiCallDurationMs = performance.now() - aiCallStart;
  return this._processCloudResult(aiResult, maskedCount, originalTokens, cleansedTokens, aiCallDurationMs);
}
```

`_processCloudResult` に `aiCallDurationMs` パラメータを追加し、戻り値の `PrivacyPipelineResult` に含める。`PrivacyPipelineResult` インターフェースに `aiCallDurationMs?: number` を追加。

`previewOnly` の早期return（122-133行目）はクラウド呼び出し前のため `aiCallDurationMs` を含めない（`undefined` のまま）。

### 2. `processPrivacyPipelineStep.ts` の計測ロジックを実測値の受け渡しに置き換え

`src/background/pipeline/steps/processPrivacyPipelineStep.ts`:

```ts
// Before
const aiStartTime = performance.now();
try {
  const pipelineResult = await pipeline.process(content || '', { ... });
  const aiEndTime = performance.now();
  const aiDuration = !alreadyProcessed ? aiEndTime - aiStartTime : context.aiDuration;
  ...

// After
try {
  const pipelineResult = await pipeline.process(content || '', { ... });
  const aiDuration = pipelineResult.aiCallDurationMs;
  ...
```

`aiStartTime`/`aiEndTime` のstep側計測と `alreadyProcessed` による値の使い回し分岐を削除する。`previewOnly=true` の場合、`aiDuration` は `undefined` のまま `result.aiDuration` にセットされる（クラウドAI未呼び出しのため計測値なし）。

### 3. popup → `SAVE_RECORD` の `aiDuration` 伝播を削除

`src/popup/recordCurrentPage.ts`（`runPreviewAndSave` 内、SAVE_RECORDメッセージ送信部）:

```ts
// Before
const result = await sendMessageWithRetry({
  type: 'SAVE_RECORD',
  payload: {
    ...
    aiDuration: previewResponse.aiDuration,
    ...
  }
});

// After
const result = await sendMessageWithRetry({
  type: 'SAVE_RECORD',
  payload: {
    ...
    // aiDuration フィールド削除
    ...
  }
});
```

### 4. `SAVE_RECORD` ハンドラでの `aiDuration` 受け渡しを削除

`src/background/handlers/messageHandlers.ts`（`createSaveRecordHandler`）:

```ts
// Before
const result = await pipeline.execute({
  ...
  alreadyProcessed: true,
  ...
  aiDuration: message.payload.aiDuration,
  ...
}, settings);

// After
const result = await pipeline.execute({
  ...
  alreadyProcessed: true,
  ...
  // aiDuration フィールド削除
  ...
}, settings);
```

### 5. `RecordingPipeline.execute()` の初期context伝播を削除

`src/background/pipeline/RecordingPipeline.ts`:

```ts
// Before
let context: RecordingContext = {
  data,
  settings,
  force: data.force || false,
  aiService: this.aiService,
  errors: [],
  // alreadyProcessed 時にプレビューから AI 処理時間を伝播
  aiDuration: data.aiDuration
};

// After
let context: RecordingContext = {
  data,
  settings,
  force: data.force || false,
  aiService: this.aiService,
  errors: [],
};
```

### 6. 型定義から不要になった `aiDuration` フィールドを削除

- `src/messaging/types.ts`: `RecordingData.aiDuration`（コメント「alreadyProcessed 時にプレビューから伝播させる」ごと削除）
- `src/background/messageTypes.ts`: `SaveRecordMessage.payload.aiDuration`
- `src/popup/mainTypes.ts`: `PreviewResponse.aiDuration` — 唯一の参照元は `recordCurrentPage.ts:329`（今回削除対象）のみと確認済みのため、あわせて削除する

---

## Data Flow Impact

| 段階 | Before | After |
|------|--------|-------|
| `PREVIEW_RECORD` | `aiDuration` = ローカル処理+マスキングの時間（誤り） | `aiDuration` = `undefined`（クラウド未呼び出しのため） |
| `SAVE_RECORD` | `aiDuration` = プレビュー由来の値を再利用（誤り） | `aiDuration` = クラウドAI呼び出しの実測値（正しい） |
| Popup成功メッセージ | 「5.8秒 / AI: 3ms」（誤り） | 「X秒 / AI: Y秒」（実測） |

`local_only` モード（クラウドAI未使用）の場合は `aiCallDurationMs` が常に `undefined` となり、`formatSuccessMessage` の `aiSucceeded` 判定により「AI要約失敗」相当のベースメッセージが選ばれる可能性がある。これは既存の意図通りの挙動（クラウドAI不使用時はAI処理時間欄を表示しない）であり、変更しない。

---

## Testing Strategy

- `src/background/__tests__/privacyPipeline.test.ts`（存在すれば）: `process()` がクラウドAI呼び出し時のみ `aiCallDurationMs` を返し、`previewOnly` 時は含まないことを確認するテストを追加。
- `src/background/pipeline/steps/__tests__/processPrivacyPipelineStep.test.ts`: `alreadyProcessed` 分岐や `aiStartTime`/`aiEndTime` に依存した既存テストを更新。`pipelineResult.aiCallDurationMs` をモックして `aiDuration` に正しく反映されることを確認。
- `src/popup/__tests__/recordCurrentPage.test.ts`: `SAVE_RECORD` payloadに `aiDuration` が含まれないことを確認（回帰防止）。
- 手動テスト: Masked Cloudモードで実際に記録を行い、popup成功メッセージの「AI: X」が体感時間（数百ms〜数秒オーダー）と一致することを確認。
