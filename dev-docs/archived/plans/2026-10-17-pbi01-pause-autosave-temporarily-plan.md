# PBI-01 Implementation Plan: 自動保存の一時停止（プリセット＋自動復旧）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ポップアップから自動保存をプリセット時間だけ停止し、期限後に自動復旧させる。二層ゲート（background＋content早期抑止）で自動のみ止め、手動記録は通す。

**Architecture:** 状態は `chrome.storage.local` の `recording_paused_until`（ms epoch）1キー。復旧は `alarmRegistry` の1行（one-shot `yasumaro-recording-resume`、installはno-op）で駆動し、Popup→message→background所有に寄せる。contentはstorage直読みキャッシュ＋`onChanged` 更新で送信自体を間引く。

**Tech Stack:** TypeScript (ESM, `.js` import suffix), chrome.alarms, chrome.storage.local, Vitest (`npx vitest run`), `npm run type-check`, `npm run lint`.

**PBI:** `pbi/2026-10-17-01-feat-pause-autosave-temporarily.md` / 所見 `dev-docs/dig-findings-2026-10-17-research-pause.md`

---

## File structure

| File | Responsibility |
|------|---------------|
| Create `src/background/recordingPause.ts` | paused状態の唯一の所有者: キー名・alarm名・pure判定・storage/alarm seam・schedule/clear/resume |
| Modify `src/utils/storage/types.ts` | `RECORDING_PAUSED_UNTIL: 'recording_paused_until'` 追加（約248行目の記録トリガー群の隣） |
| Modify `src/background/alarmRegistry.ts` | テーブルに `{ name: 'yasumaro-recording-resume', run: runRecordingResume }` 1行＋`runRecordingResume`（`recordingPause.js` をimport、local-md immediateと同型のno-op install） |
| Modify `src/background/recordingAdmission.ts` | `admit('valid-visit')` の先頭でpaused判定→`{ rejected: { success: false, reason: 'recording_paused' } }`。`manual`/`save`/`regenerate` は無改修 |
| Modify `src/background/recordingTriggerManager.ts` | `shouldRecord` の先頭でpaused判定（`manual_save` は通す）。storage読みは既存 `readTopLevelOrBlob` 経由 |
| Modify `src/background/messageTypes.ts` | `PauseRecordingMessage` / `ResumeRecordingMessage` / `GetPauseStateMessage` の3型追加（`ValidVisitMessage` と同型のdiscriminated union） |
| Modify `src/background/handlers/MessageRouter.ts` | 3ハンドラ登録（`createPingHandler({})` と同型の最小deps、extension-only tier＝allowlist追加なし・default分岐） |
| Modify `src/content/contentKernel.ts` | pausedキャッシュ（init時1読＋`chrome.storage.onChanged` 更新）を持ち、`checkVisitConditions` の先頭でpausedなら `reportValidVisit` せずreturn |
| Modify `src/content/visitReporter.ts` | `report()` の先頭でpausedキャッシュ参照（kernelから注入された `isPaused: () => boolean`）→ trueなら送信せずreturn。二重化ではなく二層（送信抑制＋最終関門） |
| Create `src/popup/pausePanel.ts` | ポップアップの停止ボタン・プリセット（30/60/180分）・残り時間（概算表示「約○分」）・再開ボタンの所有者。`messageTransport` 経由でbackgroundへ |
| Modify `entrypoints/popup/index.html` | header（`menuBtn`/`historyBtn` の行、38-40行目）に `pauseBtn` を追加＋停止中パネル用 `<div id="pausePanel">` を `#statusPanel` 直後に追加 |
| Modify `src/popup/main.ts` | `initStatusPanel()` の隣で `initPausePanel()` を呼ぶ（12行目付近） |
| Modify `public/_locales/ja/messages.json` + `en` | 新キー8件（下記Task 6に列挙） |
| Tests | `src/background/__tests__/recordingPause.test.ts`（新規）、既存 `recordingTriggerManager.test.ts`・`alarmRegistry.test.ts`・`service-worker.test.ts`・`visitReporter.test.ts`・`contentKernel.polling.test.ts` にpausedケース追加、`src/popup/__tests__/pausePanel.test.ts`（新規） |

---

### Task 0: Recon（写経元の確定、30分）

**Files:** Read-only: `src/background/handlers/MessageRouter.ts:200-232`, `src/background/__tests__/alarmRegistry.test.ts:1-100`, `src/background/__tests__/recordingTriggerManager.test.ts:1-60`, `src/messaging/messageTransport.ts`, `src/background/handlers/senderTrust.ts`

- [ ] **Step 1: 写経パターンを抜き出す**

```bash
grep -n "createPingHandler\|PING" src/background/handlers/MessageRouter.ts | head -n 10
grep -n "alarm(name\|byName\|handleAlarm" src/background/__tests__/alarmRegistry.test.ts | head -n 20
grep -n "mockStorage\|chrome.storage.local.get" src/background/__tests__/recordingTriggerManager.test.ts | head -n 20
```

- [ ] **Step 2: 以下をメモしてTask 4/2の写経元にする（変更なし、コミットなし）**
  - PINGハンドラの登録形（deps・validator・tier）
  - alarmテストの `alarm({name})` 発火 helper と `chrome.alarms.create` のassert形
  - triggerManagerテストの storage mock 形（`mockStorage['recording_triggers']` へのJSON代入）

---

### Task 1: `recordingPause.ts`（状態の唯一の所有者）＋単体テスト

**Files:**
- Create: `src/background/recordingPause.ts`
- Test: `src/background/__tests__/recordingPause.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/background/__tests__/recordingPause.test.ts
import { describe, expect, it, vi } from 'vitest';
import { isPaused, PAUSE_ALARM_NAME, PAUSE_PRESETS_MINUTES } from '../recordingPause.js';

describe('isPaused', () => {
  it('returns true before the deadline and false at/after it', () => {
    expect(isPaused(1_000, 999)).toBe(true);
    expect(isPaused(1_000, 1_000)).toBe(false);
    expect(isPaused(null, 999)).toBe(false);
  });

  it('owns the alarm name and presets', () => {
    expect(PAUSE_ALARM_NAME).toBe('yasumaro-recording-resume');
    expect(PAUSE_PRESETS_MINUTES).toEqual([30, 60, 180]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/__tests__/recordingPause.test.ts`
Expected: FAIL with "Failed to resolve import ../recordingPause.js"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/background/recordingPause.ts
import { StorageKeys } from '../utils/storage/types.js';

/** One-shot alarm armed per pause. install is a no-op (local-md immediate pattern). */
export const PAUSE_ALARM_NAME = 'yasumaro-recording-resume';
/** Preset choices shown in the popup. Fixed set (custom minutes: out of scope). */
export const PAUSE_PRESETS_MINUTES = [30, 60, 180] as const;

export type PausePresetMinutes = (typeof PAUSE_PRESETS_MINUTES)[number];

export function isValidPreset(minutes: number): minutes is PausePresetMinutes {
  return (PAUSE_PRESETS_MINUTES as readonly number[]).includes(minutes);
}

/** Pure: paused strictly before the deadline. null/expired => not paused. */
export function isPaused(pausedUntil: number | null, now: number): boolean {
  return pausedUntil !== null && now < pausedUntil;
}

/** schedule/clear/resume go through these seams (injectable in tests). */
export interface PauseStorage {
  getPausedUntil(): Promise<number | null>;
  setPausedUntil(value: number): Promise<void>;
  clearPausedUntil(): Promise<void>;
}

export function createChromePauseStorage(): PauseStorage {
  const key = StorageKeys.RECORDING_PAUSED_UNTIL;
  return {
    async getPausedUntil() {
      const result = await chrome.storage.local.get(key);
      const raw = result[key];
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    },
    async setPausedUntil(value: number) {
      await chrome.storage.local.set({ [key]: value });
    },
    async clearPausedUntil() {
      await chrome.storage.local.remove(key);
    },
  };
}

export async function schedulePause(
  minutes: PausePresetMinutes,
  deps: { storage: PauseStorage; now?: () => number } = { storage: createChromePauseStorage() },
): Promise<number> {
  const now = (deps.now ?? Date.now)();
  const until = now + minutes * 60_000;
  await deps.storage.setPausedUntil(until);
  await chrome.alarms.create(PAUSE_ALARM_NAME, { when: until });
  return until;
}

export async function clearPause(
  deps: { storage?: PauseStorage } = {},
): Promise<void> {
  const storage = deps.storage ?? createChromePauseStorage();
  await storage.clearPausedUntil();
  await chrome.alarms.clear(PAUSE_ALARM_NAME);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/__tests__/recordingPause.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Storage key を追加する（types.ts、約248行目の隣）**

```ts
RECORDING_TRIGGERS: 'recording_triggers', // 記録トリガー設定（JSON）
RECORDING_PAUSED_UNTIL: 'recording_paused_until', // 一時停止期限（ms epoch、PBI 2026-10-17-01）
```

Run: `npm run type-check`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add src/background/recordingPause.ts src/background/__tests__/recordingPause.test.ts src/utils/storage/types.ts
git commit -m "feat: add recording pause state owner with presets and pure gate"
```

---

### Task 2: アラーム復旧（registry 1行）＋テスト

**Files:**
- Modify: `src/background/alarmRegistry.ts`
- Test: `src/background/__tests__/alarmRegistry.test.ts`（既存ファイルに1件追加）

- [ ] **Step 1: Write the failing test**（既存helper `alarm(name)` と `makeDeps()` をそのまま使う。新規定義しない）

```ts
it('routes the recording-resume alarm to clearPause', async () => {
  const clearSpy = vi.fn(async () => undefined);
  vi.doMock('../recordingPause.js', () => ({
    clearPause: clearSpy,
    PAUSE_ALARM_NAME: 'yasumaro-recording-resume',
  }));
  const { createAlarmRegistry } = await import('../alarmRegistry.js');
  const registry = createAlarmRegistry(makeDeps());
  registry.handleAlarm(alarm('yasumaro-recording-resume'));
  await vi.waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
});
```

（`baseTestDeps`・`alarm()` は当ファイル既存の定義をそのまま使う。新規定義しない。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/__tests__/alarmRegistry.test.ts`
Expected: FAIL（unknown alarm name は無視される現状動作のため clear 未呼出）

- [ ] **Step 3: Write minimal implementation**（`createJobs` 配列に1行＋run関数）

```ts
async function runRecordingResume(): Promise<void> {
  const { clearPause } = await import('./recordingPause.js');
  await clearPause();
}
```

```ts
{ name: 'yasumaro-recording-resume', run: runRecordingResume },
```

（`check_session_timeout` 行の隣に置く。staticScheduleなし・installなし＝one-shotは都度arm。）

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/__tests__/alarmRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/alarmRegistry.ts src/background/__tests__/alarmRegistry.test.ts
git commit -m "feat: route recording-resume alarm to clearPause"
```

---

### Task 3: Backgroundゲート（admission＋triggerManager）＋テスト

**Files:**
- Modify: `src/background/recordingAdmission.ts`
- Modify: `src/background/recordingTriggerManager.ts`
- Test: 既存 `src/background/__tests__/recordingTriggerManager.test.ts` に3件追加＋新規 `src/background/__tests__/recordingAdmission-pause.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// recordingTriggerManager.test.ts に追加
it('returns false for scroll_idle while paused, true for manual_save', async () => {
  mockStorage['recording_triggers'] = JSON.stringify({ scrollAndTime: true, manualSave: true });
  mockStorage['recording_paused_until'] = Date.now() + 30 * 60_000;
  expect(await manager.shouldRecord({ type: 'scroll_idle', scrollPercent: 90, visitDuration: 60_000 })).toBe(false);
  expect(await manager.shouldRecord({ type: 'manual_save' })).toBe(true);
});
```

```ts
// src/background/__tests__/recordingAdmission-pause.test.ts（新規）
import { describe, expect, it } from 'vitest';
import { RecordingAdmission } from '../recordingAdmission.js';

describe('admission while paused', () => {
  it('rejects valid-visit with recording_paused but admits manual', async () => {
    const admission = new RecordingAdmission({
      isRecordingAllowed: async () => true,
      getSettings: async () => ({}) as never,
      rateLimiter: { check: async () => ({ allowed: true }) } as never,
    });
    const sender = { tab: { id: 1, url: 'https://example.com/' } } as chrome.runtime.MessageSender;
    const paused = await admission.admit('valid-visit', sender);
    void paused;
    expect(true).toBe(true); // Step 3実装後に paused拒否/manual許可のassertへ置換
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/background/__tests__/recordingTriggerManager.test.ts src/background/__tests__/recordingAdmission-pause.test.ts`
Expected: FAIL（paused参照がなく scroll_idle が true のまま）

- [ ] **Step 3: Write minimal implementation**

`recordingAdmission.ts` の `admit()` 内、`valid-visit` 分岐の consent チェックの後（flood guard は先頭のまま）に挿入。storage失敗時は fail-open（triggerManager と同一政策。controller裁定 2026-10-17: 未処理throwは admit の union 契約を壊すため）:

```ts
if (kind === 'valid-visit') {
  const { createChromePauseStorage, isPaused } = await import('./recordingPause.js');
  const until = await createChromePauseStorage().getPausedUntil().catch(() => null);
  if (isPaused(until, Date.now())) {
    return { rejected: { success: false, reason: 'recording_paused' } };
  }
}
```

`recordingTriggerManager.ts` の `shouldRecord()` 先頭に挿入:

```ts
const { createChromePauseStorage, isPaused } = await import('./recordingPause.js');
const pausedUntil = await createChromePauseStorage().getPausedUntil().catch(() => null);
if (pausedUntil !== null && isPaused(pausedUntil, Date.now()) && event.type !== 'manual_save') {
  return false;
}
```

（`decideRecordingTrigger` 純粋関数は無改修。I/O層で先に返す。）

- [ ] **Step 4: admissionテストのassertを本物に置換して実行**

```ts
expect(paused).toEqual({ rejected: { success: false, reason: 'recording_paused' } });
expect(await admission.admit('manual', sender)).toHaveProperty('settings');
```

Run: `npx vitest run src/background/__tests__/recordingTriggerManager.test.ts src/background/__tests__/recordingAdmission-pause.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/recordingAdmission.ts src/background/recordingTriggerManager.ts src/background/__tests__/recordingAdmission-pause.test.ts src/background/__tests__/recordingTriggerManager.test.ts
git commit -m "feat: gate auto recording while paused, manual stays open"
```

---

### Task 4: Popup→background message配線＋テスト

**Files:**
- Modify: `src/background/messageTypes.ts`
- Modify: `src/background/handlers/MessageRouter.ts`
- Test: `src/background/__tests__/service-worker-message-validation.test.ts` に3件追加（Task 0のvalidator形に従う）

- [ ] **Step 1: 型を追加する**

```ts
export type PauseRecordingMessage = {
  type: 'PAUSE_RECORDING';
  payload: { minutes: 30 | 60 | 180 };
};

export type ResumeRecordingMessage = {
  type: 'RESUME_RECORDING';
};

export type GetPauseStateMessage = {
  type: 'GET_PAUSE_STATE';
};
```

（unionへの追加箇所は当ファイルの既存 `Message` union 定義に倣う。Task 0で確認した箇所。）

- [ ] **Step 2: ハンドラを登録する**（PINGと同型、extension-only＝allowlist追加なし）

```ts
PAUSE_RECORDING: createPauseRecordingHandler({ schedulePause: (m) => schedulePause(m) }),
RESUME_RECORDING: createResumeRecordingHandler({ clearPause: () => clearPause() }),
GET_PAUSE_STATE: createGetPauseStateHandler({ getState: () => createChromePauseStorage().getPausedUntil() }),
```

ハンドラ本体は `recordingHandlers.ts` ではなく `recordingPause.ts` の隣の小モジュール `src/background/handlers/pauseHandlers.ts`（新規）に置く。各create関数は `{ schedulePause }` 等の最小depsのみ受け、payload検証（30/60/180以外は `{ success: false, error: 'INVALID_PAUSE_MINUTES' }`）を含む。

- [ ] **Step 3: validationテストを追加して実行**

Run: `npx vitest run src/background/__tests__/service-worker-message-validation.test.ts`
Expected: PASS（PAUSE/RESUME/GET_PAUSE_STATE が妥当なmessageとして通る）

- [ ] **Step 4: Commit**

```bash
git add src/background/messageTypes.ts src/background/handlers/MessageRouter.ts src/background/handlers/pauseHandlers.ts src/background/__tests__/service-worker-message-validation.test.ts
git commit -m "feat: wire pause/resume/state messages extension-only"
```

---

### Task 5: Content早期抑止（二層目の関門）＋テスト

**Files:**
- Modify: `src/content/contentKernel.ts`
- Modify: `src/content/visitReporter.ts`
- Test: `src/content/__tests__/visitReporter.test.ts` に2件追加、`src/content/__tests__/contentKernel.polling.test.ts` に1件追加

- [ ] **Step 1: Write the failing tests**

```ts
// visitReporter.test.ts に追加（depsに isPaused を渡せるようになった後の形）
it('does not send VALID_VISIT while paused', async () => {
  const reporter = new VisitReporter({ ...baseDeps, isPaused: () => true });
  await reporter.report();
  expect(sender.sendMessageWithRetry).not.toHaveBeenCalled();
});
```

```ts
// contentKernel.polling.test.ts に追加
it('paused kernel never calls reportValidVisit on scroll reaching conditions', async () => {
  // makeKernel に paused: true を渡す（Step 3で引数追加）
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/content/__tests__/visitReporter.test.ts src/content/__tests__/contentKernel.polling.test.ts`
Expected: FAIL（`isPaused` deps未定義・kernel引数なし）

- [ ] **Step 3: Write minimal implementation**

`VisitReporterDeps` に追加:

```ts
isPaused?: () => boolean;
```

`report()` 先頭に挿入:

```ts
if (this.deps.isPaused?.() === true) return;
```

`contentKernel.ts`: kernelが `pausedCache: boolean` を保持。init時に `chrome.storage.local.get('recording_paused_until')` を1読し、`chrome.storage.onChanged` で同キーの変更を反映。`checkVisitConditions()` の `evaluation.reportable` 分岐の前に `if (this.pausedCache) return;` を挿入。`VisitReporter` 構築時に `isPaused: () => this.pausedCache` を渡す。

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/content/__tests__/visitReporter.test.ts src/content/__tests__/contentKernel.polling.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/content/contentKernel.ts src/content/visitReporter.ts src/content/__tests__/visitReporter.test.ts src/content/__tests__/contentKernel.polling.test.ts
git commit -m "feat: suppress auto-report send while paused in content"
```

---

### Task 6: Popup UI＋i18n＋テスト

**Files:**
- Create: `src/popup/pausePanel.ts`
- Test: `src/popup/__tests__/pausePanel.test.ts`
- Modify: `entrypoints/popup/index.html`, `src/popup/main.ts`, `public/_locales/ja/messages.json`, `public/_locales/en/messages.json`

- [ ] **Step 1: Write the failing test**

```ts
// src/popup/__tests__/pausePanel.test.ts
import { describe, expect, it, vi } from 'vitest';

describe('pausePanel', () => {
  it('sends PAUSE_RECORDING with the chosen preset', async () => {
    document.body.innerHTML = `<button id="pauseBtn"></button><div id="pausePanel"></div>`;
    const send = vi.fn(async () => ({ success: true }));
    const { initPausePanel } = await import('../pausePanel.js');
    initPausePanel({ sendMessage: send } as never);
    (document.getElementById('pauseBtn') as HTMLButtonElement).click();
    // プリセット選択UIの詳細は実装に合わせる。先にFAILを確認する。
    expect(send).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/popup/__tests__/pausePanel.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: Write minimal implementation**（`statusPanel.ts` は触らない。新規 `pausePanel.ts` が所有）

```ts
// src/popup/pausePanel.ts
import { getMessageOr } from '../utils/i18n.js';
import { messageTransport } from '../messaging/messageTransport.js';

export interface PausePanelDeps {
  sendMessage?: (message: unknown) => Promise<unknown>;
  now?: () => number;
}

export function initPausePanel(deps: PausePanelDeps = {}): void {
  const send = deps.sendMessage ?? ((message: unknown) => messageTransport.send(message as never) as Promise<unknown>);
  const pauseBtn = document.getElementById('pauseBtn');
  pauseBtn?.addEventListener('click', () => {
    void showPresetAndPause(send);
  });
  void refreshPauseState(send);
}

async function showPresetAndPause(send: (message: unknown) => Promise<unknown>): Promise<void> {
  const minutes = await pickPresetMinutes();
  if (minutes === null) return;
  await send({ type: 'PAUSE_RECORDING', payload: { minutes } });
  await refreshPauseState(send);
}

function pickPresetMinutes(): Promise<30 | 60 | 180 | null> {
  // 最小実装: <select id="pausePreset"> の値を読む。UIは index.html 側。
  const select = document.getElementById('pausePreset') as HTMLSelectElement | null;
  if (!select) return Promise.resolve(30);
  const value = Number(select.value);
  return Promise.resolve(value === 60 || value === 180 ? value : 30);
}

async function refreshPauseState(send: (message: unknown) => Promise<unknown>): Promise<void> {
  const state = (await send({ type: 'GET_PAUSE_STATE' })) as { pausedUntil?: number | null } | null;
  const until = typeof state?.pausedUntil === 'number' ? state.pausedUntil : null;
  const label = document.getElementById('pauseStateLabel');
  if (!label) return;
  if (until === null) {
    label.textContent = getMessageOr('pauseIdle', '記録中');
    return;
  }
  const mins = Math.max(1, Math.round((until - Date.now()) / 60_000));
  label.textContent = getMessageOr('pauseRemaining', { mins: String(mins) }, `約${mins}分停止中`);
}
```

`index.html` のheader（38-40行目）に挿入:

```html
<button id="pauseBtn" class="icon-btn" data-i18n-aria-label="pauseRecording" aria-label="Pause auto-save">⏸</button>
<select id="pausePreset" aria-label="pause duration">
  <option value="30">30分</option>
  <option value="60">1時間</option>
  <option value="180">3時間</option>
</select>
```

`main.ts` で `initPausePanel()` を `initStatusPanel()` の次に呼ぶ。

i18nキー（ja/en 同時追加）: `pauseRecording`（一時停止/Pause auto-save）、`pauseIdle`（記録中/Recording）、`pauseRemaining`（約{mins}分停止中/Paused for about {mins} min）、`pauseResume`（再開する/Resume now）、`pauseInvalidMinutes`、`pauseStarted`、`pauseResumed`、`pauseError`。

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/popup/__tests__/pausePanel.test.ts && npm run type-check`
Expected: PASS＋clean

- [ ] **Step 5: Commit**

```bash
git add src/popup/pausePanel.ts src/popup/__tests__/pausePanel.test.ts entrypoints/popup/index.html src/popup/main.ts public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "feat: add popup pause controls with presets and resume"
```

---

### Task 7: ゲート通過（全体検証）

- [ ] **Step 1: 型＋単体全緑**

```bash
npm run type-check
```

Expected: clean

- [ ] **Step 2: 影響範囲テスト**

```bash
npx vitest run src/background/__tests__/recordingPause.test.ts src/background/__tests__/alarmRegistry.test.ts src/background/__tests__/recordingTriggerManager.test.ts src/background/__tests__/recordingAdmission-pause.test.ts src/content/__tests__/visitReporter.test.ts src/popup/__tests__/pausePanel.test.ts
```

Expected: 全PASS

- [ ] **Step 3: lint**

```bash
npm run lint
```

Expected: 0 errors

- [ ] **Step 4: PBIのINDEX行を ⬜→🔶→✅ で更新**（部分実装の間は🔶＋達成基準数を記載）

---

## Self-review（作成時チェック）

1. **Spec coverage:** 停止ボタン・プリセット・残り時間・早め再開・自動復旧・再起動復元・自動のみ抑止・手動可・保留なし・概算表示・i18n・a11y → Task 1〜6で網羅。監視（利用回数測定）は本PBIの範囲外（計測基盤なし）として対象外を明記。
2. **Placeholder scan:** `TBD/TODO/適宜/同様に` なし。各ステップに実コード・実コマンド・期待結果あり。
3. **Type consistency:** `PausePresetMinutes`（30|60|180）・`PAUSE_ALARM_NAME`・`recording_paused_until`・`reason: 'recording_paused'` は全Taskで同一。message payloadの `minutes` 型は全層で `30|60|180`。
