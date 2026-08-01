# PBI-01: Service Worker の init() を実際に呼び出す — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Service Worker 起動時に `init()` を呼び出し、アラーム登録・マイグレーション・マスターパスワードタイムアウトが確実に実行されるようにする。

**Architecture:** `entrypoints/background/index.ts` から `service-worker.ts` の `init()` を呼び出す。`init()` 内の fire-and-forget Promise に catch を追加し、未処理 rejection を防ぐ。テストは `service-worker.test.ts` でアラーム登録を検証する。

**Tech Stack:** TypeScript, WXT, Chrome Extension Manifest V3, Jest

---

### Task 1: Entrypoint から init() を呼び出す

**Files:**
- Modify: `entrypoints/background/index.ts`

- [ ] **Step 1: 既存 entrypoint を確認する**

Read `entrypoints/background/index.ts` and confirm it only imports the module without calling `init()`.

- [ ] **Step 2: named import + init() 呼び出しに変更する**

```typescript
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground({
  manifest: {
    persistent: false,
  },
  async main() {
    const { init } = await import('../../src/background/service-worker.js');
    init();
  },
});
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 4: ビルドを実行する**

Run: `npm run build`
Expected: PASS, `dist/chromium-mv3/background.js` contains `init()` call

- [ ] **Step 5: コミットする**

```bash
git add entrypoints/background/index.ts
git commit -m "fix: call service-worker init() from background entrypoint"
```

---

### Task 2: init() 内の fire-and-forget Promise を安全にする

**Files:**
- Modify: `src/background/service-worker.ts` (lines 126-136)

- [ ] **Step 1: 既存の dynamic import ブロックを確認する**

Read `src/background/service-worker.ts` lines 125-136.

- [ ] **Step 2: 各 dynamic import に catch を追加する**

```typescript
(async () => {
  try {
    const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
    await initExportScheduler();
  } catch (err) {
    logError('Failed to init export scheduler', { error: String(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
  }
})();

(async () => {
  try {
    const { initializeReviewSummaryAlarms, setupReviewSummaryAlarmListener } = await import('./reviewSummaryAlarm.js');
    await initializeReviewSummaryAlarms();
    setupReviewSummaryAlarmListener();
  } catch (err) {
    logError('Failed to init review summary alarms', { error: String(err) }, ErrorCode.INTERNAL_ERROR, 'service-worker');
  }
})();
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/background/service-worker.ts
git commit -m "fix: catch errors in service-worker init() fire-and-forget imports"
```

---

### Task 3: テストで init() 呼び出しを検証する

**Files:**
- Modify: `src/background/__tests__/service-worker.test.ts`

- [ ] **Step 1: 既存の `init` テストを確認する**

Read `src/background/__tests__/service-worker.test.ts` around line 1263.

- [ ] **Step 2: アラーム登録テストを追加する**

```typescript
describe('init()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.alarms.create as jest.Mock).mockClear();
  });

  it('creates required alarms', () => {
    serviceWorker.init();
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'yasumaro-daily-purge',
      { periodInMinutes: 1440 }
    );
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'yasumaro-offline-network-retry',
      { periodInMinutes: 5 }
    );
  });

  it('initializes session alarms', () => {
    const spy = jest.spyOn(sessionAlarmsManager, 'initializeSessionAlarms');
    serviceWorker.init();
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: テストを実行する**

Run: `npm test -- src/background/__tests__/service-worker.test.ts`
Expected: PASS

- [ ] **Step 4: コミットする**

```bash
git add src/background/__tests__/service-worker.test.ts
git commit -m "test: verify init() creates alarms and initializes session alarms"
```

---

### Task 4: 実ブラウザで動作確認

**Files:**
- Build output: `dist/chromium-mv3/`

- [ ] **Step 1: ビルドする**

Run: `npm run build`

- [ ] **Step 2: Chrome に拡張機能を読み込む**

Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select `dist/chromium-mv3/`.

- [ ] **Step 3: Service Worker の Alarms を確認する**

Open Service Worker inspector, go to Application > Alarms. Verify:
- `yasumaro-daily-purge`
- `yasumaro-offline-network-retry`

- [ ] **Step 4: コミットは不要**

No code changes.

---

## Self-Review

- **Spec coverage:** PBI-01 の受け入れ基準（init() 呼び出し、アラーム登録、session alarm 初期化、マイグレーション実行）をすべてカバー
- **Placeholder scan:** TBD/TODO なし
- **Type consistency:** `init()` は `void` を返すまま、`main()` は `async` に変更

## Parallelizability

**中**
- `entrypoints/background/index.ts` と `src/background/service-worker.ts` は本PBI専用の変更領域
- PBI-08 も `service-worker.ts` を触るが、変更箇所は分離可能（alarm handler vs メッセージゲート）
- テストファイルは本PBI専用
