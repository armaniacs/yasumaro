# PBI-29→36→35: service-worker.ts 分割・DI化・状態永続化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Source PBIs（3件、同一ファイル対象のため統合計画とする）:**
> - `pbi/2026-07-26-29-refactor-service-worker-god-file-split.md`（God File分割）
> - `pbi/2026-07-25-36-refactor-service-worker-singleton-di.md`（シングルトンDI化）
> - `pbi/2026-07-25-35-fix-service-worker-state-persistence.md`（状態永続化）
>
> 3PBIとも`src/background/service-worker.ts`を対象とし、PBI-29自身が「実施順序: (1) ファイル分割 → (2) DI導入 → (3) 状態永続化」を推奨している。本計画はこの順序で3PBIをTaskとして直列に並べる。**Task 1（PBI-29）が完了するまでTask 2（PBI-36）に進まないこと。Task 2が完了するまでTask 3（PBI-35）に進まないこと。**

**Goal:** `service-worker.ts`（686行）を薄いエントリポイントに分割し（PBI-29）、モジュールレベルシングルトンを遅延初期化パターンに移行し（PBI-36）、再起動をまたぐ必要がある状態を`chrome.storage.session`に永続化する（PBI-35）。

**Architecture:** 段階的リファクタリング。各Taskの完了ごとにコミットし、ビルド・全テストが通る状態を維持する。一度に全部変えない。

**Tech Stack:** TypeScript, Vitest, Chrome Extension Manifest V3 Service Worker

---

## 現状分析（2026-07-27フェーズ0再調査で確定済み・再調査不要）

`service-worker.ts`は686行（PBI-29策定時の654行から機能追加で増加）。`src/background/handlers/`配下への責務分離は既に相当進んでおり（`messageHandlers.ts`, `MessageHandlerRegistry.ts`, `tabEventHandlers.ts`, `lifecycleHandlers.ts`, `notificationHandlers.ts`, `contextMenuHandlers.ts`, `dashboardSqliteHandlers.ts`が既存）、現在ファイルに残る責務は以下の5つ:

1. `init()`による起動オーケストレーション（85-133行）
2. クライアント/シングルトンのインスタンス化（197-233行、PBI-36の対象そのもの）
3. `MessageHandlerRegistry`へのハンドラー登録配線（243-437行）
4. `processOfflineNetworkQueue()`等のオフラインキュー再試行ロジック本体（443-490行）
5. `chrome.alarms`/`chrome.notifications`等のイベントリスナー登録本体（628-686行）

**新規発見（要事前対応）**: 211-212行に`import { RecordingPipeline } from './pipeline/RecordingPipeline.js';`という**未使用のimport文**が、シングルトン変数宣言の途中（`const migrationService = ...`の直後）に不自然に混入している。`RecordingPipeline`はファイル内で一度も使われていない。Task 1のStep 1でこれを削除する（分割作業の一部として整理する）。

---

## Task 1（PBI-29）: God File分割 — オフラインキュー処理の抽出

**Files:**
- Create: `src/background/offlineQueueProcessor.ts`
- Create: `src/background/__tests__/offlineQueueProcessor.test.ts`
- Modify: `src/background/service-worker.ts`

責務4（オフラインキュー再試行ロジック本体、443-490行の`processOfflineNetworkQueue()`）が最も依存の少ない責務のため、最初の抽出対象とする。

- [ ] **Step 0: 未使用importを削除する（分割着手前のクリーンアップ）**

```bash
grep -n "RecordingPipeline" src/background/service-worker.ts
```

211-212行の`// Import RecordingPipeline` コメントと `import { RecordingPipeline } from './pipeline/RecordingPipeline.js';` を削除する。

```bash
npm run type-check
```

Expected: エラーなし（未使用importの削除でビルドが壊れないことを確認）

- [ ] **Step 1: `processOfflineNetworkQueue()`の現在の実装を確認する**

```bash
sed -n '443,490p' src/background/service-worker.ts
```

`sharedOfflineNetworkQueue`, `recordingLogic`, `OfflineJob`型への依存を確認する。

- [ ] **Step 2: 失敗するテストを書く**

```typescript
// src/background/__tests__/offlineQueueProcessor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createOfflineQueueProcessor } from '../offlineQueueProcessor.js';

describe('createOfflineQueueProcessor', () => {
  it('retries obsidian_sync jobs via retryObsidianWriteOnly when summary is present', async () => {
    const retryObsidianWriteOnly = vi.fn().mockResolvedValue(true);
    const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
    const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
      await handler({
        type: 'obsidian_sync',
        payload: { title: 't', url: 'https://example.com', content: 'c', summary: 's' },
      });
    });

    const processQueue = createOfflineQueueProcessor({
      offlineNetworkQueue: { retryAll },
      recordingLogic: { record, retryObsidianWriteOnly },
    });

    await processQueue();

    expect(retryObsidianWriteOnly).toHaveBeenCalledWith({ title: 't', url: 'https://example.com', summary: 's', tags: undefined });
    expect(record).not.toHaveBeenCalled();
  });

  it('falls back to full record() pipeline for ai_summary jobs', async () => {
    const record = vi.fn().mockResolvedValue({ success: true, skipped: false });
    const retryObsidianWriteOnly = vi.fn();
    const retryAll = vi.fn(async (handler: (job: unknown) => Promise<boolean>) => {
      await handler({
        type: 'ai_summary',
        payload: { title: 't', url: 'https://example.com', content: 'c' },
      });
    });

    const processQueue = createOfflineQueueProcessor({
      offlineNetworkQueue: { retryAll },
      recordingLogic: { record, retryObsidianWriteOnly },
    });

    await processQueue();

    expect(record).toHaveBeenCalled();
    expect(retryObsidianWriteOnly).not.toHaveBeenCalled();
  });
});
```

Run: `npm test -- src/background/__tests__/offlineQueueProcessor.test.ts`
Expected: FAIL with "Cannot find module '../offlineQueueProcessor.js'"

- [ ] **Step 3: `offlineQueueProcessor.ts`を実装する（`service-worker.ts:443-490`をそのまま移植）**

```typescript
// src/background/offlineQueueProcessor.ts
/**
 * offlineQueueProcessor.ts
 * Retries queued offline-network jobs (obsidian_sync / ai_summary) on the
 * yasumaro-offline-network-retry alarm. Extracted from service-worker.ts
 * as part of the God File split (PBI-29).
 */
import type { OfflineJob } from './offlineNetworkQueue.js';
import type { RecordingData } from '../messaging/types.js';

interface OfflineNetworkQueueLike {
  retryAll(handler: (job: OfflineJob) => Promise<boolean>): Promise<void>;
}

interface RecordingLogicLike {
  record(data: RecordingData): Promise<{ success: boolean; skipped?: boolean }>;
  retryObsidianWriteOnly(job: { title: string; url: string; summary: string; tags?: string[] }): Promise<boolean>;
}

export interface OfflineQueueProcessorDeps {
  offlineNetworkQueue: OfflineNetworkQueueLike;
  recordingLogic: RecordingLogicLike;
}

export function createOfflineQueueProcessor(deps: OfflineQueueProcessorDeps): () => Promise<void> {
  return async function processOfflineNetworkQueue(): Promise<void> {
    await deps.offlineNetworkQueue.retryAll(async (job: OfflineJob) => {
      const payload = job.payload as {
        title: string;
        url: string;
        content: string;
        summary?: string;
        maskedCount?: number;
        tags?: string[];
      };

      if (job.type === 'obsidian_sync' && payload.summary) {
        try {
          return await deps.recordingLogic.retryObsidianWriteOnly({
            title: payload.title,
            url: payload.url,
            summary: payload.summary,
            tags: payload.tags,
          });
        } catch {
          return false;
        }
      }

      try {
        const result = await deps.recordingLogic.record({
          title: payload.title,
          url: payload.url,
          content: payload.content,
          force: true,
          skipDuplicateCheck: true,
          recordType: 'manual',
        } as RecordingData);
        return result.success && !result.skipped;
      } catch {
        return false;
      }
    });
  };
}
```

Run: `npm test -- src/background/__tests__/offlineQueueProcessor.test.ts`
Expected: PASS（2テスト）

- [ ] **Step 4: `service-worker.ts`を更新し、抽出した関数を使うよう配線する**

`service-worker.ts`から`processOfflineNetworkQueue`関数本体（443-490行）を削除し、代わりに以下を追加する（シングルトン初期化ブロックの近く、`recordingLogic`定義の後）:

```typescript
import { createOfflineQueueProcessor } from './offlineQueueProcessor.js';

// ...

const processOfflineNetworkQueue = createOfflineQueueProcessor({
  offlineNetworkQueue: sharedOfflineNetworkQueue,
  recordingLogic,
});
```

`chrome.alarms.onAlarm`リスナー内の`void processOfflineNetworkQueue();`呼び出し（677行付近）はそのまま変更不要（同名の変数を参照するだけになる）。

- [ ] **Step 5: 型チェック・全テストで検証する**

```bash
npm run type-check
npm test -- src/background/__tests__/offlineQueueProcessor.test.ts src/background/__tests__/service-worker.test.ts
```

Expected: 全てパス

- [ ] **Step 6: ビルドで検証する**

```bash
npm run build
```

Expected: 成功

---

## Task 2（PBI-36）: シングルトンの遅延初期化パターンへの移行

**Files:**
- Create: `src/background/tabCacheFactory.ts`（試験導入対象として`TabCache`から着手）
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/__tests__/service-worker.test.ts`

**前提**: Task 1が完了していること（ファイル分割後の方が対象範囲が明確になる）。

**方針**: PBIが推奨する通り、影響範囲の小さい`TabCache`から遅延初期化パターン（`getInstance()`関数）を試験導入する。全シングルトン（`ObsidianClient`, `AIClient`, `LocalAIClient`, `RecordingLogic`, `SqliteClient`）への展開は、`TabCache`でのパターン確立後に別Task（後続PBI）として扱う——本Taskでは1クライアントの試験導入までを完了の定義とする（PBI本文のDefinition of Doneと一致）。

- [ ] **Step 1: `TabCache`の現在のインスタンス化・依存関係を確認する**

```bash
grep -n "new TabCache\|tabCache\." src/background/service-worker.ts
cat src/background/tabCache.ts | head -30
```

`TabCache`のコンストラクタが`sessionStore`のみに依存していることを確認する（依存が単純なため試験導入に適している）。

- [ ] **Step 2: 失敗するテストを書く**

```typescript
// src/background/__tests__/tabCacheFactory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTabCacheInstance, resetTabCacheInstanceForTesting } from '../tabCacheFactory.js';

describe('tabCacheFactory', () => {
  beforeEach(() => {
    resetTabCacheInstanceForTesting();
  });

  it('returns the same instance on repeated calls (singleton via lazy init)', () => {
    const a = getTabCacheInstance();
    const b = getTabCacheInstance();
    expect(a).toBe(b);
  });

  it('does not instantiate TabCache at module load time', async () => {
    // Importing the module itself should not construct a TabCache — only
    // calling getTabCacheInstance() should. This is verified by the module
    // not throwing even before a SessionStore is available, since
    // construction is deferred until first call.
    const mod = await import('../tabCacheFactory.js');
    expect(typeof mod.getTabCacheInstance).toBe('function');
  });
});
```

Run: `npm test -- src/background/__tests__/tabCacheFactory.test.ts`
Expected: FAIL with "Cannot find module '../tabCacheFactory.js'"

- [ ] **Step 3: `tabCacheFactory.ts`を実装する**

```typescript
// src/background/tabCacheFactory.ts
/**
 * tabCacheFactory.ts
 * Lazy-initialization wrapper for TabCache, extracted from service-worker.ts
 * as a test case for the singleton-to-lazy-init migration (PBI-36). Once
 * this pattern proves out, the remaining clients (ObsidianClient, AIClient,
 * LocalAIClient, RecordingLogic, SqliteClient) can follow the same shape in
 * a follow-up PBI.
 */
import { TabCache } from './tabCache.js';
import { SessionStore } from './sessionStore.js';

let instance: TabCache | null = null;
let sessionStoreInstance: SessionStore | null = null;

export function getTabCacheInstance(): TabCache {
  if (!instance) {
    if (!sessionStoreInstance) {
      sessionStoreInstance = new SessionStore();
      SessionStore.registerSuspendHandler(sessionStoreInstance);
    }
    instance = new TabCache(sessionStoreInstance);
  }
  return instance;
}

/** Test-only: resets the singleton so each test starts with a fresh instance. */
export function resetTabCacheInstanceForTesting(): void {
  instance = null;
  sessionStoreInstance = null;
}
```

- [ ] **Step 4: `service-worker.ts`を更新し、`tabCache`をこのファクトリ経由に置き換える**

```typescript
// service-worker.ts の変更
import { getTabCacheInstance } from './tabCacheFactory.js';

// 削除: const tabCache = new TabCache(sessionStore);
// 削除: const sessionStore = new SessionStore(); ← tabCacheFactory側に移動したため
//       ただし sessionStore が他の箇所でも使われている場合は削除しないこと。
//       grep -n "sessionStore\." src/background/service-worker.ts で確認すること。

const tabCache = getTabCacheInstance();
```

**重要な確認事項**: `sessionStore`変数（161行）が`tabCache`以外の箇所（例: `rateLimiter`のコンストラクタ、`SessionStore.registerSuspendHandler`）でも使われているか必ず確認すること。使われている場合は`sessionStore`をそのまま残し、`tabCacheFactory.ts`内では別のSessionStoreインスタンスを作らず、`service-worker.ts`側の既存`sessionStore`を`getTabCacheInstance(sessionStore)`のように引数で渡す設計に変更すること（Step 3のシグネチャを`getTabCacheInstance(sessionStore: SessionStore): TabCache`に修正）。

```bash
grep -n "sessionStore" src/background/service-worker.ts
```

この結果を必ず確認してからStep 3, 4を実施すること。

- [ ] **Step 5: 型チェック・全テストで検証する**

```bash
npm run type-check
npm test -- src/background/__tests__/tabCacheFactory.test.ts src/background/__tests__/service-worker.test.ts
```

Expected: 全てパス

- [ ] **Step 6: ビルドで検証する**

```bash
npm run build
```

---

## Task 3（PBI-35）: isCacheInitializedのchrome.storage.session永続化

**Files:**
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/__tests__/service-worker.test.ts`

**前提**: Task 1, 2が完了していること。

**フェーズ0再調査での確認事項**: `ensureConfirmToken()`（167-194行）は既に`chrome.storage.session`への読み書きロジックを実装済みのため、本Taskで変更不要。対象は`isCacheInitialized`（231行）のみに絞る。`autoSavedBadgeTabs`（218行）についても、Step 1で永続化要否を精査すること。

- [ ] **Step 1: `isCacheInitialized`と`autoSavedBadgeTabs`の現在の用途を確認する**

```bash
grep -n "isCacheInitialized\|autoSavedBadgeTabs" src/background/service-worker.ts
```

`isCacheInitialized`がどこで読み書きされているか（見つからない場合、実は未使用の可能性もあるため、その場合は削除を検討し別途報告する）。`autoSavedBadgeTabs`は`handleValidVisit`のバッジ表示制御に使われており、タブが閉じられるまでの短命な状態のため、SW再起動をまたぐ永続化が本当に必要か判断する（バッジ表示はタブが生きている間の視覚的フィードバックであり、SW再起動時にリセットされても実害が小さい可能性がある）。

- [ ] **Step 2: 永続化要否の判断結果に基づき対応する**

`isCacheInitialized`が実際に「二重初期化防止フラグ」として機能している場合のみ、以下を実装する:

```typescript
const CACHE_INITIALIZED_KEY = 'serviceWorkerCacheInitialized';

async function loadCacheInitializedState(): Promise<boolean> {
  try {
    const stored = await chrome.storage.session.get(CACHE_INITIALIZED_KEY) as Record<string, boolean | undefined>;
    return stored[CACHE_INITIALIZED_KEY] ?? false;
  } catch {
    return false;
  }
}

async function saveCacheInitializedState(value: boolean): Promise<void> {
  try {
    await chrome.storage.session.set({ [CACHE_INITIALIZED_KEY]: value });
  } catch {
    // Best-effort; in-memory flag still protects this SW lifetime.
  }
}
```

`let isCacheInitialized = false;`の初期値を、SW起動時（`init()`関数内）で`loadCacheInitializedState()`から復元するよう変更する。`isCacheInitialized`への代入箇所（`= true`にする箇所を`grep`で特定）で、代入と同時に`saveCacheInitializedState(true)`も呼ぶよう変更する。

もしStep 1で「`isCacheInitialized`は実質未使用、または既に別の仕組みで代替されている」と判明した場合、このStepはスキップし、その旨をコミットメッセージに記録する。

- [ ] **Step 3: 失敗するテストを書く（Step 2で永続化を実装する場合のみ）**

```typescript
// src/background/__tests__/service-worker.test.ts に追記
it('persists isCacheInitialized to chrome.storage.session and restores it on next init', async () => {
  // chrome.storage.session をモックし、init() 呼び出し後に
  // chrome.storage.session.set が CACHE_INITIALIZED_KEY: true で呼ばれることを確認する。
  // 既存のテストファイルのモック設定パターンに倣うこと。
});
```

- [ ] **Step 4: 型チェック・全テストで検証する**

```bash
npm run type-check
npm test -- src/background/__tests__/service-worker.test.ts
```

- [ ] **Step 5: ビルドで検証する**

```bash
npm run build
```

---

## 全体検証（3Task完了後）

- [ ] `npm run type-check` が成功する
- [ ] `npm test` で全テストがパスする
- [ ] `npm run build` が成功する
- [ ] 実Chromeブラウザで拡張機能を読み込み、記録・AI要約・Obsidian連携・オフラインキュー・診断パネル等の主要機能が回帰していないことを手動確認する（3PBI共通の受け入れ基準）
- [ ] `pbi/00-INDEX.md` の該当3行（PBI-29, 36, 35）を更新する

## コミット方針

Task単位で個別コミットする（3コミット、この順序を厳守）:
1. `refactor(background): service-worker.tsからオフラインキュー処理を抽出し未使用importを削除`（Task 1）
2. `refactor(background): TabCacheを遅延初期化パターンへ移行（試験導入）`（Task 2）
3. `fix(background): isCacheInitializedをchrome.storage.sessionへ永続化`（Task 3、Step 1の判断次第で内容変わる）

## 実装者への注記

- 3Taskは**必ずこの順序で**実施すること（PBI-29が推奨し、フェーズ0再調査でも妥当性を確認済み）
- Task 2のStep 4（`sessionStore`の使い回し確認）は必ず実施すること。これを怠ると`SessionStore.registerSuspendHandler`が二重登録され、Service Worker再起動時の挙動が壊れるリスクがある
- Task 3は「本当に永続化が必要か」の判断をStep 1で必ず行うこと。PBI本文も「全ての変数を無条件にstorage.sessionへ移すのではない」と明記している
