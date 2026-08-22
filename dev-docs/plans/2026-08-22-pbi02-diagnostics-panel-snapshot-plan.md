# diagnosticsPanel Snapshot リファクタリング 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** diagnosticsPanel（683行）を「collect() → DiagnosticsSnapshot → render(Snapshot)」の1 seam に再構成し、400行未満・getSettings/chrome.storage 直 import ゼロを達成する。

**Architecture:** データ収集は DiagnosticsCollector に完全集約（extInfo/divergence/settingsLoadFailed を追加、SQLite status のリトライを取り込み）。ボタン操作は新規 diagnosticsActions.ts へ分離。debugMode の読み書きは debugModeStore port 経由に統一。パネルは wiring + Snapshot 描画のみにする。

**Tech Stack:** TypeScript (ESM, nodeNext), Vitest + jsdom, 既存の dashboardSqliteService / retryWithExponentialBackoff / showConfirmDialog を再利用。

**設計書:** `dev-docs/plans/2026-08-22-pbi02-diagnostics-panel-snapshot-design.md`

---

## File Structure

| 操作 | ファイル | 責務 |
|---|---|---|
| Create | `src/dashboard/panels/diagnostic/debugModeStore.ts` | debugMode の読み書き port |
| Create | `src/dashboard/panels/diagnostic/diagnosticsActions.ts` | ボタンハンドラ8種（テスト3種+spike+破壊的操作3種+AI DL） |
| Modify | `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts` | Snapshot 拡張（extInfo/divergence/settingsLoadFailed）+ sqlite リトライ |
| Rewrite | `src/dashboard/panels/diagnostic/diagnosticsPanel.ts` | wiring + Snapshot 描画のみ（目標300〜350行） |
| Test | `__tests__/debugModeStore.test.ts` | 新規 |
| Test | `__tests__/DiagnosticsCollector.test.ts` | Snapshot 断言拡充 |
| Test | `__tests__/diagnosticsActions.test.ts` | 新規（confirm 回帰保険） |
| Test | `__tests__/diagnosticsPanel.lifecycle.test.ts` | 内容断言1件を強化（他19件無変更） |
| Doc | `dev-docs/DESIGN_SPECIFICATIONS.md` | §3 に diagnostics 構造を追記 |

---

### Task 1: debugModeStore 新規作成

**Files:**
- Create: `src/dashboard/panels/diagnostic/debugModeStore.ts`
- Test: `src/dashboard/panels/diagnostic/__tests__/debugModeStore.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/dashboard/panels/diagnostic/__tests__/debugModeStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDebugMode, setDebugMode } from '../debugModeStore.js';

describe('debugModeStore', () => {
  let storageGet: ReturnType<typeof vi.fn>;
  let storageSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storageGet = vi.fn();
    storageSet = vi.fn().mockResolvedValue(undefined);
    (global as unknown as Record<string, unknown>).chrome = {
      storage: { local: { get: storageGet, set: storageSet } },
    } as unknown as typeof chrome;
  });

  it('getDebugMode returns boolean from chrome.storage.local', async () => {
    storageGet.mockResolvedValue({ debugMode: true });
    await expect(getDebugMode()).resolves.toBe(true);
    expect(storageGet).toHaveBeenCalledWith('debugMode');
  });

  it('getDebugMode returns false when key is missing or falsy', async () => {
    storageGet.mockResolvedValue({});
    await expect(getDebugMode()).resolves.toBe(false);
    storageGet.mockResolvedValue({ debugMode: 'not-boolean' });
    await expect(getDebugMode()).resolves.toBe(true);
  });

  it('setDebugMode writes the value via chrome.storage.local.set', async () => {
    await setDebugMode(true);
    expect(storageSet).toHaveBeenCalledWith({ debugMode: true });
    await setDebugMode(false);
    expect(storageSet).toHaveBeenCalledWith({ debugMode: false });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/dashboard/panels/diagnostic/__tests__/debugModeStore.test.ts`
Expected: FAIL（`../debugModeStore.js` が存在しない）

- [ ] **Step 3: 最小実装を書く**

```typescript
// src/dashboard/panels/diagnostic/debugModeStore.ts
/**
 * debugModeStore — thin persistence port for the dashboard debug mode flag.
 * Centralizes the 'debugMode' storage key so neither the collector nor the
 * panel imports chrome.storage directly.
 */

const DEBUG_MODE_KEY = 'debugMode';

export async function getDebugMode(): Promise<boolean> {
  const result = await chrome.storage.local.get(DEBUG_MODE_KEY) as Record<string, unknown>;
  return Boolean(result[DEBUG_MODE_KEY]);
}

export async function setDebugMode(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [DEBUG_MODE_KEY]: value });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/dashboard/panels/diagnostic/__tests__/debugModeStore.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add src/dashboard/panels/diagnostic/debugModeStore.ts src/dashboard/panels/diagnostic/__tests__/debugModeStore.test.ts
git commit -m "feat: debugModeStore port を新設し debugMode キー直書きを集約"
```

---

### Task 2: DiagnosticsCollector 拡張（extInfo / divergence / settingsLoadFailed / sqlite リトライ）

**Files:**
- Modify: `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts`
- Test: `src/dashboard/panels/diagnostic/__tests__/DiagnosticsCollector.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

既存 `DiagnosticsCollector.test.ts` の先頭（import 文の直後）にモジュールモックを追加:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiagnosticsCollector } from '../DiagnosticsCollector.js';
import { StorageKeys } from '../../../../utils/storage/types.js';

vi.mock('../../dashboardSqliteService.js', () => ({
  getSqliteStatus: vi.fn(),
  getLogCount: vi.fn(),
}));
```

注: 既存3テストは全依存を注入しているためモック影響なし。`import { StorageKeys } ...` 行が重複しないよう、既存 import のない本ファイルでは新規に追加する。

ファイル末尾に新しい describe を追加:

```typescript
describe('DiagnosticsCollector — snapshot extensions', () => {
  const baseDeps = () => ({
    getLogCount: vi.fn().mockResolvedValue({ data: 1 }),
    checkBuiltInAiAvailability: vi.fn().mockResolvedValue(null),
    getStorageBytesInUse: vi.fn().mockResolvedValue(0),
    getDebugMode: vi.fn().mockResolvedValue(false),
    getManifest: vi.fn(() => ({ version: '0.0.0', name: 'collector-test' })),
  });

  it('flags settingsLoadFailed when getSettings rejects and falls back to defaults', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockRejectedValue(new Error('storage broken')),
      getSqliteStatus: vi.fn().mockResolvedValue(null),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.settingsLoadFailed).toBe(true);
    expect(snapshot.obsidian.protocol).toBe('https');
    expect(snapshot.obsidian.port).toBe('27124');
    expect(snapshot.obsidian.apiKey).toBe('');
    expect(snapshot.aiProviderDetails.length).toBe(1);
    expect(snapshot.aiProviderDetails[0]?.provider).toBe('gemini');
  });

  it('reports settingsLoadFailed false when settings load succeeds', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockResolvedValue({
        [StorageKeys.OBSIDIAN_PROTOCOL]: 'http',
        [StorageKeys.AI_PROVIDER]: 'ollama',
        [StorageKeys.OLLAMA_BASE_URL]: 'http://127.0.0.1:11434',
        [StorageKeys.OLLAMA_MODEL]: 'llama3',
      }),
      getSqliteStatus: vi.fn().mockResolvedValue(null),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.settingsLoadFailed).toBe(false);
    expect(snapshot.obsidian.protocol).toBe('http');
    expect(snapshot.aiProviderDetails).toEqual([
      { provider: 'ollama', model: 'llama3', label: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
    ]);
  });

  it('collects extInfo from injected getManifest', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockResolvedValue({}),
      getSqliteStatus: vi.fn().mockResolvedValue(null),
      getManifest: vi.fn(() => ({ version: '9.9.9', name: 'Yasumaro Test' })),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.extInfo).toEqual({ version: '9.9.9', name: 'Yasumaro Test' });
  });

  it.each([
    { strategy: 'opfs-async-main', fallback: true, dash: true, offscreen: true },
    { strategy: 'fallback', fallback: true, dash: false, offscreen: true },
    { strategy: 'opfs-sync-worker', fallback: false, dash: true, offscreen: false },
  ])('derives divergence for strategy=$strategy fallback=$fallback', async ({ strategy, fallback, dash, offscreen }) => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockResolvedValue({}),
      getSqliteStatus: vi.fn().mockResolvedValue({
        initialized: true, path: '/x.db', fallback, fts5: true,
      }),
      detectVfsStrategy: vi.fn(() => ({ strategy })),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.divergence).toEqual({
      dashboardDetectsOpfs: dash,
      offscreenUsesFallback: offscreen,
    });
  });

  it('maps per-provider settings into aiProviderDetails', async () => {
    const collector = new DiagnosticsCollector({
      ...baseDeps(),
      getSettings: vi.fn().mockResolvedValue({
        [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'openai' }, { provider: 'lm-studio' }],
        [StorageKeys.OPENAI_BASE_URL]: 'https://api.openai.com/v1',
        [StorageKeys.OPENAI_MODEL]: 'gpt-4o-mini',
        [StorageKeys.OPENAI_API_KEY]: 'sk-test',
        [StorageKeys.LM_STUDIO_BASE_URL]: 'http://localhost:1234',
        [StorageKeys.LM_STUDIO_MODEL]: 'qwen',
      }),
      getSqliteStatus: vi.fn().mockResolvedValue(null),
    } as any);

    const snapshot = await collector.collect();

    expect(snapshot.aiProviderDetails).toEqual([
      { provider: 'openai', model: 'gpt-4o-mini', label: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' },
      { provider: 'lm-studio', model: 'qwen', label: 'lm-studio', baseUrl: 'http://localhost:1234' },
    ]);
  });

  it('retries transient sqlite failures on the default path', async () => {
    const { getSqliteStatus } = await import('../../dashboardSqliteService.js');
    const mocked = vi.mocked(getSqliteStatus);
    mocked.mockReset();
    mocked.mockRejectedValueOnce(new Error('sw starting'))
      .mockResolvedValueOnce({
        initialized: true, path: 'OPFS:/y.db', fallback: false, fts5: true,
      } as Awaited<ReturnType<typeof getSqliteStatus>>);

    vi.useFakeTimers();
    try {
      // Only getSqliteStatus uses the default (retrying) path; everything else injected.
      const collector = new DiagnosticsCollector({
        ...baseDeps(),
        getSettings: vi.fn().mockResolvedValue({}),
      } as any);

      const promise = collector.collect();
      await vi.runAllTimersAsync();
      const snapshot = await promise;

      expect(mocked).toHaveBeenCalledTimes(2);
      expect(snapshot.sqlite?.initialized).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/dashboard/panels/diagnostic/__tests__/DiagnosticsCollector.test.ts`
Expected: FAIL — `settingsLoadFailed` / `extInfo` / `divergence` が undefined、リトライテストは call count 不一致

- [ ] **Step 3: Collector を拡張する**

`DiagnosticsCollector.ts` への変更。import ブロックに2行追加:

```typescript
import { retryWithExponentialBackoff } from '../../utils/retry.js';
import { getDebugMode } from './debugModeStore.js';
```

`DiagnosticsSnapshot` インターフェースに3フィールド追加（`aiProviderDetails` の後、`debugMode` の前に挿入）:

```typescript
  aiProviderDetails: ProviderDetail[];
  extInfo: { version: string; name: string };
  divergence: { dashboardDetectsOpfs: boolean; offscreenUsesFallback: boolean };
  settingsLoadFailed: boolean;
  debugMode: boolean;
```

`DiagnosticsCollectorDeps` に2依存追加:

```typescript
export interface DiagnosticsCollectorDeps {
  getSettings?: typeof getSettings;
  getSqliteStatus?: typeof getSqliteStatus;
  getLogCount?: typeof getLogCount;
  checkBuiltInAiAvailability?: typeof checkBuiltInAiAvailability;
  getStorageBytesInUse?: () => Promise<number>;
  getDebugMode?: () => Promise<boolean>;
  getManifest?: () => { version: string; name: string };
  detectVfsStrategy?: () => { strategy: string };
}
```

`collect()` 内の解決ブロックを置換。`getDebugMode` のデフォルトを store 経由に、`getSqliteStatusFn` のデフォルトをリトライ付きに:

```typescript
    const getSettingsFn = this.deps.getSettings ?? getSettings;
    const getSqliteStatusFn: typeof getSqliteStatus = this.deps.getSqliteStatus ?? (async () =>
      retryWithExponentialBackoff(() => getSqliteStatus(), { label: 'diagSqliteStatus', maxAttempts: 4 })
    );
    const getLogCountFn = this.deps.getLogCount ?? getLogCount;
    const checkBuiltInAiFn = this.deps.checkBuiltInAiAvailability ?? checkBuiltInAiAvailability;
    const getBytesInUse = this.deps.getStorageBytesInUse ?? (() => chrome.storage.local.getBytesInUse(null));
    const getDebugModeFn = this.deps.getDebugMode ?? getDebugMode;
    const getManifestFn = this.deps.getManifest ?? (() => chrome.runtime.getManifest());
    const detectVfsStrategyFn = this.deps.detectVfsStrategy ?? detectLiveVfsStrategy;
```

settings 取得を失敗フラグ付きに変更（Promise.all 内の該当行）:

```typescript
    let settingsLoadFailed = false;

    // Parallel gathering — faster than sequential awaits in the old panel
    const [settings, sqliteStatus, logCountResult, builtInAiResult, bytesUsed, debugMode] = await Promise.all([
      getSettingsFn().catch(() => {
        settingsLoadFailed = true;
        return {} as Record<string, unknown>;
      }),
      getSqliteStatusFn().catch(() => null),
      getLogCountFn().catch(() => ({ error: 'unavailable' } as unknown as Awaited<ReturnType<typeof getLogCount>>)),
      checkBuiltInAiFn().catch(() => null),
      getBytesInUse().catch(() => 0),
      getDebugModeFn().catch(() => false),
    ]);
```

divergence 計算ブロック（既存の try/void 部分）を差し替え:

```typescript
    // Divergence check (dashboard vs offscreen)
    let dashboardDetectsOpfs = false;
    try {
      const { strategy } = detectVfsStrategyFn();
      dashboardDetectsOpfs = strategy !== 'fallback';
    } catch { /* detectLiveVfsStrategy may fail */ }
    const offscreenUsesFallback = sqliteStatus?.fallback ?? false;
```

return 文を拡張:

```typescript
    return {
      storage: { bytesUsedKb, savedUrls },
      sqlite: sqliteStatus,
      deficiencies,
      builtInAi: builtInAiResult,
      obsidian: { protocol, port, apiKey, dailyPath },
      aiProviders,
      aiProviderDetails,
      extInfo: getManifestFn(),
      divergence: { dashboardDetectsOpfs, offscreenUsesFallback },
      settingsLoadFailed,
      debugMode,
    };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/dashboard/panels/diagnostic/__tests__/DiagnosticsCollector.test.ts`
Expected: PASS（既存3 + 新規6 = 9 tests）

- [ ] **Step 5: コミット**

```bash
git add src/dashboard/panels/diagnostic/DiagnosticsCollector.ts src/dashboard/panels/diagnostic/__tests__/DiagnosticsCollector.test.ts
git commit -m "feat: DiagnosticsSnapshot に extInfo/divergence/settingsLoadFailed を追加し sqlite 収集をリトライ付きに"
```

---

### Task 3: diagnosticsActions 新規作成

**Files:**
- Create: `src/dashboard/panels/diagnostic/diagnosticsActions.ts`
- Test: `src/dashboard/panels/diagnostic/__tests__/diagnosticsActions.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// src/dashboard/panels/diagnostic/__tests__/diagnosticsActions.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDiagnosticActions } from '../diagnosticsActions.js';
import type { DiagnosticActionElements } from '../diagnosticsActions.js';

vi.mock('../../dashboardSqliteService.js', () => ({
  runOpfsSpike: vi.fn(),
  migrateLogs: vi.fn(),
  backfillMetadata: vi.fn(),
  cleanupLegacyStorage: vi.fn(),
}));

vi.mock('../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock('../../builtInAiDiagnosticsService.js', () => ({
  startBuiltInAiDownload: vi.fn(),
}));

import { migrateLogs, cleanupLegacyStorage } from '../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';

function makeElements(): DiagnosticActionElements {
  const el = <T extends HTMLElement>(_id: string, tag = 'div'): T =>
    document.createElement(tag) as T;
  return {
    testObsidianBtn: el<HTMLButtonElement>('a', 'button'),
    testAiBtn: el<HTMLButtonElement>('b', 'button'),
    testSqliteBtn: el<HTMLButtonElement>('c', 'button'),
    opfsSpikeBtn: el<HTMLButtonElement>('d', 'button'),
    migrateBtn: el<HTMLButtonElement>('e', 'button'),
    backfillBtn: el<HTMLButtonElement>('f', 'button'),
    cleanupBtn: el<HTMLButtonElement>('g', 'button'),
    builtInAiDownloadBtn: el<HTMLButtonElement>('h', 'button'),
    connectionResult: el('r1'),
    sqliteResult: el('r2'),
    opfsSpikeResult: el('r3'),
    migrateResult: el('r4'),
    backfillResult: el('r5'),
    cleanupResult: el('r6'),
    builtInAiStats: el('r7'),
    builtInAiDownloadResult: el('r8'),
  };
}

describe('diagnosticsActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as unknown as Record<string, unknown>).chrome = {
      runtime: { sendMessage: vi.fn() },
    } as unknown as typeof chrome;
  });

  it('does not run cleanup when confirm dialog is cancelled', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.cleanupBtn!.click();
    await vi.waitFor(() => expect(showConfirmDialog).toHaveBeenCalled());

    expect(cleanupLegacyStorage).not.toHaveBeenCalled();
    expect(els.cleanupBtn!.disabled).toBe(false);
  });

  it('runs cleanup after confirmation and reports freed bytes', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    vi.mocked(cleanupLegacyStorage).mockResolvedValue({
      data: { removed: ['savedUrlsWithTimestamps'], totalBytes: 12345 },
    } as any);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.cleanupBtn!.click();
    await vi.waitFor(() => expect(els.cleanupResult!.textContent).toContain('12345'));
    expect(cleanupLegacyStorage).toHaveBeenCalledTimes(1);
  });

  it('runs migration after confirmation and reports counts', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    vi.mocked(migrateLogs).mockResolvedValue({
      data: { read: 10, inserted: 8, count: 10 },
    } as any);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.migrateBtn!.click();
    await vi.waitFor(() => expect(els.migrateResult!.textContent).toContain('inserted=8'));
  });

  it('shows obsidian test result from sendMessage response', async () => {
    vi.mocked(globalThis.chrome.runtime.sendMessage).mockResolvedValue({
      obsidian: { success: true, message: 'Connected to Obsidian' },
    });
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.testObsidianBtn!.click();
    await vi.waitFor(() => expect(els.connectionResult!.textContent).toContain('Obsidian'));
    expect(els.testObsidianBtn!.disabled).toBe(false);
  });

  it('calls onBuiltInAiDownloaded hook after download completes', async () => {
    const startBuiltInAiDownloadModule = await import('../../builtInAiDiagnosticsService.js');
    vi.mocked(startBuiltInAiDownloadModule.startBuiltInAiDownload).mockImplementation(
      async (onProgress?: (percent: number) => void) => {
        onProgress?.(50);
        return { status: 'available' } as any;
      },
    );
    const els = makeElements();
    const hook = vi.fn();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: hook });

    els.builtInAiDownloadBtn!.click();
    await vi.waitFor(() => expect(hook).toHaveBeenCalledWith(expect.objectContaining({ status: 'available' })));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/dashboard/panels/diagnostic/__tests__/diagnosticsActions.test.ts`
Expected: FAIL（`../diagnosticsActions.js` が存在しない）

- [ ] **Step 3: diagnosticsActions.ts を実装する**

現行パネル mount() 内ハンドラ（407〜674行）を移植。完全なファイル:

```typescript
// src/dashboard/panels/diagnostic/diagnosticsActions.ts
/**
 * diagnosticsActions — user-triggered operations for the diagnostics panel.
 *
 * Owns every button click handler: the three connection tests, the OPFS spike,
 * the destructive maintenance operations (with confirm dialogs), and the
 * built-in AI model download. Data *collection* lives in DiagnosticsCollector;
 * this module only performs actions and renders their results.
 */

import { getMessage } from '../../../utils/i18n.js';
import { CURRENT_PROTOCOL_VERSION } from '../../../background/messageTypes.js';
import { UI_COLORS } from '../../../constants/appConstants.js';
import {
  runOpfsSpike,
  migrateLogs,
  backfillMetadata,
  cleanupLegacyStorage,
} from '../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import {
  startBuiltInAiDownload,
  type BuiltInAiDiagnosticsResult,
} from '../../builtInAiDiagnosticsService.js';
import { formatProviderHeadline, formatProviderDetailLines } from '../../aiTestResultView.js';

export interface DiagnosticActionElements {
  testObsidianBtn: HTMLButtonElement | null;
  testAiBtn: HTMLButtonElement | null;
  testSqliteBtn: HTMLButtonElement | null;
  opfsSpikeBtn: HTMLButtonElement | null;
  migrateBtn: HTMLButtonElement | null;
  backfillBtn: HTMLButtonElement | null;
  cleanupBtn: HTMLButtonElement | null;
  builtInAiDownloadBtn: HTMLButtonElement | null;
  connectionResult: HTMLElement | null;
  sqliteResult: HTMLElement | null;
  opfsSpikeResult: HTMLElement | null;
  migrateResult: HTMLElement | null;
  backfillResult: HTMLElement | null;
  cleanupResult: HTMLElement | null;
  builtInAiStats: HTMLElement | null;
  builtInAiDownloadResult: HTMLElement | null;
}

function successColor(): string {
  return `var(--color-success, ${UI_COLORS.CSS_SUCCESS_FALLBACK})`;
}

function errorColor(): string {
  return `var(--color-danger, ${UI_COLORS.CSS_ERROR_FALLBACK})`;
}

/**
 * Wire all action handlers. Each handler keeps the current behavior:
 * disable button → "Working..." → try/catch → result text → re-enable in finally.
 */
export function createDiagnosticActions(
  els: DiagnosticActionElements,
  hooks: { onBuiltInAiDownloaded: (result: BuiltInAiDiagnosticsResult) => void },
): void {
  const {
    testObsidianBtn, testAiBtn, testSqliteBtn, opfsSpikeBtn,
    migrateBtn, backfillBtn, cleanupBtn, builtInAiDownloadBtn,
    connectionResult, sqliteResult, opfsSpikeResult,
    migrateResult, backfillResult, cleanupResult,
    builtInAiStats, builtInAiDownloadResult,
  } = els;

  // Obsidian connection test
  testObsidianBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    testObsidianBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_OBSIDIAN',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        payload: {}
      }) as { obsidian?: { success: boolean; message: string } };

      const obsidian = testResult?.obsidian;
      connectionResult.textContent = obsidian
        ? `Obsidian: ${obsidian.success ? '✓' : '✗'} ${obsidian.message}`
        : getMessage('testComplete') || 'Test complete.';
      connectionResult.style.color = obsidian?.success ? successColor() : errorColor();
    } catch {
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.style.color = errorColor();
    } finally {
      testObsidianBtn.disabled = false;
    }
  });

  // AI connection test
  testAiBtn?.addEventListener('click', async () => {
    if (!connectionResult) return;
    testAiBtn.disabled = true;
    connectionResult.textContent = getMessage('testing') || 'Testing...';
    connectionResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'TEST_AI',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        payload: {}
      }) as { ai?: { success: boolean; message: string; providers?: Array<{ provider: string; model?: string; success: boolean; message: string; elapsedMs: number; debug?: { prompt?: string; response?: string; error?: string; availability?: string; hasContent?: boolean; statusCode?: number } }> } };

      const ai = testResult?.ai;
      if (ai) {
        connectionResult.innerHTML = '';

        if (ai.providers && ai.providers.length > 1) {
          // Multi-provider: show per-provider results
          const header = document.createElement('div');
          header.textContent = ai.success
            ? `AI: ${getMessage('testSuccess') || '✓ Connection successful'}`
            : `AI: ${getMessage('testFailed') || '✗ Connection failed'}`;
          header.className = ai.success ? 'diag-success diag-bold' : 'diag-error diag-bold';
          connectionResult.appendChild(header);

          for (const provider of ai.providers) {
            const row = document.createElement('div');
            row.className = 'diag-indent';
            row.textContent = formatProviderHeadline(provider);
            row.classList.add(provider.success ? 'diag-success' : 'diag-error');
            connectionResult.appendChild(row);

            for (const line of formatProviderDetailLines(provider)) {
              const detailRow = document.createElement('div');
              detailRow.className = 'diag-indent ai-debug-details';
              detailRow.textContent = line;
              connectionResult.appendChild(detailRow);
            }
          }
        } else {
          // Single provider: show simple result
          connectionResult.textContent = `AI: ${ai.success ? '✓' : '✗'} ${ai.message}`;
          connectionResult.className = `diag-result ${ai.success ? 'diag-success' : 'diag-error'}`;
        }
      } else {
        connectionResult.textContent = getMessage('testComplete') || 'Test complete.';
      }
    } catch (err) {
      console.error('Diagnostics: AI test failed', err);
      connectionResult.textContent = getMessage('testError') || 'Connection test failed.';
      connectionResult.className = 'diag-result diag-error';
    } finally {
      testAiBtn.disabled = false;
    }
  });

  // SQLite test
  testSqliteBtn?.addEventListener('click', async () => {
    if (!sqliteResult) return;
    testSqliteBtn.disabled = true;
    sqliteResult.textContent = getMessage('testing') || 'Testing...';
    sqliteResult.className = 'diag-result';

    try {
      const testResult = await chrome.runtime.sendMessage({
        type: 'DASHBOARD_SQLITE',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        payload: { subtype: 'status' }
      }) as { success: boolean; initialized?: boolean; fallback?: boolean; error?: string; initError?: string; fts5?: boolean };

      if (testResult.success) {
        if (testResult.initialized) {
          const fts5Text = testResult.fts5 ? 'FTS5 ✓' : 'LIKE fallback';
          sqliteResult.textContent = `✓ ${getMessage('diagSqliteTestOk') || 'SQLite is working correctly.'} (${fts5Text})`;
          sqliteResult.style.color = successColor();
        } else {
          const errorMsg = testResult.initError || testResult.error || 'SQLite initialization failed.';
          sqliteResult.textContent = `✗ ${getMessage('diagSqliteTestInitFailed') || 'SQLite initialization failed.'}\n${errorMsg}`;
          sqliteResult.style.color = errorColor();
        }
      } else {
        sqliteResult.textContent = `✗ ${testResult.error || 'SQLite test failed.'}`;
        sqliteResult.style.color = errorColor();
      }
    } catch {
      sqliteResult.textContent = getMessage('testError') || 'Connection test failed.';
      sqliteResult.style.color = errorColor();
    } finally {
      testSqliteBtn.disabled = false;
    }
  });

  // OPFS feasibility spike
  opfsSpikeBtn?.addEventListener('click', async () => {
    if (!opfsSpikeResult) return;
    opfsSpikeBtn.disabled = true;
    opfsSpikeResult.textContent = getMessage('testing') || 'Testing...';
    opfsSpikeResult.className = 'diag-result';

    try {
      const result = await runOpfsSpike();
      if ('data' in result) {
        const report = result.data;
        const header = `${report.passed ? '✓' : '✗'} strategy=${report.strategy} (${report.durationMs}ms)`;
        const lines = report.steps.map(s => `  ${s.ok ? '✓' : '✗'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
        opfsSpikeResult.textContent = [header, ...lines].join('\n');
        opfsSpikeResult.style.color = report.passed ? successColor() : errorColor();
      } else {
        opfsSpikeResult.textContent = `✗ OPFS spike failed: ${result.error}`;
        opfsSpikeResult.style.color = errorColor();
      }
    } catch {
      opfsSpikeResult.textContent = getMessage('testError') || 'Spike failed.';
      opfsSpikeResult.style.color = errorColor();
    } finally {
      opfsSpikeBtn.disabled = false;
    }
  });

  // Migrate legacy history to SQLite (destructive-ish, confirmed)
  migrateBtn?.addEventListener('click', async () => {
    if (!migrateResult) return;
    const confirmed = await showConfirmDialog({
      title: getMessage('diagMigrateBtn') || 'Convert history to SQLite',
      message: getMessage('diagMigrateConfirm') || 'Convert legacy browsing history into SQLite. The original chrome.storage data is preserved (you can clean it up separately from the diagnostics panel).',
      confirmLabel: getMessage('diagMigrateConfirmLabel') || 'Convert',
      cancelLabel: getMessage('cancel') || 'Cancel',
    });
    if (!confirmed) return;

    migrateBtn.disabled = true;
    migrateResult.textContent = getMessage('testing') || 'Working...';
    migrateResult.className = 'diag-result';

    try {
      const result = await migrateLogs();
      if ('data' in result) {
        migrateResult.textContent = `✓ ${getMessage('diagMigrateDone') || 'Conversion complete.'} read=${result.data.read} inserted=${result.data.inserted} total=${result.data.count}`;
        migrateResult.style.color = successColor();
      } else {
        migrateResult.textContent = `✗ ${getMessage('diagMigrateFailed') || 'Conversion failed.'}: ${result.error}`;
        migrateResult.style.color = errorColor();
      }
    } catch {
      migrateResult.textContent = `✗ ${getMessage('diagMigrateFailed') || 'Conversion failed.'}`;
      migrateResult.style.color = errorColor();
    } finally {
      migrateBtn.disabled = false;
    }
  });

  // Backfill diagnostic metadata
  backfillBtn?.addEventListener('click', async () => {
    if (!backfillResult) return;
    backfillBtn.disabled = true;
    backfillResult.textContent = getMessage('testing') || 'Working...';
    backfillResult.className = 'diag-result';

    try {
      const result = await backfillMetadata();
      if ('data' in result) {
        backfillResult.textContent = `✓ ${getMessage('diagBackfillDone') || 'Backfill complete.'} updated=${result.data.updated}/${result.data.total}`;
        backfillResult.style.color = successColor();
      } else {
        backfillResult.textContent = `✗ ${getMessage('diagBackfillFailed') || 'Backfill failed.'}: ${result.error}`;
        backfillResult.style.color = errorColor();
      }
    } catch {
      backfillResult.textContent = `✗ ${getMessage('diagBackfillFailed') || 'Backfill failed.'}`;
      backfillResult.style.color = errorColor();
    } finally {
      backfillBtn.disabled = false;
    }
  });

  // Cleanup legacy storage (destructive, confirmed)
  cleanupBtn?.addEventListener('click', async () => {
    if (!cleanupResult) return;
    const confirmed = await showConfirmDialog({
      title: getMessage('diagCleanupBtn') || 'Delete legacy storage data',
      message: getMessage('diagCleanupConfirm') || 'Delete the original chrome.storage browsing history? This is a destructive operation. The data is already copied to SQLite.',
      confirmLabel: getMessage('diagCleanupConfirmLabel') || 'Delete',
      cancelLabel: getMessage('cancel') || 'Cancel',
    });
    if (!confirmed) return;

    cleanupBtn.disabled = true;
    cleanupResult.textContent = getMessage('testing') || 'Working...';
    cleanupResult.className = 'diag-result';

    try {
      const result = await cleanupLegacyStorage();
      if ('data' in result) {
        cleanupResult.textContent = `✓ ${getMessage('diagCleanupDone') || 'Cleanup complete.'} removed=${result.data.removed.length} keys, ${result.data.totalBytes} bytes freed`;
        cleanupResult.style.color = successColor();
      } else {
        cleanupResult.textContent = `✗ ${getMessage('diagCleanupFailed') || 'Cleanup failed.'}: ${result.error}`;
        cleanupResult.style.color = errorColor();
      }
    } catch {
      cleanupResult.textContent = `✗ ${getMessage('diagCleanupFailed') || 'Cleanup failed.'}`;
      cleanupResult.style.color = errorColor();
    } finally {
      cleanupBtn.disabled = false;
    }
  });

  // Built-in AI model download
  builtInAiDownloadBtn?.addEventListener('click', async () => {
    if (!builtInAiDownloadResult) return;
    builtInAiDownloadBtn.disabled = true;
    builtInAiDownloadResult.textContent = getMessage('diagBuiltInAiDownloadStarting') || 'Starting download... 0%';
    builtInAiDownloadResult.className = 'diag-result';

    try {
      const result = await startBuiltInAiDownload((percent) => {
        builtInAiDownloadResult.textContent = `${getMessage('diagBuiltInAiDownloading') || 'Downloading...'} ${percent}%`;
      });

      hooks.onBuiltInAiDownloaded(result);

      if (result.status === 'available') {
        builtInAiDownloadResult.textContent = `✓ ${getMessage('diagBuiltInAiDownloadDone') || 'Download complete.'}`;
        builtInAiDownloadResult.style.color = successColor();
      } else {
        builtInAiDownloadResult.textContent = `✗ ${getMessage('diagBuiltInAiDownloadFailed') || 'Download failed.'}`;
        builtInAiDownloadResult.style.color = errorColor();
      }
    } catch {
      builtInAiDownloadResult.textContent = `✗ ${getMessage('diagBuiltInAiDownloadFailed') || 'Download failed.'}`;
      builtInAiDownloadResult.style.color = errorColor();
    } finally {
      builtInAiDownloadBtn.disabled = false;
    }
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/dashboard/panels/diagnostic/__tests__/diagnosticsActions.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add src/dashboard/panels/diagnostic/diagnosticsActions.ts src/dashboard/panels/diagnostic/__tests__/diagnosticsActions.test.ts
git commit -m "feat: diagnosticsActions を新設しボタンハンドラ群をパネルから分離"
```

---

### Task 4: diagnosticsPanel 全面書き換え（Snapshot 描画 + wiring）

**Files:**
- Modify（全面置換）: `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`
- Test: `src/dashboard/panels/diagnostic/__tests__/diagnosticsPanel.lifecycle.test.ts`（内容断言1件のみ強化）

- [ ] **Step 1: パネル全体を次の内容で置換する**

```typescript
// src/dashboard/panels/diagnostic/diagnosticsPanel.ts
/**
 * diagnosticsPanel — render-only panel over DiagnosticsSnapshot.
 *
 * Data collection happens exclusively inside DiagnosticsCollector.collect().
 * This file renders each section from the snapshot and wires the interactive
 * handlers owned by diagnosticsActions. It must not import getSettings or
 * chrome.storage directly.
 */

import { getMessage } from '../../../utils/i18n.js';
import { PROVIDER_LABELS } from '../../../utils/aiProviderLabels.js';
import { makeStatRow, getSeverityLabel } from '../../diagnosticUtils.js';
import type { BuiltInAIAvailability } from '../../../background/builtInAIClient.js';
import type { BuiltInAiDiagnosticsResult } from '../../builtInAiDiagnosticsService.js';
import { type PanelLifecycle } from '../types.js';
import { diagnosticsCollector } from './DiagnosticsCollector.js';
import type { DiagnosticsSnapshot } from './DiagnosticsCollector.js';
import { getDebugMode, setDebugMode } from './debugModeStore.js';
import { createDiagnosticActions } from './diagnosticsActions.js';

/**
 * Renders the built-in AI availability row and toggles the download button.
 * Shared by initial load and the post-download refresh so both paths stay in sync.
 */
export function renderBuiltInAiStatus(
  statsEl: HTMLElement,
  downloadBtn: HTMLButtonElement | null,
  result: BuiltInAiDiagnosticsResult
): void {
  statsEl.innerHTML = '';

  const statusLabels: Record<BuiltInAIAvailability, string> = {
    available: getMessage('diagBuiltInAiAvailable') || 'Available',
    downloadable: getMessage('diagBuiltInAiDownloadable') || 'Model download required',
    downloading: getMessage('diagBuiltInAiDownloading') || 'Downloading...',
    unavailable: getMessage('diagBuiltInAiUnavailable') || 'Unavailable',
  };

  statsEl.appendChild(makeStatRow(
    getMessage('diagBuiltInAiStatus') || 'Status',
    statusLabels[result.status],
    result.status === 'unavailable'
  ));

  if (result.status === 'unavailable' && result.guidance) {
    const guidanceText = getMessage('diagBuiltInAiFlagGuidance', { flagName: result.guidance.flagName, flagUrl: result.guidance.url })
      || `Enable "${result.guidance.flagName}" at ${result.guidance.url}`;
    statsEl.appendChild(makeStatRow(getMessage('diagBuiltInAiGuidanceLabel') || 'Guidance', guidanceText));
  } else if (result.status === 'unavailable') {
    statsEl.appendChild(makeStatRow(
      getMessage('diagBuiltInAiGuidanceLabel') || 'Guidance',
      getMessage('diagBuiltInAiUnsupportedBrowser') || 'This browser does not support built-in AI.'
    ));
  }

  if (downloadBtn) {
    downloadBtn.classList.toggle('hidden', result.status !== 'downloadable');
  }
}

interface SectionElements {
  storageStats: HTMLElement | null;
  extInfo: HTMLElement | null;
  obsidianSettingsEl: HTMLElement | null;
  aiSettingsEl: HTMLElement | null;
  connectionResult: HTMLElement | null;
  sqliteStats: HTMLElement | null;
  diagDeficiencyStats: HTMLElement | null;
  diagBuiltInAiStats: HTMLElement | null;
  diagBuiltInAiDownloadBtn: HTMLButtonElement | null;
  diagCompileOptionsStats: HTMLElement | null;
  diagDivergenceWarning: HTMLElement | null;
  compileOptionsSection: HTMLElement | null;
}

function querySections(container: HTMLElement): SectionElements {
  return {
    storageStats: container.querySelector('#diagStorageStats') as HTMLElement | null,
    extInfo: container.querySelector('#diagExtInfo') as HTMLElement | null,
    obsidianSettingsEl: container.querySelector('#diagObsidianSettings') as HTMLElement | null,
    aiSettingsEl: container.querySelector('#diagAiSettings') as HTMLElement | null,
    connectionResult: container.querySelector('#diagConnectionResult') as HTMLElement | null,
    sqliteStats: container.querySelector('#diagSqliteStats') as HTMLElement | null,
    diagDeficiencyStats: container.querySelector('#diagDeficiencyStats') as HTMLElement | null,
    diagBuiltInAiStats: container.querySelector('#diagBuiltInAiStats') as HTMLElement | null,
    diagBuiltInAiDownloadBtn: container.querySelector('#diagBuiltInAiDownloadBtn') as HTMLButtonElement | null,
    diagCompileOptionsStats: container.querySelector('#diagCompileOptionsStats') as HTMLElement | null,
    diagDivergenceWarning: container.querySelector('#diagDivergenceWarning') as HTMLElement | null,
    compileOptionsSection: container.querySelector('#diagCompileOptionsSection') as HTMLElement | null,
  };
}

function clearSections(s: SectionElements): void {
  s.storageStats?.replaceChildren();
  s.extInfo?.replaceChildren();
  s.obsidianSettingsEl?.replaceChildren();
  s.aiSettingsEl?.replaceChildren();
  if (s.sqliteStats) {
    s.sqliteStats.replaceChildren();
    s.sqliteStats.textContent = getMessage('diagSqliteChecking') || 'Checking SQLite status...';
  }
  s.diagDeficiencyStats?.replaceChildren();
  s.diagBuiltInAiStats?.replaceChildren();
  s.diagBuiltInAiDownloadBtn?.classList.add('hidden');
  s.diagCompileOptionsStats?.replaceChildren();
  s.diagDivergenceWarning?.classList.add('hidden');
}

function renderObsidianSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el) return;

  if (snap.settingsLoadFailed) {
    el.textContent = getMessage('diagLoadError') || '設定の読み込みに失敗しました。';
    return;
  }

  const configuredLabel = getMessage('configured') || '(configured)';
  const notSetLabel = getMessage('notSet') || '(not set)';
  const o = snap.obsidian;

  el.appendChild(makeStatRow(getMessage('diagProtocol') || 'Protocol', o.protocol));
  el.appendChild(makeStatRow(getMessage('diagPort') || 'Port', o.port));
  el.appendChild(makeStatRow(getMessage('diagRestUrl') || 'REST API URL', `${o.protocol}://127.0.0.1:${o.port}`));
  el.appendChild(makeStatRow(getMessage('diagDailyPath') || 'Daily Note Path', o.dailyPath || (getMessage('defaultValue') || '(default)')));
  el.appendChild(makeStatRow(getMessage('diagApiKey') || 'API Key', o.apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !o.apiKey));
}

/** Providers that render per-provider setting rows in the AI section (matches the legacy if-chain). */
const KNOWN_DETAIL_PROVIDERS = new Set(['gemini', 'openai', 'openai2', 'lm-studio', 'ollama', 'openai-compatible']);

function renderAiSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el || snap.settingsLoadFailed) return;

  const providerLabels: Record<string, string> = PROVIDER_LABELS;
  const configuredLabel = getMessage('configured') || '(configured)';
  const notSetLabel = getMessage('notSet') || '(not set)';
  const details = snap.aiProviderDetails;

  if (details.length > 1) {
    el.appendChild(makeStatRow(
      getMessage('diagProvider') || 'Provider',
      `${details.length} providers (priority order)`
    ));
  }

  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const label = providerLabels[d.provider] || d.provider;
    const priorityLabel = details.length > 1 ? `#${i + 1} ` : '';
    const modelOverride = d.model ? ` [${d.model}]` : '';

    const providerGroup = document.createElement('div');
    providerGroup.className = details.length > 1 ? 'diag-provider-group' : '';

    providerGroup.appendChild(makeStatRow(`${priorityLabel}Provider`, `${label}${modelOverride}`));

    // Unknown providers render the header row only (legacy if-chain behavior).
    if (!KNOWN_DETAIL_PROVIDERS.has(d.provider)) {
      el.appendChild(providerGroup);
      continue;
    }

    const hasApiKey = d.apiKey !== undefined;
    if (hasApiKey && d.baseUrl !== undefined) {
      providerGroup.appendChild(makeStatRow('  Base URL', d.baseUrl || notSetLabel));
      providerGroup.appendChild(makeStatRow('  Model', d.model || notSetLabel));
      providerGroup.appendChild(makeStatRow('  API Key', d.apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !d.apiKey));
    } else if (d.baseUrl !== undefined) {
      providerGroup.appendChild(makeStatRow('  Base URL', d.baseUrl || notSetLabel));
      providerGroup.appendChild(makeStatRow('  Model', d.model || notSetLabel));
    } else {
      // gemini: model + API key only
      providerGroup.appendChild(makeStatRow('  Model', d.model || notSetLabel));
      providerGroup.appendChild(makeStatRow('  API Key', d.apiKey ? `${'•'.repeat(8)} ${configuredLabel}` : notSetLabel, !d.apiKey));
    }

    el.appendChild(providerGroup);
  }
}

function renderSqliteSection(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el) return;

  const st = snap.sqlite;
  if (!st) {
    el.textContent = getMessage('diagSqliteCheckFailed') || 'Failed to check SQLite status.';
    return;
  }

  const initializedText = st.initialized
    ? (getMessage('diagSqliteAvailable') || 'Available')
    : (getMessage('diagSqliteUnavailable') || 'Unavailable');
  el.appendChild(makeStatRow(getMessage('diagSqliteStatus') || 'Status', initializedText));
  el.appendChild(makeStatRow(getMessage('diagSqlitePath') || 'Path', st.path || '(none)'));
  const fallbackText = st.fallback
    ? (getMessage('diagSqliteFallbackYes') || 'Yes (using fallback storage)')
    : (getMessage('diagSqliteFallbackNo') || 'No (native SQLite)');
  el.appendChild(makeStatRow(getMessage('diagSqliteFallback') || 'Fallback Mode', fallbackText));
  el.appendChild(makeStatRow(getMessage('diagSqliteFts5') || 'FTS5 Search', st.fts5 ? '✓ Available' : '✗ Not available (LIKE fallback)'));

  // OPFS migration status
  if (st.opfsMigrationV2Done !== undefined) {
    const migrationLabel = getMessage('diagOpfsMigrationV2') || 'OPFS Data Migration';
    if (st.opfsMigrationV2Done) {
      const completed = st.opfsMigrationV2CompletedAt
        ? ` (${new Date(st.opfsMigrationV2CompletedAt).toLocaleString()})`
        : '';
      const count = st.opfsMigrationV2RecordCount
        ? ` — ${st.opfsMigrationV2RecordCount} records`
        : '';
      el.appendChild(makeStatRow(migrationLabel, `✓ Completed${completed}${count}`));
    } else if (st.opfsMigrationV2LastAttemptedAt) {
      const attempted = new Date(st.opfsMigrationV2LastAttemptedAt).toLocaleString();
      el.appendChild(makeStatRow(migrationLabel, `⏳ Pending (last attempt: ${attempted})`));
    } else {
      el.appendChild(makeStatRow(migrationLabel, '⏳ Pending'));
    }
  }

  if (st.compileOptionsSource) {
    el.appendChild(makeStatRow(getMessage('diagCompileOptionsSource') || 'Source', st.compileOptionsSource));
  }
  if (st.initError) {
    el.appendChild(makeStatRow('Init Error', st.initError));
  }
}

function renderCompileOptions(el: HTMLElement | null, snap: DiagnosticsSnapshot): void {
  if (!el) return;
  const options = snap.sqlite?.compileOptions;
  if (!options || !snap.debugMode) return;

  const source = snap.sqlite?.compileOptionsSource || 'unknown';
  el.appendChild(makeStatRow(getMessage('diagCompileOptionsSource') || 'Source', source));
  el.appendChild(makeStatRow('Total', String(options.length)));

  const ftsVfsOptions = options.filter(o => o.includes('FTS') || o.includes('VFS'));
  if (ftsVfsOptions.length > 0) {
    el.appendChild(makeStatRow(getMessage('diagCompileOptionsHighlight') || 'FTS/VFS related', ftsVfsOptions.join(', ')));
  }

  const allOptionsDetails = document.createElement('details');
  allOptionsDetails.className = 'advanced-details';
  allOptionsDetails.innerHTML = `
    <summary class="advanced-details-summary">All ${options.length} options</summary>
    <div class="advanced-details-content">
      <pre class="diag-compile-options-list">${options.join('\n')}</pre>
    </div>
  `;
  el.appendChild(allOptionsDetails);
}

export function createDiagnosticsPanel(): PanelLifecycle {
  let _container: HTMLElement | null = null;

  async function loadAndPopulate(): Promise<void> {
    const container = _container;
    if (!container) return;

    const sections = querySections(container);
    const snapshot = await diagnosticsCollector.collect();

    clearSections(sections);
    sections.compileOptionsSection?.classList.toggle('hidden', !snapshot.debugMode);

    renderObsidianSection(sections.obsidianSettingsEl, snapshot);
    renderAiSection(sections.aiSettingsEl, snapshot);

    if (sections.storageStats) {
      sections.storageStats.appendChild(makeStatRow(getMessage('diagStorageUsed') || 'Storage Used', `${snapshot.storage.bytesUsedKb} KB`));
      sections.storageStats.appendChild(makeStatRow(getMessage('diagSavedUrls') || 'Saved URLs', snapshot.storage.savedUrls));
    }

    renderSqliteSection(sections.sqliteStats, snapshot);

    if (sections.diagDeficiencyStats && snapshot.sqlite) {
      const deficiencies = snapshot.deficiencies;
      if (deficiencies.length === 0) {
        sections.diagDeficiencyStats.appendChild(makeStatRow(getMessage('diagDeficiencyNone') || 'No deficiencies — all features are enabled.', '✓'));
      } else {
        for (const item of deficiencies) {
          const severityLabel = getSeverityLabel(item.severity);
          const summaryText = getMessage(item.summaryKey) || item.id;
          sections.diagDeficiencyStats.appendChild(makeStatRow(`${summaryText} [${severityLabel}]`, getMessage(item.recommendedActionKey) || ''));
        }
      }
    }

    if (sections.diagBuiltInAiStats && snapshot.builtInAi) {
      renderBuiltInAiStatus(sections.diagBuiltInAiStats, sections.diagBuiltInAiDownloadBtn, snapshot.builtInAi);
    }

    renderCompileOptions(sections.diagCompileOptionsStats, snapshot);

    // Divergence warning: offscreen fell back while the dashboard still sees OPFS
    if (sections.diagDivergenceWarning
        && snapshot.divergence.offscreenUsesFallback
        && snapshot.divergence.dashboardDetectsOpfs) {
      sections.diagDivergenceWarning.classList.remove('hidden');
    }

    if (sections.extInfo) {
      sections.extInfo.appendChild(makeStatRow(getMessage('diagVersion') || 'Version', snapshot.extInfo.version));
      sections.extInfo.appendChild(makeStatRow(getMessage('diagExtName') || 'Extension', snapshot.extInfo.name));
    }

    if (sections.connectionResult) {
      sections.connectionResult.dataset['placeholder'] = getMessage('diagConnectionPlaceholder') || 'Click "Test Connection" to check the Obsidian API connection.';
    }
  }

  return {
    id: 'panel-diagnostics',
    category: 'diagnostic',
    async mount(container) {
      _container = container;

      const diagDebugModeToggle = container.querySelector('#diagDebugModeToggle') as HTMLInputElement | null;
      const compileOptionsSection = container.querySelector('#diagCompileOptionsSection') as HTMLElement | null;

      const debugMode = await getDebugMode();
      if (diagDebugModeToggle) {
        diagDebugModeToggle.checked = debugMode;
        diagDebugModeToggle.setAttribute('aria-checked', String(debugMode));
      }
      if (compileOptionsSection) {
        compileOptionsSection.style.display = debugMode ? '' : 'none';
      }

      diagDebugModeToggle?.addEventListener('change', async () => {
        const isOn = diagDebugModeToggle.checked;
        diagDebugModeToggle.setAttribute('aria-checked', String(isOn));
        await setDebugMode(isOn);
        if (compileOptionsSection) {
          compileOptionsSection.style.display = isOn ? '' : 'none';
        }
      });

      const sections = querySections(container);
      createDiagnosticActions(sections, {
        onBuiltInAiDownloaded: (result) => {
          if (sections.diagBuiltInAiStats) {
            renderBuiltInAiStatus(sections.diagBuiltInAiStats, sections.diagBuiltInAiDownloadBtn, result);
          }
        },
      });
    },
    async load() {
      await loadAndPopulate();
    },
    destroy() {
      _container = null;
    },
  };
}
```

- [ ] **Step 2: 型チェックとテストを実行**

Run: `npm run type-check && npx vitest run src/dashboard/panels/diagnostic/__tests__/diagnosticsPanel.lifecycle.test.ts src/dashboard/panels/diagnostic/__tests__/diagnosticsPanel-builtInAi.test.ts`
Expected: type-check PASS、lifecycle 19件 PASS、builtInAi 4件 PASS

- [ ] **Step 3: lifecycle テストの内容断言1件を強化**

`diagnosticsPanel.lifecycle.test.ts` の `'populates stats elements after load'` テストを置換:

```typescript
    it('populates extension info from manifest after load', async () => {
      await panel.mount(container);
      await panel.load?.();
      const extInfo = container.querySelector('#diagExtInfo');
      expect(extInfo?.textContent).toContain('6.7.61');
      expect(extInfo?.textContent).toContain('Yasumaro');
    });
```

- [ ] **Step 4: 行数目標とテストを確認**

Run: `wc -l src/dashboard/panels/diagnostic/diagnosticsPanel.ts && npx vitest run src/dashboard/panels/diagnostic`
Expected: 400行未満、diagnostic 配下の全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add src/dashboard/panels/diagnostic/diagnosticsPanel.ts src/dashboard/panels/diagnostic/__tests__/diagnosticsPanel.lifecycle.test.ts
git commit -m "refactor: diagnosticsPanel を collect() → Snapshot 描画の1 seam に再構成"
```

---

### Task 5: DESIGN_SPECIFICATIONS 更新

**Files:**
- Modify: `dev-docs/DESIGN_SPECIFICATIONS.md`（§3 UI Implementation Standards 内、末尾に小節追加）

- [ ] **Step 1: §3 の末尾（§4 の見出し直前）に次の小節を追加**

```markdown
### 3.1 Diagnostics Panel (collect → Snapshot → render)

The diagnostics panel follows a strict one-seam structure:

- **Collect:** `DiagnosticsCollector.collect(): Promise<DiagnosticsSnapshot>` is the single
  entry point for all diagnostic data (storage usage, SQLite status with retry,
  deficiencies, built-in AI, Obsidian settings, per-provider AI settings, ext info,
  VFS divergence, debug mode, settings-load failure flag). Chrome dependencies are
  injected as adapters so tests use plain fakes.
- **Render:** `diagnosticsPanel.ts` renders sections purely from the snapshot and must
  not import `getSettings` or `chrome.storage`.
- **Actions:** `diagnosticsActions.ts` owns all button handlers, including the confirm
  dialogs for destructive operations (migrate / cleanup).
- **Persistence:** the `debugMode` flag is read/written only through
  `debugModeStore.getDebugMode()/setDebugMode()`.
```

- [ ] **Step 2: コミット**

```bash
git add dev-docs/DESIGN_SPECIFICATIONS.md
git commit -m "docs: 診断パネルの collect → Snapshot → render 構造を DESIGN_SPECIFICATIONS に追記"
```

---

### Task 6: 全体検証ゲートと PBI 完了処理

**Files:**
- Modify: `pbi/2026-08-22-02-refactor-diagnostics-panel-deepening.md`（チェックボックス更新）
- Move: 同ファイル → `dev-docs/archived/pbi/`
- Modify: `pbi/00-INDEX.md`

- [ ] **Step 1: 全検証を実行**

```bash
npm run type-check && npm run lint && npm test && npm run build
```
Expected: 全て成功。テストは既存8320件 + 本計画の新規約14件

- [ ] **Step 2: PBI の受け入れ基準と DoD をすべて `[x]` に更新**

`pbi/2026-08-22-02-refactor-diagnostics-panel-deepening.md` の `- [ ]` をすべて `- [x]` に置換する（11件）。

- [ ] **Step 3: PBI をアーカイブし INDEX を更新**

```bash
git mv pbi/2026-08-22-02-refactor-diagnostics-panel-deepening.md dev-docs/archived/pbi/
```

`pbi/00-INDEX.md`:
1. 進行中テーブルから `[2026-08-22-02]` の行を削除
2. アーカイブ履歴の「2026-08-22 アーキテクチャ深掘り pass2 レジストリ完成 + MigrationService 分割」セクションに追記:

```markdown
- 2026-08-22-02-refactor-diagnostics-panel-deepening.md (RICE 160 — diagnosticsPanel 683行を collect() → DiagnosticsSnapshot → render の1 seam に再構成。収集は collector に完全集約（extInfo/divergence/settingsLoadFailed 追加、sqlite リトライ内蔵）、操作は diagnosticsActions へ分離、debugMode は port 経由。パネル400行未満・getSettings/chrome.storage 直 import ゼロ)
```

- [ ] **Step 4: コミット**

```bash
git add pbi/00-INDEX.md
git commit -m "docs: PBI 2026-08-22-02（diagnosticsPanel 深掘り）を完了としてアーカイブ"
```

（`git mv` がリネームを既にステージング済みのため、追加でステージするのは INDEX のみ）

- [ ] **Step 5: 知識グラフ更新**

```bash
graphify update .
```
