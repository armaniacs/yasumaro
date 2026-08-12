# logCritical Notification Seam Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the notification responsibility out of `logCritical` into a `CriticalAlertSink` adapter, leaving `logCritical` to recording + immediate flush only.

**Architecture:** `logCritical` gains an optional `sink?: CriticalAlertSink` parameter. The default sink (`ChromeNotificationCriticalSink`) wraps the existing `chrome.notifications.create` + cooldown logic. A `FakeCriticalSink` is provided for tests. The cooldown state moves from `logCritical` into the sink. External `logCritical(message, details, errorCode, source)` signature is preserved (sink is appended, optional).

**Tech Stack:** TypeScript (ESM), Vitest, Chrome Extension MV3 `chrome.notifications` / `chrome.i18n`.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/logger/criticalAlertSink.ts` | **Create** — `CriticalAlertSink` interface + `ChromeNotificationCriticalSink` + `FakeCriticalSink` |
| `src/utils/logger/api.ts` | **Modify** — `logCritical` drops notifications/cooldown, calls sink |
| `src/background/sqliteAlert.ts` | **Modify** — passes `ChromeNotificationCriticalSink` (or leaves default) |
| `src/utils/__tests__/criticalAlertSink.test.ts` | **Create** — sink unit tests |

---

### Task 1: Create CriticalAlertSink adapter

**Files:**
- Create: `src/utils/logger/criticalAlertSink.ts`
- Test: `src/utils/__tests__/criticalAlertSink.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/criticalAlertSink.test.ts
import { ChromeNotificationCriticalSink, FakeCriticalSink } from '../logger/criticalAlertSink.js';
import { ErrorCode } from '../logger/types.js';

describe('FakeCriticalSink', () => {
  it('records raised alerts', () => {
    const sink = new FakeCriticalSink();
    sink.raise('boom', { a: 1 }, ErrorCode.UNKNOWN_ERROR);
    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0].message).toBe('boom');
  });
});

describe('ChromeNotificationCriticalSink cooldown', () => {
  it('suppresses within cooldown window', async () => {
    const sink = new ChromeNotificationCriticalSink({ now: () => 0, notifications: undefined });
    const first = await sink.shouldRaise();
    const second = await sink.shouldRaise();
    expect(first).toBe(true);
    expect(second).toBe(false); // cooldown active
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/criticalAlertSink.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/logger/criticalAlertSink.ts
import { ErrorCode, type ErrorCodeValues } from './types.js';

export interface CriticalAlertSink {
  raise(message: string, details: Record<string, unknown>, errorCode: ErrorCodeValues): void;
}

/** Test fake — records raised alerts without side effects */
export class FakeCriticalSink implements CriticalAlertSink {
  raised: Array<{ message: string; details: Record<string, unknown>; errorCode: ErrorCodeValues }> = [];
  raise(message: string, details: Record<string, unknown>, errorCode: ErrorCodeValues): void {
    this.raised.push({ message, details, errorCode });
  }
}

const COOLDOWN_MS = 5 * 60 * 1000;

/** Production sink — fires chrome.notifications with a cooldown */
export class ChromeNotificationCriticalSink implements CriticalAlertSink {
  private lastNotificationTime = 0;
  private readonly now: () => number;
  private readonly notifications: typeof chrome.notifications | undefined;

  constructor(opts?: { now?: () => number; notifications?: typeof chrome.notifications }) {
    this.now = opts?.now ?? (() => Date.now());
    this.notifications = opts?.notifications;
  }

  /** Whether a notification may be raised now (cooldown aware) */
  shouldRaise(): boolean {
    const now = this.now();
    if (now - this.lastNotificationTime < COOLDOWN_MS) return false;
    this.lastNotificationTime = now;
    return true;
  }

  raise(message: string, details: Record<string, unknown>, errorCode: ErrorCodeValues): void {
    if (!this.shouldRaise()) return;
    try {
      const notifications = this.notifications ?? (typeof chrome !== 'undefined' ? chrome.notifications : undefined);
      if (!notifications || typeof notifications.create !== 'function') return;
      const title = chrome.i18n?.getMessage('criticalAlertTitle') || 'Yasumaro — Critical Error';
      const body = chrome.i18n?.getMessage('criticalAlertBody', [message]) || message;
      const iconUrl = (typeof chrome.runtime !== 'undefined' && typeof chrome.runtime.getURL === 'function')
        ? chrome.runtime.getURL('icons/icon48.png')
        : 'icons/icon48.png';
      notifications.create({
        type: 'basic',
        iconUrl,
        title,
        message: body,
        priority: 2,
        requireInteraction: true,
      });
    } catch (e) {
      console.error('Logger: Failed to create critical notification', e);
    }
  }
}

/** Default shared instance used when no sink is passed to logCritical */
export const defaultCriticalSink = new ChromeNotificationCriticalSink();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/criticalAlertSink.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger/criticalAlertSink.ts src/utils/__tests__/criticalAlertSink.test.ts
git commit -m "refactor(logger): add CriticalAlertSink adapter for logCritical"
```

---

### Task 2: Strip notifications from logCritical

**Files:**
- Modify: `src/utils/logger/api.ts` (logCritical function, lines 218-265)

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/logCritical.test.ts
import * as logger from '../logger.js';
import { FakeCriticalSink } from '../logger/criticalAlertSink.js';
import { ErrorCode } from '../logger/types.js';

describe('logCritical', () => {
  it('records and raises via injected sink', async () => {
    const sink = new FakeCriticalSink();
    await logger.logCritical('disk full', { x: 1 }, ErrorCode.STORAGE_WRITE_FAILURE, 'test', sink);
    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0].message).toBe('disk full');
  });

  it('works without a sink (uses default no-op in test env)', async () => {
    await logger.logCritical('noop', {}, ErrorCode.UNKNOWN_ERROR, 'test');
    // no throw, default sink is no-op without chrome.notifications
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/logCritical.test.ts`
Expected: FAIL — `logCritical` does not accept a 5th `sink` argument

- [ ] **Step 3: Modify logCritical**

Replace the existing `logCritical` (api.ts:218-265) with:

```typescript
import { defaultCriticalSink, type CriticalAlertSink } from './criticalAlertSink.js';

export async function logCritical<T extends object = Record<string, unknown>>(
    message: string,
    details: T = {} as T,
    errorCode: ErrorCodeValues = ErrorCode.UNKNOWN_ERROR,
    source?: string,
    sink: CriticalAlertSink = defaultCriticalSink,
): Promise<void> {
    const entry = createStructuredLog(LogType.ERROR, message, details, errorCode, resolveLogSource(source));
    await writeStructuredLog(entry);
    // Critical logs are flushed immediately so they are not lost on SW termination.
    await flushLogs(true);

    console.error(`[CRITICAL:${errorCode}] ${message} ${JSON.stringify(details, (key, value) => {
        if (typeof value === 'string' && value.length > 128) {
            return value.slice(0, 128) + '...[truncated]';
        }
        if (typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && value.length > 40) {
            return value.slice(0, 8) + '...[redacted]';
        }
        return value;
    })}`);

    sink.raise(message, details as Record<string, unknown>, errorCode);
}
```

Remove the old `CRITICAL_NOTIFICATION_COOLDOWN_MS` / `lastCriticalNotificationTime` constants and the `chrome.notifications.create` block — those now live in `ChromeNotificationCriticalSink`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/logCritical.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger/api.ts src/utils/__tests__/logCritical.test.ts
git commit -m "refactor(logger): strip notifications from logCritical into sink"
```

---

### Task 3: Update sqliteAlert to use the sink

**Files:**
- Modify: `src/background/sqliteAlert.ts` (line 44 logCritical call)

- [ ] **Step 1: Verify current call**

Read `src/background/sqliteAlert.ts:44` — current: `void logCritical('SQLite persistent failure in ${component}', {...}, ErrorCode.STORAGE_READ_FAILURE, 'sqliteAlert');`

- [ ] **Step 2: Update the call to pass the sink explicitly**

```typescript
import { logCritical } from '../utils/logger.js';
import { ChromeNotificationCriticalSink } from '../utils/logger/criticalAlertSink.js';

const criticalSink = new ChromeNotificationCriticalSink();

// inside recordSqliteFailure, replace the logCritical call:
void logCritical(
    `SQLite persistent failure in ${component}`,
    { component, totalFailures: ALERT_THRESHOLD, lastError: error },
    ErrorCode.STORAGE_READ_FAILURE,
    'sqliteAlert',
    criticalSink,
);
```

- [ ] **Step 3: Run sqliteAlert tests**

Run: `npx vitest run src/background/__tests__/sqliteAlert.test.ts 2>/dev/null || npx vitest run src/background --grep sqliteAlert`
Expected: PASS (notification still fires via sink; behaviour equivalent)

- [ ] **Step 4: Commit**

```bash
git add src/background/sqliteAlert.ts
git commit -m "refactor(logger): wire sqliteAlert to CriticalAlertSink"
```

---

### Task 4: Full logger + sqlite verification

**Files:** none new

- [ ] **Step 1: Run logger + background tests**

Run: `npx vitest run src/utils/__tests__ src/background/__tests__/sqliteAlert.test.ts`
Expected: PASS

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in logger / background

- [ ] **Step 3: Commit if any fix needed**

Only if a type error surfaced; otherwise no commit.

---

## Self-Review

**Spec coverage:**
- CriticalAlertSink interface + Chrome + Fake → Task 1 ✅
- logCritical stripped of notifications/cooldown → Task 2 ✅
- sqliteAlert wired to sink → Task 3 ✅
- External interface preserved (sink optional, appended) → Task 2 ✅

**Placeholder scan:** No TBD. All code present.

**Type consistency:** `CriticalAlertSink.raise(message, details, errorCode)` matches Fake and Chrome impls. `ErrorCodeValues` imported from types.js.

**Scope check:** Single concern (notification seam). No decomposition needed.
