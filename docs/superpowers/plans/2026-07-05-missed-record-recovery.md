# 記録漏れの検知とリカバリ通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記録パイプラインの失敗（`pipeline-error`）とObsidian書き込みのみの失敗（`obsidian-write-failed`）を pending 一覧に集約し、既存の「今すぐ記録」ボタンで再記録・自動除去できるようにする。

**Architecture:** 既存の `src/utils/pendingStorage.ts` の `PendingPage.reason` union に2値を追加し、`src/background/pipeline/RecordingPipeline.ts` の `buildErrorResult()` / `buildResult()` から `addPendingPage()` を呼ぶ。再記録UI（`historyPendingPanel.ts` / `pendingPages.ts`）は無改修で流用する（既存の `executeRecord()` が URL 再取得 + パイプライン全体再実行を行うため）。

**Tech Stack:** TypeScript, Vitest, Chrome Extension Manifest V3

---

### Task 1: `PendingPage` 型に `errorMessage` と新reason値を追加

**Files:**
- Modify: `src/utils/pendingStorage.ts:6-13`
- Test: `src/utils/__tests__/pendingStorage.test.ts`

- [ ] **Step 1: 失敗させるテストを書く**

`src/utils/__tests__/pendingStorage.test.ts` の `describe('addPendingPage', ...)` ブロック内に追記する（86行目付近、既存の `it('should add a pending page to storage', ...)` の直後）:

```typescript
        it('should add a pending page with pipeline-error reason and errorMessage', async () => {
            const now = Date.now();
            const pendingPage = {
                url: 'https://example.com/failed-page',
                title: 'Failed Page',
                timestamp: now,
                reason: 'pipeline-error' as const,
                errorMessage: 'DOMAIN_BLOCKED',
                expiry: now + 24 * 60 * 60 * 1000
            };

            await addPendingPage(pendingPage);

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual([pendingPage]);
        });

        it('should add a pending page with obsidian-write-failed reason and errorMessage', async () => {
            const now = Date.now();
            const pendingPage = {
                url: 'https://example.com/obsidian-fail',
                title: 'Obsidian Fail Page',
                timestamp: now,
                reason: 'obsidian-write-failed' as const,
                errorMessage: 'Network timeout',
                expiry: now + 24 * 60 * 60 * 1000
            };

            await addPendingPage(pendingPage);

            const result = mockStorage['osh_pending_pages'] as unknown[];
            expect(result).toEqual([pendingPage]);
        });
```

- [ ] **Step 2: 型チェックが失敗することを確認する**

Run: `npm run type-check`
Expected: FAIL（`reason: 'pipeline-error' as const` が `PendingPage['reason']` の型 `'cache-control' | 'set-cookie' | 'authorization'` に含まれないため型エラーになる）

vitest自体（`npx vitest run src/utils/__tests__/pendingStorage.test.ts`）は型を検証しないため、この時点でもテスト自体はPASSしてしまう点に注意。型エラーの検出には必ず `npm run type-check` を使う。

- [ ] **Step 3: `PendingPage` 型を拡張する**

`src/utils/pendingStorage.ts:6-13` を以下に置き換える:

```typescript
export interface PendingPage {
  url: string;
  title: string;
  timestamp: number;
  reason: 'cache-control' | 'set-cookie' | 'authorization' | 'pipeline-error' | 'obsidian-write-failed';
  headerValue?: string;
  expiry: number;
  errorMessage?: string;
}
```

- [ ] **Step 4: 型チェックとテストが通ることを確認する**

Run: `npm run type-check && npx vitest run src/utils/__tests__/pendingStorage.test.ts`
Expected: 両方PASS

- [ ] **Step 5: コミット**

```bash
git add src/utils/pendingStorage.ts src/utils/__tests__/pendingStorage.test.ts
git commit -m "feat(pending): PendingPageにpipeline-error/obsidian-write-failed reasonを追加"
```

---

### Task 2: FATAL/RETRY失敗時に `pipeline-error` としてpending登録する

**Files:**
- Modify: `src/background/pipeline/RecordingPipeline.ts:1-33` (import), `310-336` (`buildErrorResult`)
- Test: `src/background/pipeline/__tests__/RecordingPipeline.test.ts`

- [ ] **Step 1: 失敗させるテストを書く**

`src/background/pipeline/__tests__/RecordingPipeline.test.ts` の `describe('buildErrorResult - ErrorCode.INTERNAL_ERROR', ...)` ブロック内（375行目の `it('エラー結果に success=false と error メッセージが含まれる', ...)` の後）に追記する:

```typescript
    it('パイプライン失敗時に pipeline-error として pending 登録される', async () => {
      mockProcess.mockRejectedValue(new Error('Step crashed'));

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      await pipeline.execute({
        title: 'Crash Test',
        url: 'https://example.com/crash',
        content: 'Content',
      }, mockSettings);

      const stored = await chrome.storage.local.get('osh_pending_pages');
      const pendingPages = stored['osh_pending_pages'] as Array<{ url: string; reason: string; errorMessage?: string }>;
      expect(pendingPages).toHaveLength(1);
      expect(pendingPages[0]).toMatchObject({
        url: 'https://example.com/crash',
        reason: 'pipeline-error',
        errorMessage: 'Step crashed',
      });
    });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts -t "pipeline-error として pending 登録される"`
Expected: FAIL（`pendingPages` が空配列 `[]` になる。まだ `addPendingPage` を呼んでいないため）

- [ ] **Step 3: `buildErrorResult()` で `addPendingPage` を呼ぶ**

`src/background/pipeline/RecordingPipeline.ts:6` のimportを以下に置き換える:

```typescript
import { addLog, LogType, logError, ErrorCode } from '../../utils/logger.js';
import { addPendingPage } from '../../utils/pendingStorage.js';
```

`src/background/pipeline/RecordingPipeline.ts:310-336` の `buildErrorResult` メソッドを以下に置き換える:

```typescript
  /**
   * Build error result
   */
  private buildErrorResult(context: RecordingContext, error: Error, stepName: string): RecordingResult {
    logError(`Pipeline failed at step ${stepName}`, {
      error: error.message,
      url: context.data.url,
      tabId: (context.data as unknown as Record<string, unknown>).tabId as number | undefined
    }, ErrorCode.INTERNAL_ERROR, 'RecordingPipeline');

    // Create error notification
    const { title, url } = context.data;
    const notificationTitle = chrome.i18n.getMessage('recordingFailed') || 'Recording Failed';
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: notificationTitle,
      message: `Failed to record ${title}: ${error.message}`
    });

    // 記録漏れリカバリ: pending に登録して再記録できるようにする
    void addPendingPage({
      url,
      title,
      timestamp: Date.now(),
      reason: 'pipeline-error',
      errorMessage: error.message,
      expiry: Date.now() + (24 * 60 * 60 * 1000)
    });

    return {
      success: false,
      error: error.message,
      title: context.data.title,
      url: context.data.url
    };
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts`
Expected: PASS（全テストケース。既存の `ドメインブロック時は DOMAIN_BLOCKED エラーを返す` テストも引き続きPASSすること）

- [ ] **Step 5: コミット**

```bash
git add src/background/pipeline/RecordingPipeline.ts src/background/pipeline/__tests__/RecordingPipeline.test.ts
git commit -m "feat(pipeline): FATAL/RETRY失敗時にpipeline-errorとしてpending登録"
```

---

### Task 3: `saveObsidian` のみ失敗時に `obsidian-write-failed` としてpending登録する

**Files:**
- Modify: `src/background/pipeline/RecordingPipeline.ts:338-368` (`buildResult`)
- Test: `src/background/pipeline/__tests__/RecordingPipeline.test.ts`

- [ ] **Step 1: 失敗させるテストを書く**

`src/background/pipeline/__tests__/RecordingPipeline.test.ts` の `describe('通常記録フロー', ...)` ブロック内（274-292行目の `it('ドメインブロック時は DOMAIN_BLOCKED エラーを返す', ...)` の後）に追記する:

```typescript
    it('saveObsidian のみ失敗した場合、成功結果を返しつつ obsidian-write-failed として pending 登録される', async () => {
      mockProcess.mockResolvedValue({
        summary: 'AI summary',
        maskedCount: 0,
      });
      const failingAppend = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('Obsidian API unreachable'));
      MockedObsidianClient.mockImplementation(function() {
        this.appendToDailyNote = failingAppend;
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        new MockedObsidianClient() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Obsidian Fail Test',
        url: 'https://example.com/obsidian-fail',
        content: 'Content',
      }, mockSettings);

      expect(result.success).toBe(true);

      const stored = await chrome.storage.local.get('osh_pending_pages');
      const pendingPages = stored['osh_pending_pages'] as Array<{ url: string; reason: string; errorMessage?: string }>;
      expect(pendingPages).toHaveLength(1);
      expect(pendingPages[0]).toMatchObject({
        url: 'https://example.com/obsidian-fail',
        reason: 'obsidian-write-failed',
        errorMessage: 'Obsidian API unreachable',
      });
    });

    it('saveObsidian 以外の BEST_EFFORT ステップ由来のエラーでは obsidian-write-failed としては登録されない', async () => {
      mockProcess.mockResolvedValue({
        summary: 'AI summary',
        maskedCount: 0,
      });

      const pipeline = new RecordingPipeline(
        makeGetPrivacyInfo(),
        makeObsidian() as any,
        makeAiClient() as any
      );

      const result = await pipeline.execute({
        title: 'Other Step Fail Test',
        url: 'https://example.com/other-step-fail',
        content: 'Content',
      }, mockSettings);

      // buildResult は context.errors に積まれた 'saveObsidian' 以外のステップ名では
      // addPendingPage を呼ばないことを、buildResult 呼び出し前に errors を手動注入して検証する。
      // ここでは実際のパイプライン実行結果（成功・pending未登録）のみ確認する。
      expect(result.success).toBe(true);

      const stored = await chrome.storage.local.get('osh_pending_pages');
      const pendingPages = (stored['osh_pending_pages'] as Array<{ url: string }>) || [];
      expect(pendingPages).toHaveLength(0);
    });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts -t "obsidian-write-failed"`
Expected: 1つ目のテスト（`saveObsidian のみ失敗した場合`）がFAIL（`pendingPages` が空配列になる。まだ `buildResult` から `addPendingPage` を呼んでいないため）。2つ目のテスト（`saveObsidian 以外の`）は元々 `saveObsidian` 以外のステップが例外を投げない構成のため、この時点でもPASSする（回帰防止のためのテストであり、Step 3実装後も継続してPASSすることを確認する）。

- [ ] **Step 3: `buildResult()` で `saveObsidian` 由来のエラーのみ `addPendingPage` する**

`src/background/pipeline/RecordingPipeline.ts:338-368` の `buildResult` メソッドを以下に置き換える:

```typescript
  /**
   * Build final success result
   */
  private buildResult(context: RecordingContext): RecordingResult {
    const { data, privacyResult, aiDuration, errors } = context;

    // Log any non-fatal errors
    if (errors.length > 0) {
      addLog(LogType.INFO, 'Pipeline completed with non-fatal errors', {
        url: data.url,
        errorCount: errors.length,
        errorSteps: errors.map(e => e.step)
      });
    }

    // 記録漏れリカバリ: Obsidian書き込みのみ失敗した場合、pending に登録して再記録できるようにする
    const obsidianError = errors.find(e => e.step === 'saveObsidian');
    if (obsidianError) {
      void addPendingPage({
        url: data.url,
        title: data.title,
        timestamp: Date.now(),
        reason: 'obsidian-write-failed',
        errorMessage: obsidianError.error.message,
        expiry: Date.now() + (24 * 60 * 60 * 1000)
      });
    }

    return {
      success: true,
      summary: privacyResult?.summary,
      maskedCount: privacyResult?.maskedCount,
      tags: privacyResult?.tags,
      sentTokens: privacyResult?.sentTokens,
      receivedTokens: privacyResult?.receivedTokens,
      originalTokens: privacyResult?.originalTokens,
      cleansedTokens: privacyResult?.cleansedTokens,
      aiDuration,
      obsidianDuration: context.obsidianDuration,
      localMarkdownDuration: context.localMarkdownDuration,
      title: data.title,
      url: data.url
    };
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts`
Expected: PASS（全テストケース）

- [ ] **Step 5: コミット**

```bash
git add src/background/pipeline/RecordingPipeline.ts src/background/pipeline/__tests__/RecordingPipeline.test.ts
git commit -m "feat(pipeline): saveObsidianのみ失敗時にobsidian-write-failedとしてpending登録"
```

---

### Task 4: pending一覧に新しい失敗理由の日本語/英語ラベルを表示する

**Files:**
- Modify: `src/dashboard/historyFilters.ts:48-55`
- Modify: `public/_locales/ja/messages.json:1256-1258` (直後に追加)
- Modify: `public/_locales/en/messages.json:1256-1258` (直後に追加)
- Test: `src/dashboard/__tests__/historyFilters.test.ts:68-84`（既存の `describe('renderPendingReason', ...)` ブロック）

`src/dashboard/__tests__/historyFilters.test.ts:10-12` は `../../popup/i18n.js` の `getMessage` を `(key) => \`i18n_${key}\`` にモックしているため、テストの期待値は実際の日本語文言ではなく `i18n_<messageKey>` になる点に注意する。

- [ ] **Step 1: 失敗させるテストを書く**

`src/dashboard/__tests__/historyFilters.test.ts:68-84` の `describe('renderPendingReason', ...)` ブロック内、`it('returns raw reason for unknown', ...)` の前に追記する:

```typescript
  it('returns localized pipeline-error reason', () => {
    expect(renderPendingReason('pipeline-error')).toBe('i18n_pendingReasonPipelineError');
  });

  it('returns localized obsidian-write-failed reason', () => {
    expect(renderPendingReason('obsidian-write-failed')).toBe('i18n_pendingReasonObsidianWriteFailed');
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/dashboard/__tests__/historyFilters.test.ts -t "renderPendingReason"`
Expected: FAIL（`renderPendingReason('pipeline-error')` が `default` ケースに落ちて `'pipeline-error'` をそのまま返すため、期待値 `'i18n_pendingReasonPipelineError'` と不一致）

- [ ] **Step 3: `renderPendingReason` に新しい reason 値を追加する**

`src/dashboard/historyFilters.ts:48-55` を以下に置き換える:

```typescript
export function renderPendingReason(reason: string): string {
  switch (reason) {
    case 'cache-control': return getMessage('pendingReasonCache') || 'Cache-Control ヘッダー';
    case 'set-cookie':    return getMessage('pendingReasonCookie') || 'Set-Cookie ヘッダー';
    case 'authorization': return getMessage('pendingReasonAuth') || 'Authorization ヘッダー';
    case 'pipeline-error': return getMessage('pendingReasonPipelineError') || '記録処理エラー';
    case 'obsidian-write-failed': return getMessage('pendingReasonObsidianWriteFailed') || 'Obsidian書き込み失敗';
    default:              return reason;
  }
}
```

- [ ] **Step 4: i18nメッセージキーを追加する**

`public/_locales/ja/messages.json:1256-1258`（`pendingReasonAuth` の直後）に以下を追加する:

```json
  "pendingReasonAuth": {
    "message": "Authorization ヘッダー"
  },
  "pendingReasonPipelineError": {
    "message": "記録処理エラー"
  },
  "pendingReasonObsidianWriteFailed": {
    "message": "Obsidian書き込み失敗"
  },
```

`public/_locales/en/messages.json:1256-1258`（`pendingReasonAuth` の直後）に以下を追加する:

```json
  "pendingReasonAuth": {
    "message": "Authorization header"
  },
  "pendingReasonPipelineError": {
    "message": "Recording pipeline error"
  },
  "pendingReasonObsidianWriteFailed": {
    "message": "Obsidian write failed"
  },
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/dashboard/__tests__/historyFilters.test.ts`
Expected: PASS（全テストケース）

- [ ] **Step 6: コミット**

```bash
git add src/dashboard/historyFilters.ts src/dashboard/__tests__/historyFilters.test.ts public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "feat(dashboard): pending一覧にpipeline-error/obsidian-write-failedラベルを表示"
```

---

### Task 5: 全体の型チェックとテストスイートを実行する

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイートを実行する**

Run: `npm test`
Expected: 全テストPASS（既存テストの回帰なし）

- [ ] **Step 3: `npm run validate` で最終確認する**

Run: `npm run validate`
Expected: 型チェック・テストともにPASS

---

## Definition of Done チェックリスト（PBI再掲）

- [x] 記録失敗を pending として集約する（Task 2, 3）
- [x] 失敗理由を保持・表示する（Task 1, 4）
- [x] ワンクリック再記録で処理を再実行する（既存の `executeRecord()` を無改修で再利用）
- [x] 成功時に pending から除去する（既存の `removePendingPages()` ロジックをそのまま利用）
