# ローカル Markdown 書き出しタイミング選択 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローカル Markdown 自動書き出しのタイミングを「手動のみ / 即時（1分デバウンス） / アイドル時・30分ごと / 日付変更時」の4択で選べるようにする。

**Architecture:** 既存の `LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED`（真偽値）を `LOCAL_MARKDOWN_EXPORT_TIMING`（列挙型文字列）に置き換える。`chrome.downloads.download` を呼ぶ実処理を新規 `localMarkdownExportCore.ts` に抽出して3モードから共有し、`localMarkdownIdleFlusher.ts` はアラーム/リスナーの登録切り替えに専念させる。

**Tech Stack:** TypeScript, Vitest, Chrome Extension APIs (`chrome.alarms`, `chrome.idle`, `chrome.downloads`, `chrome.storage.local`)

**Spec:** `docs/superpowers/specs/2026-07-10-local-markdown-export-timing-design.md`

---

## Task 1: ストレージキーの追加とマイグレーション

**Files:**
- Modify: `src/utils/storage/types.ts:209-211` (StorageKeys 定義), `:373-375` (Settings インターフェース)
- Modify: `src/utils/storage/defaults.ts:151-153`
- Modify: `src/utils/storage.ts:601-770`（`getSettings()` 内の新旧2経路）
- Test: `src/utils/__tests__/storage-extra.test.ts`（既存ファイルに追記）

- [ ] **Step 1: `StorageKeys` に `LOCAL_MARKDOWN_EXPORT_TIMING` を追加**

`src/utils/storage/types.ts:209-211` を以下に変更（`LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED` は残す。マイグレーションで読むため削除しない）:

```typescript
    LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
    LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
    LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
```

`src/utils/storage/types.ts:373-375` を以下に変更:

```typescript
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: boolean;
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED]: boolean;
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING]: 'manual' | 'immediate' | 'idle' | 'daily';
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: string;
```

- [ ] **Step 2: デフォルト値を追加**

`src/utils/storage/defaults.ts:151-153` を以下に変更:

```typescript
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: false,
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED]: false,
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING]: 'idle',
    [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'Yasumaro',
```

- [ ] **Step 3: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし（`LOCAL_MARKDOWN_EXPORT_TIMING` を使っている箇所がまだないため既存コードには影響なし）

- [ ] **Step 4: マイグレーションの失敗する単体テストを書く**

`src/utils/__tests__/storage-extra.test.ts` の末尾に追記（ファイル冒頭の `describe`/`import` パターンは既存ファイルに合わせる。以下は追加する `describe` ブロックのみ）:

```typescript
describe('LOCAL_MARKDOWN_EXPORT_TIMING migration', () => {
  it('migrates AUTO_ENABLED=true to TIMING="idle" when TIMING is unset', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (keys: string[] | string) => {
        if (Array.isArray(keys) && keys.includes('yasumaro_settings_migrated')) {
          return {};
        }
        return {
          local_markdown_export_auto_enabled: true,
        };
      }
    );

    const settings = await getSettings();
    expect(settings.local_markdown_export_timing).toBe('idle');
  });

  it('migrates AUTO_ENABLED=false to TIMING="manual" when TIMING is unset', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (keys: string[] | string) => {
        if (Array.isArray(keys) && keys.includes('yasumaro_settings_migrated')) {
          return {};
        }
        return {
          local_markdown_export_auto_enabled: false,
        };
      }
    );

    const settings = await getSettings();
    expect(settings.local_markdown_export_timing).toBe('manual');
  });

  it('does not override an already-set TIMING value', async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (keys: string[] | string) => {
        if (Array.isArray(keys) && keys.includes('yasumaro_settings_migrated')) {
          return {};
        }
        return {
          local_markdown_export_auto_enabled: true,
          local_markdown_export_timing: 'daily',
        };
      }
    );

    const settings = await getSettings();
    expect(settings.local_markdown_export_timing).toBe('daily');
  });
});
```

**Important:** 既存の `storage-extra.test.ts` は `chrome.storage.local.get` のモック方法・`getSettings` の import 経路がファイルごとに異なる可能性がある。追記前に必ずファイル全体を読み、既存の `beforeEach`/`vi.mock` パターン（`SETTINGS_MIGRATED_KEY` の値、`getSettings` のキャッシュクリア方法）に合わせて上記モックを書き換えること。特に `getSettings()` は1秒キャッシュを持つため、テストごとに `_resetForTesting()` 相当のリセット関数があれば呼ぶ（`src/utils/storage.ts` 内で export されていなければ、`vi.resetModules()` + 動的 import でモジュール状態をリセットする）。

- [ ] **Step 5: テストを実行し失敗を確認**

Run: `npm test -- storage-extra`
Expected: FAIL（`local_markdown_export_timing` が `undefined` になる）

- [ ] **Step 6: マイグレーションロジックを実装**

`src/utils/storage.ts:629-639`（新方式パス）の直後に追記:

```typescript
        // LOCAL_MARKDOWN_EXPORT_TIMING が未設定の場合、既存の AUTO_ENABLED から導出（既存ユーザー向けマイグレーション）
        if (!(StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING in filteredSettings)) {
            const legacyAutoEnabled = merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED];
            merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = legacyAutoEnabled ? 'idle' : 'manual';
        }
```

`src/utils/storage.ts:701-705`（旧方式パス）の直後にも同様に追記:

```typescript
    // LOCAL_MARKDOWN_EXPORT_TIMING が未設定の場合、既存の AUTO_ENABLED から導出（既存ユーザー向けマイグレーション）
    if (!(StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING in settings)) {
        const legacyAutoEnabled = merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED];
        merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = legacyAutoEnabled ? 'idle' : 'manual';
    }
```

- [ ] **Step 7: テストを実行し成功を確認**

Run: `npm test -- storage-extra`
Expected: PASS

- [ ] **Step 8: 型チェックとコミット**

Run: `npm run type-check`
Expected: エラーなし

```bash
git add src/utils/storage/types.ts src/utils/storage/defaults.ts src/utils/storage.ts src/utils/__tests__/storage-extra.test.ts
git commit -m "feat(storage): LOCAL_MARKDOWN_EXPORT_TIMINGキーとAUTO_ENABLEDからのマイグレーションを追加"
```

---

## Task 2: 共通フラッシュ処理の抽出（`localMarkdownExportCore.ts`）

**Files:**
- Create: `src/background/localMarkdownExportCore.ts`
- Test: `src/background/__tests__/localMarkdownExportCore.test.ts`

- [ ] **Step 1: 失敗する単体テストを書く**

Create `src/background/__tests__/localMarkdownExportCore.test.ts`:

```typescript
/**
 * localMarkdownExportCore.test.ts
 * Shared flush logic used by immediate / idle / daily export timings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockStorageGet = vi.hoisted(() => vi.fn());
const mockDownload = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
  },
  getSettings: mockGetSettings,
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', ERROR: 'ERROR' },
}));

vi.mock('../pipeline/steps/saveLocalMarkdownStep.js', () => ({
  DAILY_BUFFER_PREFIX: 'local_export_',
  buildDailyMarkdown: vi.fn((date: string, entries: string[]) => `# ${date}\n${entries.join('\n')}`),
}));

vi.stubGlobal('chrome', {
  storage: { local: { get: mockStorageGet } },
  downloads: { download: mockDownload },
});

import { flushBufferedExports } from '../localMarkdownExportCore.js';

describe('flushBufferedExports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({ local_markdown_export_path: 'Yasumaro' });
  });

  it('downloads every buffered day when no filter is given', async () => {
    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-08': ['# a'],
      'local_export_2026-07-09': ['# b'],
    });

    await flushBufferedExports();

    expect(mockDownload).toHaveBeenCalledTimes(2);
  });

  it('downloads only days that pass the filter', async () => {
    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-08': ['# a'],
      'local_export_2026-07-09': ['# b'],
    });

    await flushBufferedExports((date) => date === '2026-07-08');

    expect(mockDownload).toHaveBeenCalledTimes(1);
    const [arg] = mockDownload.mock.calls[0];
    expect(arg.filename).toBe('Yasumaro/2026-07-08.md');
  });

  it('skips days with empty entries', async () => {
    mockStorageGet.mockResolvedValue({
      'local_export_2026-07-08': [],
    });

    await flushBufferedExports();

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('ignores non-buffer keys', async () => {
    mockStorageGet.mockResolvedValue({
      other_key: 'value',
    });

    await flushBufferedExports();

    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('swallows errors and does not throw', async () => {
    mockStorageGet.mockRejectedValue(new Error('storage failure'));

    await expect(flushBufferedExports()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

Run: `npm test -- localMarkdownExportCore`
Expected: FAIL（`../localMarkdownExportCore.js` が存在しない）

- [ ] **Step 3: `localMarkdownExportCore.ts` を実装**

Create `src/background/localMarkdownExportCore.ts`:

```typescript
/**
 * localMarkdownExportCore.ts
 * Shared "flush the buffered daily Markdown to a download" logic, used by
 * all three auto-export timings (immediate / idle / daily). Each timing
 * decides *when* to call this and *which* days to include via `filter`.
 */

import { getSettings, StorageKeys } from '../utils/storage.js';
import { addLog, LogType } from '../utils/logger.js';
import { DAILY_BUFFER_PREFIX, buildDailyMarkdown } from './pipeline/steps/saveLocalMarkdownStep.js';

/**
 * Download each buffered day's Markdown exactly once.
 * @param filter - optional predicate over the YYYY-MM-DD date string; when
 *   omitted, every buffered day with entries is flushed.
 */
export async function flushBufferedExports(
  filter?: (date: string) => boolean
): Promise<void> {
  try {
    const settings = await getSettings();
    const exportPath = (settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH] as string) || 'Yasumaro';

    const all = await chrome.storage.local.get();

    for (const key of Object.keys(all)) {
      if (!key.startsWith(DAILY_BUFFER_PREFIX)) continue;

      const date = key.slice(DAILY_BUFFER_PREFIX.length);
      if (filter && !filter(date)) continue;

      const entries = all[key];
      if (!Array.isArray(entries) || entries.length === 0) continue;

      const content = buildDailyMarkdown(date, entries);
      const dataUrl = `data:text/markdown;base64,${btoa(unescape(encodeURIComponent(content)))}`;

      await chrome.downloads.download({
        url: dataUrl,
        filename: `${exportPath}/${date}.md`,
        saveAs: false,
        conflictAction: 'overwrite'
      });

      addLog(LogType.INFO, 'Flushed local Markdown export', {
        date,
        entryCount: entries.length
      });
    }
  } catch (error: unknown) {
    addLog(LogType.ERROR, 'Local Markdown flush failed', { error: String(error) });
  }
}
```

- [ ] **Step 4: テストを実行し成功を確認**

Run: `npm test -- localMarkdownExportCore`
Expected: PASS（5 tests）

- [ ] **Step 5: 型チェックとコミット**

Run: `npm run type-check`
Expected: エラーなし

```bash
git add src/background/localMarkdownExportCore.ts src/background/__tests__/localMarkdownExportCore.test.ts
git commit -m "feat(background): 3モード共通のMarkdownフラッシュ処理をlocalMarkdownExportCoreに抽出"
```

---

## Task 3: `localMarkdownIdleFlusher.ts` を `initExportScheduler` に置き換え

**Files:**
- Modify: `src/background/localMarkdownIdleFlusher.ts`（全体書き換え）
- Modify: `src/background/__tests__/localMarkdownIdleFlusher.test.ts`（全体書き換え）

- [ ] **Step 1: 失敗するテストを書く（既存ファイルを全置換）**

Replace `src/background/__tests__/localMarkdownIdleFlusher.test.ts` entirely with:

```typescript
/**
 * localMarkdownIdleFlusher.test.ts
 * initExportScheduler wires the alarm/listener combination matching the
 * user's chosen LOCAL_MARKDOWN_EXPORT_TIMING.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockFlushBufferedExports = vi.hoisted(() => vi.fn());
const mockOnStateChangedAddListener = vi.hoisted(() => vi.fn());
const mockIdle = vi.hoisted(() => ({ onStateChanged: { addListener: mockOnStateChangedAddListener } }));
const mockAlarmsCreate = vi.hoisted(() => vi.fn());
const mockAlarmsClear = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
  },
  getSettings: mockGetSettings,
}));

vi.mock('../localMarkdownExportCore.js', () => ({
  flushBufferedExports: mockFlushBufferedExports,
}));

vi.stubGlobal('chrome', {
  idle: mockIdle,
  alarms: { create: mockAlarmsCreate, clear: mockAlarmsClear },
});

import { initExportScheduler, IDLE_FALLBACK_ALARM, DAILY_FLUSH_ALARM } from '../localMarkdownIdleFlusher.js';

describe('initExportScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers idle listener and 30-min fallback alarm for timing="idle"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'idle' });

    await initExportScheduler();

    expect(mockAlarmsClear).toHaveBeenCalledWith(IDLE_FALLBACK_ALARM);
    expect(mockAlarmsClear).toHaveBeenCalledWith(DAILY_FLUSH_ALARM);
    expect(mockAlarmsCreate).toHaveBeenCalledWith(IDLE_FALLBACK_ALARM, { periodInMinutes: 30 });
    expect(mockOnStateChangedAddListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it('registers only the daily alarm for timing="daily"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'daily' });

    await initExportScheduler();

    expect(mockAlarmsCreate).toHaveBeenCalledWith(
      DAILY_FLUSH_ALARM,
      expect.objectContaining({ periodInMinutes: 1440 })
    );
    expect(mockAlarmsCreate).not.toHaveBeenCalledWith(IDLE_FALLBACK_ALARM, expect.anything());
    expect(mockOnStateChangedAddListener).not.toHaveBeenCalled();
  });

  it('registers no alarms or listeners for timing="manual"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'manual' });

    await initExportScheduler();

    expect(mockAlarmsCreate).not.toHaveBeenCalled();
    expect(mockOnStateChangedAddListener).not.toHaveBeenCalled();
  });

  it('registers no alarms or listeners for timing="immediate"', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'immediate' });

    await initExportScheduler();

    expect(mockAlarmsCreate).not.toHaveBeenCalled();
    expect(mockOnStateChangedAddListener).not.toHaveBeenCalled();
  });

  it('always clears both alarms before registering new ones (mode switch safety)', async () => {
    mockGetSettings.mockResolvedValue({ local_markdown_export_timing: 'manual' });

    await initExportScheduler();

    expect(mockAlarmsClear).toHaveBeenCalledWith(IDLE_FALLBACK_ALARM);
    expect(mockAlarmsClear).toHaveBeenCalledWith(DAILY_FLUSH_ALARM);
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

Run: `npm test -- localMarkdownIdleFlusher`
Expected: FAIL（`initExportScheduler`、`IDLE_FALLBACK_ALARM`、`DAILY_FLUSH_ALARM` が未定義）

- [ ] **Step 3: `localMarkdownIdleFlusher.ts` を全面書き換え**

Replace `src/background/localMarkdownIdleFlusher.ts` entirely with:

```typescript
/**
 * localMarkdownIdleFlusher.ts
 * Registers the alarm/listener combination matching the user's chosen
 * LOCAL_MARKDOWN_EXPORT_TIMING ('idle' or 'daily'). 'manual' and 'immediate'
 * need no standing registration — 'immediate' instead schedules a one-shot
 * debounce alarm per recording (see saveLocalMarkdownStep.ts).
 *
 * Actual chrome.downloads.download calls live in localMarkdownExportCore.ts,
 * shared across all three auto-export timings.
 */

import { getSettings, StorageKeys } from '../utils/storage.js';
import { flushBufferedExports } from './localMarkdownExportCore.js';

export const IDLE_FALLBACK_ALARM = 'yasumaro-local-md-flush';
export const DAILY_FLUSH_ALARM = 'yasumaro-local-md-daily-flush';
const IDLE_FALLBACK_INTERVAL_MIN = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function getYesterdayDateString(): string {
  const d = new Date(Date.now() - DAY_MS);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextMidnightTimestamp(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime();
}

/**
 * Wire the alarm/listener combination for the current LOCAL_MARKDOWN_EXPORT_TIMING.
 * Safe to call on every Service Worker startup, and whenever the user changes
 * the timing setting — always clears prior alarms first so switching modes
 * doesn't leave stale registrations behind.
 */
export async function initExportScheduler(): Promise<void> {
  chrome.alarms.clear(IDLE_FALLBACK_ALARM);
  chrome.alarms.clear(DAILY_FLUSH_ALARM);

  const settings = await getSettings();
  const timing = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING];

  if (timing === 'idle') {
    chrome.alarms.create(IDLE_FALLBACK_ALARM, { periodInMinutes: IDLE_FALLBACK_INTERVAL_MIN });
    if (chrome.idle) {
      chrome.idle.onStateChanged.addListener((state) => {
        if (state === 'idle') void flushBufferedExports();
      });
    }
  } else if (timing === 'daily') {
    chrome.alarms.create(DAILY_FLUSH_ALARM, {
      when: getNextMidnightTimestamp(),
      periodInMinutes: 1440,
    });
  }
  // 'manual' and 'immediate' need no standing alarm or listener.
}

/**
 * Flush only yesterday's buffer. Called from the daily alarm handler.
 */
export async function flushYesterdaysExport(): Promise<void> {
  await flushBufferedExports((date) => date === getYesterdayDateString());
}
```

- [ ] **Step 4: テストを実行し成功を確認**

Run: `npm test -- localMarkdownIdleFlusher`
Expected: PASS（5 tests）

- [ ] **Step 5: 型チェックとコミット**

Run: `npm run type-check`
Expected: エラーなし

```bash
git add src/background/localMarkdownIdleFlusher.ts src/background/__tests__/localMarkdownIdleFlusher.test.ts
git commit -m "refactor(background): initIdleFlushをinitExportSchedulerに置き換え、idle/daily切り替えに対応"
```

---

## Task 4: `saveLocalMarkdownStep.ts` に即時デバウンスを追加

**Files:**
- Modify: `src/background/pipeline/steps/saveLocalMarkdownStep.ts`
- Modify: `src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts`

- [ ] **Step 1: 失敗するテストを追記**

`src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts` の `vi.mock('../../../../utils/storage.js', ...)` を以下に変更（`LOCAL_MARKDOWN_EXPORT_TIMING` を追加）:

```typescript
vi.mock('../../../../utils/storage.js', () => ({
  StorageKeys: {
    LOCAL_MARKDOWN_EXPORT_ENABLED: 'local_markdown_export_enabled',
    LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED: 'local_markdown_export_auto_enabled',
    LOCAL_MARKDOWN_EXPORT_TIMING: 'local_markdown_export_timing',
    LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
  },
}));
```

`mockChrome` に `alarms` を追加（`downloads` の隣、13行目付近）:

```typescript
const mockChrome = {
  storage: {
    local: {
      get: vi.fn().mockImplementation(async (key: string) => ({ [key]: mockStorage[key] })),
      set: vi.fn().mockImplementation(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorage, obj);
      }),
    },
  },
  downloads: {
    download: vi.fn().mockResolvedValue(1),
  },
  alarms: {
    get: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
  },
};
```

`makeContext` のデフォルト `settings` に `local_markdown_export_timing: 'idle'` を追加（既存の `auto_enabled: true` はTask 1のマイグレーション対象だが、このステップ自体は `TIMING` を直接見るため必須）:

```typescript
    settings: {
      local_markdown_export_enabled: true,
      local_markdown_export_auto_enabled: true,
      local_markdown_export_timing: 'idle',
      local_markdown_export_path: 'Yasumaro',
    } as any,
```

ファイル末尾の `describe('日付バッファ', ...)` ブロックの直後に新規 `describe` を追加:

```typescript
  describe('即時タイミング（immediate）', () => {
    it('timing=immediate かつ既存アラーム無しの場合、1分後のアラームを作成する', async () => {
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_timing: 'immediate',
          local_markdown_export_path: 'Yasumaro',
        } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.alarms.create).toHaveBeenCalledWith(
        'yasumaro-local-md-immediate',
        { delayInMinutes: 1 }
      );
    });

    it('timing=immediate かつ既存アラームありの場合、アラームを作成しない（デバウンス）', async () => {
      mockChrome.alarms.get.mockResolvedValueOnce({ name: 'yasumaro-local-md-immediate' });
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_timing: 'immediate',
          local_markdown_export_path: 'Yasumaro',
        } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.alarms.create).not.toHaveBeenCalled();
    });

    it('timing=idle の場合はアラームを作成しない', async () => {
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_timing: 'idle',
          local_markdown_export_path: 'Yasumaro',
        } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.alarms.create).not.toHaveBeenCalled();
    });

    it('timing=manual の場合はバッファに追記されない（スキップ扱い）', async () => {
      const context = makeContext({
        settings: {
          local_markdown_export_enabled: true,
          local_markdown_export_timing: 'manual',
          local_markdown_export_path: 'Yasumaro',
        } as any,
      });

      await saveLocalMarkdownStep(context);

      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
      expect(mockChrome.alarms.create).not.toHaveBeenCalled();
    });
  });
```

**Important:** 既存の `'local_markdown_export_auto_enabled が false の場合はスキップ'` テスト（92-124行目付近）は `AUTO_ENABLED` を直接見る旧仕様のテストであり、Step 3 の実装変更後は無効化される。このテストは削除し、代わりに上記の `timing=manual` テストに置き換える（重複を避けるため、旧テストの削除も本ステップに含める）。

- [ ] **Step 2: テストを実行し失敗を確認**

Run: `npm test -- saveLocalMarkdownStep`
Expected: FAIL（`mockChrome.alarms` 未使用のため新規テストのみ失敗。`timing=manual` テストは実装変更前なので `auto_enabled` 参照ロジックのままだと通ってしまう可能性があるため、次のStepで実装を変更してから再実行して確認する）

- [ ] **Step 3: 実装を変更 — `AUTO_ENABLED` チェックを `TIMING` ベースに置き換え、`immediate` 用デバウンスを追加**

`src/background/pipeline/steps/saveLocalMarkdownStep.ts` の56-71行目を以下に置き換え:

```typescript
  // Check if local markdown export is enabled
  const settings = context.settings as Record<string, unknown>;
  const localExportEnabled = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED];
  const timing = settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] as
    | 'manual' | 'immediate' | 'idle' | 'daily' | undefined;
  addLog(LogType.INFO, '[LocalMD] Step fired', {
    url,
    enabled: localExportEnabled,
    timing,
    hasMarkdown: !!markdown
  });
  if (!localExportEnabled || timing === 'manual' || !timing) {
    addLog(LogType.INFO, '[LocalMD] Disabled, skipping', { url });
    return context;
  }
```

76行目付近（`await chrome.storage.local.set(...)` の直後、`addLog(LogType.INFO, 'Buffered to local Markdown...')` の前）に、即時タイミング用のデバウンスアラーム予約を追加:

```typescript
      dailyEntries.push(markdown);
      await chrome.storage.local.set({ [storageKey]: dailyEntries });

      if (timing === 'immediate') {
        const existingAlarm = await chrome.alarms.get(IMMEDIATE_FLUSH_ALARM);
        if (!existingAlarm) {
          chrome.alarms.create(IMMEDIATE_FLUSH_ALARM, { delayInMinutes: 1 });
        }
      }

      addLog(LogType.INFO, 'Buffered to local Markdown (deferred export)', {
```

ファイル冒頭（`DAILY_BUFFER_PREFIX` の定義の隣、18行目付近）に定数を追加:

```typescript
/** Storage key prefix for daily entry buffers */
export const DAILY_BUFFER_PREFIX = 'local_export_';

/** One-shot alarm name for the 'immediate' timing's 1-minute debounce */
export const IMMEDIATE_FLUSH_ALARM = 'yasumaro-local-md-immediate';
```

- [ ] **Step 4: テストを実行し成功を確認**

Run: `npm test -- saveLocalMarkdownStep`
Expected: PASS（全テスト。旧`auto_enabled`依存テストは削除済み）

- [ ] **Step 5: 型チェックとコミット**

Run: `npm run type-check`
Expected: エラーなし

```bash
git add src/background/pipeline/steps/saveLocalMarkdownStep.ts src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts
git commit -m "feat(pipeline): saveLocalMarkdownStepをTIMINGベースに変更し即時モードの1分デバウンスを追加"
```

---

## Task 5: `service-worker.ts` の配線更新

**Files:**
- Modify: `src/background/service-worker.ts:110-114`（初期化呼び出し）, `:927-940`（`onAlarm` ハンドラ）
- Test: `src/background/__tests__/service-worker.test.ts`（既存ファイルに追記。ファイル冒頭を読んで既存の `describe`/モックパターンに合わせる）

- [ ] **Step 1: 現状のonAlarmテストを確認**

Run: `grep -n "yasumaro-local-md-flush\|onAlarm" src/background/__tests__/service-worker.test.ts`

既存に `yasumaro-local-md-flush` アラームの発火テストがあれば、そのテスト名とモック構造を書き留めてから次のステップに進む（このファイルは非常に大きいため、対象箇所だけを `grep -n` で特定してから該当行を読むこと。ファイル全体を読まない）。

- [ ] **Step 2: `service-worker.ts` の初期化呼び出しを変更**

`src/background/service-worker.ts:110-114` を以下に変更:

```typescript
    // PBI 2026-07-09-03 / 2026-07-10: schedule local Markdown export per LOCAL_MARKDOWN_EXPORT_TIMING
    (async () => {
      const { initExportScheduler } = await import('./localMarkdownIdleFlusher.js');
      await initExportScheduler();
    })();
```

- [ ] **Step 3: `onAlarm` ハンドラを更新**

`src/background/service-worker.ts:934-939` を以下に置き換え。アラーム名の文字列リテラルは各モジュールが export する定数（`IDLE_FALLBACK_ALARM`、`DAILY_FLUSH_ALARM`、`IMMEDIATE_FLUSH_ALARM`）と同じ値である前提で、typo防止のため定数と揃えたコメントを付す:

```typescript
          // 'yasumaro-local-md-flush' === IDLE_FALLBACK_ALARM (localMarkdownIdleFlusher.js)
          if (alarm.name === 'yasumaro-local-md-flush') {
            void (async () => {
              const { flushBufferedExports } = await import('./localMarkdownExportCore.js');
              void flushBufferedExports();
            })();
          }
          // 'yasumaro-local-md-daily-flush' === DAILY_FLUSH_ALARM (localMarkdownIdleFlusher.js)
          if (alarm.name === 'yasumaro-local-md-daily-flush') {
            void (async () => {
              const { flushYesterdaysExport } = await import('./localMarkdownIdleFlusher.js');
              void flushYesterdaysExport();
            })();
          }
          // 'yasumaro-local-md-immediate' === IMMEDIATE_FLUSH_ALARM (saveLocalMarkdownStep.js)
          if (alarm.name === 'yasumaro-local-md-immediate') {
            void (async () => {
              const { flushBufferedExports } = await import('./localMarkdownExportCore.js');
              void flushBufferedExports();
            })();
          }
```

- [ ] **Step 4: 既存テストが壊れていないか確認**

Run: `npm test -- service-worker`
Expected: PASS（既存の `yasumaro-local-md-flush` 関連テストがあれば、import先が `localMarkdownIdleFlusher.js` の `flushPendingExports` から `localMarkdownExportCore.js` の `flushBufferedExports` に変わったことでモックの mock対象名がずれて失敗する可能性がある。失敗した場合は該当テストのモック import 先を新関数名・新モジュールパスに合わせて修正する）

- [ ] **Step 5: 型チェックとコミット**

Run: `npm run type-check`
Expected: エラーなし

```bash
git add src/background/service-worker.ts src/background/__tests__/service-worker.test.ts
git commit -m "feat(service-worker): initExportScheduler呼び出しと3アラーム分岐に配線変更"
```

---

## Task 6: ダッシュボードUIをラジオボタン4択に変更

**Files:**
- Modify: `entrypoints/options/index.html:240-245`
- Modify: `src/dashboard/dashboard.ts:224, 287-288, 300, 317-318, 337-372, 461-463, 1212-1216`
- Modify: `public/_locales/ja/messages.json:1607-1621`, `public/_locales/en/messages.json:1613-1622`
- Test: `src/dashboard/__tests__/dashboardSqliteService-extra.test.ts` は対象外。新規: `src/dashboard/__tests__/localMarkdownExportTimingUi.test.ts`

- [ ] **Step 1: HTMLを変更**

`entrypoints/options/index.html:240-245` を以下に置き換え:

```html
          <div id="localMarkdownExportSettings" class="hidden">
            <div class="form-group">
              <p data-i18n="localMarkdownExportTimingLabel">書き出しタイミング</p>
              <input type="radio" name="localMarkdownExportTiming" id="localMarkdownExportTimingManual" value="manual">
              <label for="localMarkdownExportTimingManual" class="inline-label" data-i18n="localMarkdownExportTimingManualLabel">手動のみ（自動書き出ししない）</label>

              <input type="radio" name="localMarkdownExportTiming" id="localMarkdownExportTimingImmediate" value="immediate">
              <label for="localMarkdownExportTimingImmediate" class="inline-label" data-i18n="localMarkdownExportTimingImmediateLabel">即時（記録直後、最短1分間隔）</label>

              <input type="radio" name="localMarkdownExportTiming" id="localMarkdownExportTimingIdle" value="idle">
              <label for="localMarkdownExportTimingIdle" class="inline-label" data-i18n="localMarkdownExportTimingIdleLabel">アイドル時 / 30分ごと</label>
              <div id="localMarkdownExportTimingIdleHelp" class="help-text" data-i18n="localMarkdownExportTimingIdleHelp">ブラウザがアイドル状態になったとき、または最大30分ごとにまとめて書き出します。</div>

              <input type="radio" name="localMarkdownExportTiming" id="localMarkdownExportTimingDaily" value="daily">
              <label for="localMarkdownExportTimingDaily" class="inline-label" data-i18n="localMarkdownExportTimingDailyLabel">日付が変わったとき（前日分を回収）</label>
            </div>
```

- [ ] **Step 2: i18nキーを追加（日本語）**

`public/_locales/ja/messages.json:1616-1621`（`localMarkdownExportAutoEnabledLabel`/`Help`）を削除し、代わりに以下を追加:

```json
  "localMarkdownExportTimingLabel": {
    "message": "書き出しタイミング"
  },
  "localMarkdownExportTimingManualLabel": {
    "message": "手動のみ（自動書き出ししない）"
  },
  "localMarkdownExportTimingImmediateLabel": {
    "message": "即時（記録直後、最短1分間隔）"
  },
  "localMarkdownExportTimingIdleLabel": {
    "message": "アイドル時 / 30分ごと"
  },
  "localMarkdownExportTimingIdleHelp": {
    "message": "ブラウザがアイドル状態になったとき、または最大30分ごとにまとめて書き出します。"
  },
  "localMarkdownExportTimingDailyLabel": {
    "message": "日付が変わったとき（前日分を回収）"
  },
```

- [ ] **Step 3: i18nキーを追加（英語）**

`public/_locales/en/messages.json:1619-1622`（`localMarkdownExportAutoEnabledLabel`/`Help`）を確認し、日本語版と同じキー名で英訳を追加:

```json
  "localMarkdownExportTimingLabel": {
    "message": "Export timing"
  },
  "localMarkdownExportTimingManualLabel": {
    "message": "Manual only (no auto-export)"
  },
  "localMarkdownExportTimingImmediateLabel": {
    "message": "Immediate (right after recording, min. 1-minute interval)"
  },
  "localMarkdownExportTimingIdleLabel": {
    "message": "On idle / every 30 minutes"
  },
  "localMarkdownExportTimingIdleHelp": {
    "message": "Exports are batched when the browser becomes idle, or at least every 30 minutes."
  },
  "localMarkdownExportTimingDailyLabel": {
    "message": "When the date changes (collects the previous day)"
  },
```

- [ ] **Step 4: `dashboard.ts` のDOM要素定義を変更**

`src/dashboard/dashboard.ts:224` の型定義（`localMarkdownExportEnabledInput: HTMLInputElement | null;` の直後）に追加:

```typescript
  localMarkdownExportEnabledInput: HTMLInputElement | null;
  localMarkdownExportTimingRadios: NodeListOf<HTMLInputElement> | null;
```

`localMarkdownExportAutoEnabledInput: HTMLInputElement | null;` の行（同じインターフェース内、`AutoEnabled` を参照している箇所）は削除する。

`:287-288` を以下に置き換え:

```typescript
      localMarkdownExportEnabledInput: document.getElementById('localMarkdownExportEnabled') as HTMLInputElement | null,
      localMarkdownExportTimingRadios: document.querySelectorAll('input[name="localMarkdownExportTiming"]') as NodeListOf<HTMLInputElement>,
```

`:300`（デフォルトのnullオブジェクト、`localMarkdownExportEnabledInput: null,` を含む行）に対応する箇所を確認し、`:317-318` の `localMarkdownExportEnabledInput: null, localMarkdownExportAutoEnabledInput: null,` を以下に置き換え:

```typescript
    localMarkdownExportEnabledInput: null, localMarkdownExportTimingRadios: null,
```

- [ ] **Step 5: `getSettingsMapping()` からラジオボタンを除外し、専用の読み書き関数を追加**

`src/dashboard/dashboard.ts:368` の `[StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED]: el.localMarkdownExportAutoEnabledInput,` の行を削除する（ラジオボタン群は `getSettingsMapping()` の汎用ヘルパーでは扱えないため、個別に読み書きする）。

`getSettingsMapping()` 関数の直後（372行目の閉じ括弧の後）に新規関数を追加:

```typescript
/**
 * Read the LOCAL_MARKDOWN_EXPORT_TIMING radio group's checked value.
 * Returns undefined when no radio is checked (should not happen once
 * loadLocalMarkdownExportTiming has run, but guards against a blank DOM).
 */
export function extractLocalMarkdownExportTiming(): string | undefined {
  const el = getDashboardElements();
  if (!el.localMarkdownExportTimingRadios) return undefined;
  for (const radio of el.localMarkdownExportTimingRadios) {
    if (radio.checked) return radio.value;
  }
  return undefined;
}

/**
 * Apply a LOCAL_MARKDOWN_EXPORT_TIMING value to the radio group.
 */
export function loadLocalMarkdownExportTiming(timing: string | undefined): void {
  const el = getDashboardElements();
  if (!el.localMarkdownExportTimingRadios) return;
  for (const radio of el.localMarkdownExportTimingRadios) {
    radio.checked = radio.value === timing;
  }
}
```

- [ ] **Step 6: 設定の読み込み・保存箇所に新関数の呼び出しを追加**

`grep -n "loadSettingsToInputs(settings, getSettingsMapping())" src/dashboard/dashboard.ts` で該当行（439行目付近）を確認し、その直後に追加:

```typescript
  loadSettingsToInputs(settings, getSettingsMapping());
  loadLocalMarkdownExportTiming(settings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING]);
```

`grep -n "extractSettingsFromInputs(getSettingsMapping())" src/dashboard/dashboard.ts` で該当する3箇所（564, 643, 675行目付近）を確認し、それぞれ以下のパターンに変更:

```typescript
    const newSettings = extractSettingsFromInputs(getSettingsMapping());
    const timing = extractLocalMarkdownExportTiming();
    if (timing) newSettings[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = timing;
```

**Important:** 3箇所とも周辺コードの変数名・スコープが異なる可能性があるため、`newSettings` という変数名が実際にその箇所で使われているか、`grep -n` の結果を見てから該当行を `Read` で確認し、その文脈に合わせて挿入すること。

- [ ] **Step 7: 表示制御ロジックの確認**

`:461-463` と `:1212-1216` の `localExportSettingsDiv.classList.toggle('hidden', ...)` ロジックは、親チェックボックス（`localMarkdownExportEnabledInput.checked`）のみを見ており、ラジオボタン化による影響を受けないため変更不要。Read で該当行を確認し、`localMarkdownExportAutoEnabledInput` への参照が別途ないか確認する（あれば削除）。

- [ ] **Step 8: 型チェック**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 9: UIバインディングの失敗するテストを書く**

Create `src/dashboard/__tests__/localMarkdownExportTimingUi.test.ts`:

```typescript
/**
 * localMarkdownExportTimingUi.test.ts
 * Radio-group read/write helpers for LOCAL_MARKDOWN_EXPORT_TIMING.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractLocalMarkdownExportTiming, loadLocalMarkdownExportTiming } from '../dashboard.js';

function renderRadios(): void {
  document.body.innerHTML = `
    <input type="radio" name="localMarkdownExportTiming" id="r1" value="manual">
    <input type="radio" name="localMarkdownExportTiming" id="r2" value="immediate">
    <input type="radio" name="localMarkdownExportTiming" id="r3" value="idle">
    <input type="radio" name="localMarkdownExportTiming" id="r4" value="daily">
  `;
}

describe('LOCAL_MARKDOWN_EXPORT_TIMING radio group', () => {
  beforeEach(() => {
    renderRadios();
  });

  it('extractLocalMarkdownExportTiming returns the checked radio value', () => {
    (document.getElementById('r3') as HTMLInputElement).checked = true;
    expect(extractLocalMarkdownExportTiming()).toBe('idle');
  });

  it('extractLocalMarkdownExportTiming returns undefined when nothing is checked', () => {
    expect(extractLocalMarkdownExportTiming()).toBeUndefined();
  });

  it('loadLocalMarkdownExportTiming checks the matching radio', () => {
    loadLocalMarkdownExportTiming('daily');
    expect((document.getElementById('r4') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('r1') as HTMLInputElement).checked).toBe(false);
  });

  it('loadLocalMarkdownExportTiming checks nothing when value is undefined', () => {
    loadLocalMarkdownExportTiming(undefined);
    for (const id of ['r1', 'r2', 'r3', 'r4']) {
      expect((document.getElementById(id) as HTMLInputElement).checked).toBe(false);
    }
  });
});
```

**Important:** `dashboard.ts` は大量の DOM 依存・グローバル副作用を持つ大きなファイルである可能性が高い。この import が既存の他 dashboard テストと同様に動作するか（`getDashboardElements()` のキャッシュが `document.body.innerHTML` 差し替え後に前回のDOM参照を握ったままにならないか）を必ず確認すること。もし `getDashboardElements()` に内部キャッシュ変数（`_domElements` など）があり、テスト間で使い回されて古いDOM参照を返す場合は、各 `it` の前に対象キャッシュをリセットする関数を呼ぶか、モジュールを `vi.resetModules()` で読み直す必要がある。既存の dashboard 系テスト（例: `src/dashboard/__tests__/dashboardSqliteService-extra.test.ts`）がどうリセットしているか確認し、同じパターンに合わせる。

- [ ] **Step 10: テストを実行し成功を確認**

Run: `npm test -- localMarkdownExportTimingUi`
Expected: PASS（4 tests）

- [ ] **Step 11: 既存のdashboardテストが壊れていないか確認**

Run: `npm test -- dashboard`
Expected: PASS（`localMarkdownExportAutoEnabledInput` を参照していた既存テストがあれば失敗するため、grep で該当箇所を洗い出し、新しいラジオボタンAPIに合わせて修正する）

```bash
grep -rn "localMarkdownExportAutoEnabled" src/dashboard/__tests__/
```

該当テストが見つかった場合、そのテストの意図（自動書き出しON/OFFの保存確認）を保ったまま `extractLocalMarkdownExportTiming`/`loadLocalMarkdownExportTiming` ベースのアサーションに書き換える。

- [ ] **Step 12: コミット**

```bash
git add entrypoints/options/index.html src/dashboard/dashboard.ts public/_locales/ja/messages.json public/_locales/en/messages.json src/dashboard/__tests__/localMarkdownExportTimingUi.test.ts
git commit -m "feat(dashboard): ローカルMarkdown書き出しタイミングをラジオボタン4択のUIに変更"
```

---

## Task 7: ビルド確認とE2E的な手動確認手順の整備

**Files:** なし（ビルド・型チェック・全体テストの実行のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイートを実行**

Run: `npm test`
Expected: 全テストPASS。既存の `LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED` を直接参照していた他のテストファイル（`saveSqliteStep.test.ts` 等、Task内で洗い出しきれなかったもの）が残っていれば、ここで失敗として検出される。失敗したテストは `grep -rn "LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED\|local_markdown_export_auto_enabled" src/` で全箇所を洗い出し、都度対応する。

- [ ] **Step 3: ビルド**

Run: `npm run build`
Expected: `dist/chromium-mv3` にビルド成果物が生成され、エラーなし

- [ ] **Step 4: 手動確認手順をコミットメッセージ用に整理**

以下の確認観点をユーザーに提示する（コード変更は発生しない、実施のみの確認ステップ）:

1. 拡張機能を再読み込みし、ダッシュボード「初期設定」→「ローカル Markdown に書き出す」をONにする
2. 表示されたラジオボタン4択のうち「即時（記録直後、最短1分間隔）」を選択し保存
3. ページを2つ連続で記録し、1分程度待つ → ダウンロードが1回だけ発火することを確認
4. 「日付が変わったとき」を選択し保存 → 当日中はダウンロードが発火しないことを確認（翌日分の動作は日をまたがないと確認できないため、コードレビューでの担保に留める）
5. 「手動のみ」を選択し保存 → ページを記録してもダウンロードが一切発火しないことを確認

- [ ] **Step 5: 最終コミット（該当があれば）**

このタスクはコード変更を伴わないため、Step 2で修正が発生した場合のみコミットする:

```bash
git add -A
git commit -m "test: LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED参照の残存箇所をTIMINGベースに修正"
```
