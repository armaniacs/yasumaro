# Implementation Plan: Systematic Debugging Improvements

Based on: `systematic-debugging` skill analysis (2026-04-01)

## Root Cause Analysis Summary

| # | Root Cause | Impact | Files |
|---|-----------|--------|-------|
| ① | Content Script が `console.log` のみ使用 | CSP ブロック・抽出失敗の原因追跡不能 | `loader.ts`, `extractor.ts` |
| ② | Chrome API モックが成功ケースしか返さない | リトライロジックがテスト不能 | `jest.setup.ts` |
| ③ | retryHelper のエラーシナリオテスト不足 | 指数バックオフの動作未検証 | `retryHelper.test.ts` |
| ④ | PipelineError にリクエストコンテキスト欠如 | 複数タブ同時操作時のデバッグ困難 | `pipeline/types.ts`, `RecordingPipeline.ts` |

---

## Phase 1: Content Script に Logger 接続 (High)

**Root Cause:** `loader.ts:62`, `loader.ts:189`, `extractor.ts:207`, `extractor.ts:329-402` が `console.log/warn/error` のみ。構造化ログ、エラーコード、PII サニタイズの恩恵を受けていない。

**Pattern:** `src/utils/logger.ts` の `logInfo()`, `logWarn()`, `logError()` を既に使用している `src/background/` のモジュールと同じパターンに揃える。

### Task 1.1: loader.ts に Logger 追加

- [ ] `extractDomain()` の catch ブロック (line 62): `console.error` → `logWarn()` with `ErrorCode.CONTENT_EXTRACTION_FAILURE`
- [ ] dynamic import の catch ブロック (line 189, 201): 無視ではなく `logWarn()` with `ErrorCode.CONTENT_EXTRACTION_FAILURE` + source=`'loader'`
- [ ] `CHECK_DOMAIN` メッセージの失敗 (line 195): `logWarn()` with `ErrorCode.PERMISSION_REQUIRED`

**制約:** Content Script は `chrome.storage.local` にアクセス可能なため、Logger のバッチ書き込みは動作する。ただし `piiSanitizer.ts` のインポートが Content Script の CSP と衝突する可能性があるため、`sanitizeLogDetails` をバイパスする軽量版の `addLogSimple()` を追加するか、既存の `addLog()` が Content Script で動作するか確認が必要。

### Task 1.2: extractor.ts に Logger 追加

- [ ] `loadSettings()` の `console.log` (line 207): → `logInfo()` with source=`'extractor'`
- [ ] `checkVisitConditions()` の `console.log` (line 239): → `logDebug()` with source=`'extractor'`
- [ ] `reportValidVisit()` の `console.log` (line 329, 348): → `logInfo()` with source=`'extractor'`
- [ ] `reportValidVisit()` の `console.error` (line 384, 390): → `logError()` with `ErrorCode.INTERNAL_ERROR`
- [ ] `reportValidVisit()` の `console.warn` (line 402): → `logWarn()` with `ErrorCode.API_REQUEST_FAILURE`
- [ ] `console.info` (line 400): → `logInfo()` with source=`'extractor'`

### Task 1.3: Content Script 用 Logger の軽量化確認

- [ ] `piiSanitizer.ts` の import が Content Script (jsdom 外) で動作するかテスト
- [ ] 動作しない場合: `sanitizeLogDetails` をスキップする `contentLogError()` 等のラッパー関数を `logger.ts` に追加
- [ ] 動作する場合: そのまま `logError()` 等を使用

### Verification

```bash
npm test -- --testPathPattern="logger"
npm run type-check
npm build
# Chrome でロードして Content Script のログ出力を確認
```

---

## Phase 2: Chrome API モックにエラーシナリオ追加 (High)

**Root Cause:** `jest.setup.ts:143-147` の `chrome.runtime.sendMessage` モックが `callback()` を呼ぶだけで、`lastError` を設定しない。`chrome.runtime.lastError` のシミュレーションがテストセットアップごとに手動で行われる必要があり、一貫性がない。

**Pattern:** `retryHelper.test.ts` が `global.chrome.runtime.lastError = { message: '...' }` で手動設定しているパターンを `jest.setup.ts` に統合する。

### Task 2.1: jest.setup.ts の chrome.runtime.sendMessage 改善

- [ ] `sendMessage` モックを `Promise.resolve()` を返す形に変更（現状は callback のみ）
- [ ] `chrome.runtime.lastError` を自動的に処理するヘルパー関数を追加:
  ```typescript
  // テスト内で使用するエラーシミュレーションヘルパー
  const simulateSendMessageError = (message: string) => {
    chrome.runtime.lastError = { message };
  };
  const resetSendMessageError = () => {
    chrome.runtime.lastError = null;
  };
  ```
- [ ] `src/__tests__/types.ts` の `ChromeRuntimeMock` 型を更新

### Task 2.2: Content Script メッセージングのエラーモック

- [ ] `chrome.runtime.sendMessage` が `Receiving end does not exist` をスローするテストケース用のヘルパー追加
- [ ] `chrome.runtime.sendMessage` が `Extension context invalidated` をスローするテストケース用のヘルパー追加
- [ ] `chrome.runtime.sendMessage` が `No response received` を返すテストケース用のヘルパー追加

### Task 2.3: 既存テストへの適用確認

- [ ] `retryHelper.test.ts` の手動 `lastError` 設定を新しいヘルパーに移行
- [ ] 全テスト PASS 確認

### Verification

```bash
npm test
npm run type-check
```

---

## Phase 3: retryHelper のエラーシナリオテスト追加 (High)

**Root Cause:** `retryHelper.test.ts` は基本的なリトライと `isRetryableError` をテストしているが、以下のシナリオが不足:

1. **全リトライ可能パターンの個別テスト**: `Message port closed before a response was received`, `The extension context has been invalid` が未テスト
2. **指数バックオフの遅延時間検証**: 現状は `initialDelay: 0` で即時実行を確認するのみ
3. **リトライ中のエラー切り替わり**: リトライ中にエラーパターンが変わるケース
4. **カスタム backoffMultiplier の検証**: `maxDelay` キャップの動作確認

### Task 3.1: リトライ可能エラーパターンの個別テスト

- [ ] `Message port closed before a response was received` → リトライ確認
- [ ] `The extension context has been invalid` → リトライ確認
- [ ] 複数パターンの混合ケース（1回目: `Could not establish connection`, 2回目: `Message port closed`）

### Task 3.2: 指数バックオフの遅延時間検証

- [ ] `jest.useFakeTimers()` を使用して遅延時間を検証
- [ ] `initialDelay: 100, backoffMultiplier: 2` → 1回目リトライ: 100ms, 2回目: 200ms, 3回目: 400ms
- [ ] `maxDelay: 500` → 遅延が 500ms でキャップされることを確認

### Task 3.3: エッジケーステスト

- [ ] `chrome.runtime.sendMessage` が undefined を返すケース
- [ ] `chrome.runtime.sendMessage` が例外をスローするケース（lastError ではなく直接 throw）
- [ ] リトライ中に `chrome.runtime` が消えるケース（Extension context invalidated）

### Verification

```bash
npm test -- --testPathPattern="retryHelper"
```

---

## Phase 4: PipelineError にリクエストコンテキスト追加 (Medium)

**Root Cause:** `pipeline/types.ts:31-36` の `PipelineError` に `{step, error, strategy, timestamp}` はあるが、どの URL・タブ・セッションで発生したかのコンテキストがない。複数タブ同時操作時にどのリクエストでエラーが発生したか判別できない。

**Pattern:** `RecordingContext` には `data.url`, `data.tabId` が存在するため、`PipelineError` にそれらを追加する。

### Task 4.1: PipelineError 型拡張

- [ ] `pipeline/types.ts` の `PipelineError` に `context` フィールド追加:
  ```typescript
  export interface PipelineError {
    step: string;
    error: Error;
    strategy: ErrorStrategy;
    timestamp: number;
    context?: {
      url: string;
      tabId?: number;
      sessionId?: string;
    };
  }
  ```

### Task 4.2: RecordingPipeline でのコンテキスト注入

- [ ] `RecordingPipeline.ts:171-176` の `PipelineError` 作成時に `context` を追加:
  ```typescript
  const pipelineError: PipelineError = {
    step: step.name,
    error: error as Error,
    strategy: step.errorStrategy,
    timestamp: Date.now(),
    context: {
      url: context.data.url,
      tabId: context.data.tabId
    }
  };
  ```
- [ ] `buildErrorResult()` の `logError()` 呼び出しにも `tabId` を追加

### Task 4.3: 既存テストへの影響確認

- [ ] `pipeline/__tests__/` のテストで `PipelineError` をアサートしている箇所を更新
- [ ] `context` フィールドが optional なので既存テストは壊れないことを確認

### Verification

```bash
npm test -- --testPathPattern="pipeline"
npm run type-check
```

---

## 実行順序

| Step | Task | 依存 | 推定工数 |
|------|------|------|---------|
| 1 | Phase 1: Content Script Logger 接続 | なし | 2h |
| 2 | Phase 2: Chrome API モック改善 | なし | 1h |
| 3 | Phase 3: retryHelper テスト追加 | Step 2 | 1.5h |
| 4 | Phase 4: PipelineError コンテキスト | なし | 0.5h |

Step 1, 2, 4 は並列実行可能。Step 3 は Step 2 に依存。

---

## 最終検証

```bash
npm validate          # type-check + test
npm build             # ビルド確認
npm test:e2e          # E2E テスト
```
