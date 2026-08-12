# Handler RegistryをComposition Rootへ移設する Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `service-worker.ts:290-318`にある`createMessageHandlerRegistry`呼び出しの28行の依存解決ロジックを新規モジュール`createMessageRegistryComposition.ts`に移し、`service-worker.ts`側の呼び出しを1〜2行に圧縮する。

**Architecture:** 新規ファイル`src/background/createMessageRegistryComposition.ts`が、`BackgroundServicesComposition`（`createBackgroundServices()`の戻り値）と、service-worker.ts固有の値（`dashboardSqliteHandler`, `autoSavedBadgeTabs`）を受け取り、内部で`hasPrivacyConsent`, `buildAllowedUrls`, `getSettings`, `isDomainAllowed`, `clearSettingsCache`, `updateActivity`, `lockSession`, `notifyAiTestProgress`, `RecordingCache.getPrivacyCache`を直接importして解決した上で、既存の`createMessageHandlerRegistry`（`src/background/handlers/createMessageHandlerRegistry.ts`、変更しない）を呼び出す。`initExportScheduler`/`updateConsentBadge`の動的import構造はそのまま維持する。

**Tech Stack:** TypeScript, Vitest（既存の`createMessageHandlerRegistry.test.ts`と同じDIパターンでテストする）

---

## 依存の全量確認（実装前のコード調査結果）

`service-worker.ts:290-318`で`createMessageHandlerRegistry`に渡している18個の依存の出所を1つずつ確認済み:

| 依存 | 出所 | 新モジュールでの扱い |
|---|---|---|
| `recordingLogic` | `services.recordingLogic`（`createBackgroundServices()`の戻り値） | `services`引数から取得 |
| `tabCache` | `services.tabCache` | `services`引数から取得 |
| `obsidian` | `services.obsidian` | `services`引数から取得 |
| `aiService` | `services.aiService` | `services`引数から取得 |
| `manualRecordDeps` | `services.manualRecordDeps` | `services`引数から取得 |
| `saveRecordDeps` | `services.saveRecordDeps` | `services`引数から取得 |
| `hasPrivacyConsent` | `src/popup/privacyConsent.js`からimport | 新モジュール内で直接import |
| `buildAllowedUrls` | `src/utils/storage.js`からimport | 新モジュール内で直接import |
| `getSettings` | `src/utils/storage.js`からimport | 新モジュール内で直接import |
| `isDomainAllowed` | `src/utils/domainUtils.js`からimport | 新モジュール内で直接import |
| `clearSettingsCache` | `src/utils/storage.js`からimport | 新モジュール内で直接import |
| `notifyAiTestProgress` | `src/background/aiTestProgressNotifier.js`からimport | 新モジュール内で直接import |
| `getPrivacyCache` | `RecordingCache.getPrivacyCache()`（`src/background/recordingCache.js`） | 新モジュール内で直接import |
| `updateActivity` | `src/background/sessionAlarmsManager.js`からimport | 新モジュール内で直接import |
| `lockSession` | `src/utils/storage.js`からimport | 新モジュール内で直接import |
| `autoSavedBadgeTabs` | service-worker.ts内で`createAutoSavedBadgeTabs()`により構築（182行目） | 引数として受け取る（service-worker.ts固有の状態のため） |
| `initExportScheduler` | service-worker.ts内で動的import + async関数として定義（307-310行目） | 新モジュール内に同じ動的import構造でハードコードする |
| `updateConsentBadge` | service-worker.ts内で動的import + async関数として定義（311-314行目） | 新モジュール内に同じ動的import構造でハードコードする |
| `generateWeeklySummary` | `services.reviewSummaryGenerator.generateWeeklySummary()` | `services`引数から取得 |
| `generateMonthlySummary` | `services.reviewSummaryGenerator.generateMonthlySummary()` | `services`引数から取得 |
| `dashboardSqliteHandler` | service-worker.ts内で`dashboardSqliteMessageHandler`として構築（277-288行目、SQLiteクライアント等に依存し値が複雑なため） | 引数として受け取る |

**引数として残るのは3つだけ**: `services`（`BackgroundServicesComposition`）、`dashboardSqliteHandler`、`autoSavedBadgeTabs`。他15個の関数依存は全て新モジュール内で直接解決する。

---

## File Structure

- Create: `src/background/createMessageRegistryComposition.ts`
- Create: `src/background/__tests__/createMessageRegistryComposition.test.ts`
- Modify: `src/background/service-worker.ts:290-320`（呼び出し部分のみ、他は変更しない）
- No changes: `src/background/handlers/createMessageHandlerRegistry.ts`（既存の単体テスト依存注入性を維持するため）

---

### Task 1: createMessageRegistryComposition.tsを新規作成する

**Files:**
- Create: `src/background/createMessageRegistryComposition.ts`
- Test: `src/background/__tests__/createMessageRegistryComposition.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/background/__tests__/createMessageRegistryComposition.test.ts`を新規作成:

```typescript
import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  hasPrivacyConsent: vi.fn().mockResolvedValue(true),
  buildAllowedUrls: vi.fn().mockReturnValue(new Set()),
  getSettings: vi.fn().mockResolvedValue({}),
  clearSettingsCache: vi.fn(),
  lockSession: vi.fn().mockResolvedValue(undefined),
  isDomainAllowed: vi.fn().mockResolvedValue(true),
  notifyAiTestProgress: vi.fn(),
  updateActivity: vi.fn().mockResolvedValue(undefined),
  getPrivacyCache: vi.fn().mockReturnValue(null),
}));

vi.mock('../../popup/privacyConsent.js', () => ({
  hasPrivacyConsent: hoisted.hasPrivacyConsent,
}));
vi.mock('../../utils/storage.js', () => ({
  buildAllowedUrls: hoisted.buildAllowedUrls,
  getSettings: hoisted.getSettings,
  clearSettingsCache: hoisted.clearSettingsCache,
  lockSession: hoisted.lockSession,
}));
vi.mock('../../utils/domainUtils.js', () => ({
  isDomainAllowed: hoisted.isDomainAllowed,
}));
vi.mock('../aiTestProgressNotifier.js', () => ({
  notifyAiTestProgress: hoisted.notifyAiTestProgress,
}));
vi.mock('../sessionAlarmsManager.js', () => ({
  updateActivity: hoisted.updateActivity,
}));
vi.mock('../recordingCache.js', () => ({
  RecordingCache: { getPrivacyCache: hoisted.getPrivacyCache },
}));

import { createMessageRegistryComposition } from '../createMessageRegistryComposition.js';

const registeredTypes = [
  'VALID_VISIT',
  'FETCH_URL',
  'MANUAL_RECORD',
  'PREVIEW_RECORD',
  'SAVE_RECORD',
  'CONTENT_CLEANSING_EXECUTED',
  'CHECK_DOMAIN',
  'TEST_CONNECTIONS',
  'TEST_OBSIDIAN',
  'TEST_AI',
  'GET_PRIVACY_CACHE',
  'ACTIVITY_UPDATE',
  'SESSION_LOCK_REQUEST',
  'PING',
  'REFRESH_LOCAL_MARKDOWN_SCHEDULER',
  'CONSENT_STATE_CHANGED',
  'GENERATE_REVIEW_SUMMARY',
  'LOG_FORWARD',
  'DASHBOARD_SQLITE',
] as const;

function makeServices() {
  const pipeline = {} as never;
  const manualRecordDeps = {
    isRecordingAllowed: vi.fn().mockResolvedValue(true),
    checkRateLimit: vi.fn(),
    fetchContent: vi.fn(),
    recordingPipeline: pipeline,
    getSettings: vi.fn().mockResolvedValue({}),
    setUrlContent: vi.fn(),
  };
  return {
    recordingLogic: { record: vi.fn().mockResolvedValue({ success: true }) },
    tabCache: { add: vi.fn(), update: vi.fn() },
    obsidian: { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) },
    aiService: { testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }) },
    manualRecordDeps,
    saveRecordDeps: { ...manualRecordDeps },
    reviewSummaryGenerator: {
      generateWeeklySummary: vi.fn().mockResolvedValue(true),
      generateMonthlySummary: vi.fn().mockResolvedValue(true),
    },
  } as never;
}

describe('createMessageRegistryComposition', () => {
  it('registers every production message type exactly once from BackgroundServicesComposition-shaped input', () => {
    const composition = createMessageRegistryComposition({
      services: makeServices(),
      dashboardSqliteHandler: vi.fn(),
      autoSavedBadgeTabs: { add: vi.fn(), has: vi.fn().mockReturnValue(false) },
    });

    expect(Object.keys(composition.handlers).sort()).toEqual([...registeredTypes].sort());
  });

  it('wires GET_PRIVACY_CACHE handler to RecordingCache.getPrivacyCache', async () => {
    const composition = createMessageRegistryComposition({
      services: makeServices(),
      dashboardSqliteHandler: vi.fn(),
      autoSavedBadgeTabs: { add: vi.fn(), has: vi.fn().mockReturnValue(false) },
    });
    const sendResponse = vi.fn();

    await composition.handlers.GET_PRIVACY_CACHE(
      {} as never,
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );

    expect(hoisted.getPrivacyCache).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/background/__tests__/createMessageRegistryComposition.test.ts`
Expected: FAIL（`../createMessageRegistryComposition.js`が存在しないため、モジュール解決エラー）

- [ ] **Step 3: 最小実装を書く**

`src/background/createMessageRegistryComposition.ts`を新規作成:

```typescript
/**
 * createMessageRegistryComposition
 * Protocol-side composition root for message handler registration.
 *
 * service-worker.ts previously inlined 18 dependencies (10 module-function
 * imports plus 8 fields off BackgroundServicesComposition) directly into a
 * createMessageHandlerRegistry() call. That call site is the only thing this
 * module replaces: it imports the module-function dependencies itself and
 * reduces the service-worker.ts call site to passing `services` plus the two
 * values service-worker.ts alone constructs (dashboardSqliteHandler,
 * autoSavedBadgeTabs). createMessageHandlerRegistry itself is untouched so its
 * existing unit tests keep injecting every dependency directly.
 */

import { createMessageHandlerRegistry, type MessageHandlerRegistryComposition } from './handlers/createMessageHandlerRegistry.js';
import type { MessageHandler } from './handlers/MessageHandlerRegistry.js';
import type { BackgroundServicesComposition } from './createBackgroundServices.js';
import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { buildAllowedUrls, getSettings, clearSettingsCache, lockSession } from '../utils/storage.js';
import { isDomainAllowed } from '../utils/domainUtils.js';
import { notifyAiTestProgress } from './aiTestProgressNotifier.js';
import { updateActivity } from './sessionAlarmsManager.js';
import { RecordingCache } from './recordingCache.js';

export interface MessageRegistryCompositionDeps {
  services: BackgroundServicesComposition;
  dashboardSqliteHandler: MessageHandler;
  autoSavedBadgeTabs: {
    add(tabId: number): void;
    has(tabId: number): boolean;
  };
}

export function createMessageRegistryComposition(
  deps: MessageRegistryCompositionDeps,
): MessageHandlerRegistryComposition {
  const { services, dashboardSqliteHandler, autoSavedBadgeTabs } = deps;

  return createMessageHandlerRegistry({
    recordingLogic: services.recordingLogic,
    tabCache: services.tabCache,
    obsidian: services.obsidian,
    aiService: services.aiService,
    manualRecordDeps: services.manualRecordDeps,
    saveRecordDeps: services.saveRecordDeps,
    hasPrivacyConsent: () => hasPrivacyConsent(),
    buildAllowedUrls: (settings) => buildAllowedUrls(settings),
    getSettings: () => getSettings(),
    isDomainAllowed: (url) => isDomainAllowed(url),
    clearSettingsCache: () => clearSettingsCache(),
    notifyAiTestProgress,
    getPrivacyCache: () => RecordingCache.getPrivacyCache(),
    updateActivity: () => updateActivity(),
    lockSession: () => lockSession(),
    autoSavedBadgeTabs,
    initExportScheduler: async () => {
      const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
      await initExportScheduler();
    },
    updateConsentBadge: async () => {
      const { updateConsentBadge } = await import('./consentBadge.js');
      await updateConsentBadge();
    },
    generateWeeklySummary: () => services.reviewSummaryGenerator.generateWeeklySummary(),
    generateMonthlySummary: () => services.reviewSummaryGenerator.generateMonthlySummary(),
    dashboardSqliteHandler,
  });
}
```

- [ ] **Step 4: テストを実行してPASSを確認する**

Run: `npx vitest run src/background/__tests__/createMessageRegistryComposition.test.ts`
Expected: PASS（2件）

- [ ] **Step 5: 型チェック**

Run: `npm run type-check`
Expected: エラーなし（`BackgroundServicesComposition`の`manualRecordDeps`/`saveRecordDeps`等の型が`MessageHandlerRegistryDeps`と整合していることを確認。型エラーが出た場合は`makeServices()`のモック型または`createMessageRegistryComposition`の型注釈を調整する）

- [ ] **Step 6: Commit**

```bash
git add src/background/createMessageRegistryComposition.ts src/background/__tests__/createMessageRegistryComposition.test.ts
git commit -m "feat(background): createMessageRegistryCompositionを新規作成し、handler registryの依存解決をservice-worker.tsから分離する準備をする"
```

---

### Task 2: service-worker.tsの呼び出しをcreateMessageRegistryCompositionに置き換える

**Files:**
- Modify: `src/background/service-worker.ts`

- [ ] **Step 1: importを追加し、290-318行目の呼び出しを置き換える**

`src/background/service-worker.ts`の49行目（`import { createMessageHandlerRegistry } from './handlers/createMessageHandlerRegistry.js';`の直後）に追加:

```typescript
import { createMessageRegistryComposition } from './createMessageRegistryComposition.js';
```

次に、290-318行目の以下のブロック:

```typescript
const messageRegistryComposition = createMessageHandlerRegistry({
  recordingLogic,
  tabCache,
  obsidian,
  aiService,
  manualRecordDeps,
  saveRecordDeps,
  hasPrivacyConsent: () => hasPrivacyConsent(),
  buildAllowedUrls: (settings) => buildAllowedUrls(settings),
  getSettings: () => getSettings(),
  isDomainAllowed: (url) => isDomainAllowed(url),
  clearSettingsCache: () => clearSettingsCache(),
  notifyAiTestProgress,
  getPrivacyCache: () => RecordingCache.getPrivacyCache(),
  updateActivity: () => updateActivity(),
  lockSession: () => lockSession(),
  autoSavedBadgeTabs,
  initExportScheduler: async () => {
    const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
    await initExportScheduler();
  },
  updateConsentBadge: async () => {
    const { updateConsentBadge } = await import('./consentBadge.js');
    await updateConsentBadge();
  },
  generateWeeklySummary: () => reviewSummaryGenerator.generateWeeklySummary(),
  generateMonthlySummary: () => reviewSummaryGenerator.generateMonthlySummary(),
  dashboardSqliteHandler: dashboardSqliteMessageHandler,
});
```

を、以下に置き換える:

```typescript
const messageRegistryComposition = createMessageRegistryComposition({
  services,
  dashboardSqliteHandler: dashboardSqliteMessageHandler,
  autoSavedBadgeTabs,
});
```

- [ ] **Step 2: 使われなくなったimportを削除する**

置き換え後、`hasPrivacyConsent`, `buildAllowedUrls`, `isDomainAllowed`, `clearSettingsCache`, `notifyAiTestProgress`, `RecordingCache`, `updateActivity`, `lockSession`が`service-worker.ts`の他の箇所でまだ使われているか確認する:

Run: `grep -n "hasPrivacyConsent\|buildAllowedUrls\|isDomainAllowed\|clearSettingsCache\|notifyAiTestProgress\|RecordingCache\|updateActivity\|lockSession" src/background/service-worker.ts`

**重要**: この計画作成時点の事前調査で、以下は290-318行以外でも使われていることを確認済み：
- `RecordingCache`: `restoreRecordingCacheOnWake`経由で間接的に使われる可能性があるため、importごと削除せず、grep結果を見て個別に判断する
- `getSettings`, `lockSession`は`../utils/storage.js`の`import`文（9-16行目）に他の識別子（`migrateToSingleSettingsObject`, `StorageKeys`）と同じ行にまとまっているため、**行ごと削除せず、使われなくなった識別子だけを`import`リストから削除する**

grep結果、いずれの識別子も290-318行以外で使われていない場合のみ、該当のimport文（1行目, 9-16行目, 17行目, 30行目, 32行目）から該当識別子を取り除く。他の識別子（`initializeSessionAlarms`, `migrateToSingleSettingsObject`, `StorageKeys`等）は残す。

- [ ] **Step 3: 型チェック**

Run: `npm run type-check`
Expected: エラーなし（未使用importがあれば`noUnusedLocals`等でエラーになる場合がある。エラーが出た識別子は削除する）

- [ ] **Step 4: service-worker.tsの既存テストを実行する**

Run: `npx vitest run src/background/__tests__/service-worker.test.ts src/background/__tests__/service-worker-message-validation.test.ts src/background/__tests__/service-worker-base64.test.ts`

Expected: PASS（既存のメッセージハンドラ登録の動作が変わっていないことを確認）

- [ ] **Step 5: プロジェクト全体のテストスイートを実行する**

Run: `npm test`
Expected: 全件PASS（`createMessageRegistryComposition`経由でも既存のメッセージハンドラ動作が変わらないことを確認）

- [ ] **Step 6: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "refactor(background): service-worker.tsのhandler registry依存解決をcreateMessageRegistryCompositionに委譲する"
```

---

### Task 3: 最終検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイート**

Run: `npm run validate`
Expected: 型チェック・全テストPASS

- [ ] **Step 3: service-worker.tsの行数削減を確認する**

Run: `wc -l src/background/service-worker.ts`

Task開始前は611行だった。290-318行の28行の依存解決コードが3行程度（import 1行 + 呼び出し4行）に置き換わるため、servicec-worker.ts全体では約24行減っていることを確認する（正確な削減幅は実装内容次第だが、増加していないことが必須）。

- [ ] **Step 4: PBIの受け入れ基準を1件ずつ確認する**

`pbi/2026-08-12-01-refactor-move-message-handler-registry-to-composition-root.md`の受け入れ基準:
- [ ] `createMessageHandlerRegistry`への依存解決ロジック（28行）がservice-worker.tsから排除され、新規compositionモジュールに移動している → Task 1・2で確認済み
- [ ] service-worker.ts側の呼び出しが1〜2行に圧縮されている → Task 2 Step 1で確認（実際には呼び出し自体は3〜4行になるが、依存解決ロジック自体は0行になっている点が本質。PBIの「1〜2行」は目安であり、実際の圧縮結果を報告に記載する）
- [ ] 既存のメッセージハンドラの動作が変わらない → Task 2 Step 4・5で確認
- [ ] 関連するテストが通る → Task 1・2・3で確認

---

## Self-Review結果

- **Spec coverage**: PBIの実装内容1〜3は全てTask 1・2でカバーされている。PBIの「受け入れ基準」4項目は全てTask 3 Step 4で個別確認する。
- **Placeholder scan**: 全ステップに実コード・実コマンドを記載済み。「TBD」等のプレースホルダーなし。ただしTask 2 Step 2は「grep結果を見て判断する」という条件分岐を含むが、これは未使用import削除という機械的な後片付け作業であり、判断基準（290-318行以外で使われているか）を明記しているためプレースホルダーには該当しない。
- **Type consistency**: `MessageRegistryCompositionDeps`の`services`型は`BackgroundServicesComposition`（`createBackgroundServices.ts`からimport）、`dashboardSqliteHandler`の型は`MessageHandler`（`handlers/MessageHandlerRegistry.ts`からimport）で、Task 1のコード内で一貫している。`createMessageHandlerRegistry`の引数名（`recordingLogic`, `tabCache`等）はTask 1のコードとPBI記載の既存実装（`handlers/createMessageHandlerRegistry.ts`）で完全に一致することを事前調査で確認済み。
