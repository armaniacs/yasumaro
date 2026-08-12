# Logger Core Concern Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/utils/logger/core.ts` (408 lines) into focused modules — `LogBuffer` and `LogSanitize` as internal implementations, `LogStorageAdapter` and `LogFlushScheduler` as adapters — while keeping the external `addLog` / `getLogs` / `clearLogs` / `flushLogs` interface and all 159 call sites unchanged.

**Architecture:** `core.ts` becomes a thin orchestrator: validate input → sanitize → push to buffer → decide flush. The buffer, sanitize, storage, and scheduler are extracted into separate files under `src/utils/logger/`. Storage and scheduler are defined as interfaces (adapters) with a Chrome runtime implementation and an in-memory/test fake each, so tests can swap them without touching `chrome`. Sanitize stays an internal module (no interface) because it has only one real implementation (piiSanitizer).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, Chrome Extension MV3 APIs (`chrome.storage.local`, `chrome.alarms`, `chrome.runtime.onSuspend`).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/logger/types.ts` | (existing) `LogEntry`, `LogTypeValues`, `ErrorCode` — leaf, no change |
| `src/utils/logger/buffer.ts` | **Create** — `LogBuffer` in-memory ring: push / drain / size / clear |
| `src/utils/logger/sanitize.ts` | **Create** — `sanitizeLogDetails` / `sanitizeArray` moved from core, uses `piiSanitizer.sanitizeRegex` |
| `src/utils/logger/storageAdapter.ts` | **Create** — `LogStorageAdapter` interface + `ChromeStorageLogAdapter` + `InMemoryLogAdapter` |
| `src/utils/logger/flushScheduler.ts` | **Create** — `LogFlushScheduler` interface + `ChromeAlarmFlushScheduler` + `ImmediateFlushScheduler` |
| `src/utils/logger/core.ts` | **Modify** — becomes orchestrator; imports the 4 modules above; keeps `addLog`/`getLogs`/`clearLogs`/`flushLogs` exports |
| `src/utils/logger/api.ts` | (existing) unchanged — still calls `addLog` from core |
| `src/utils/__tests__/buffer.test.ts` | **Create** — buffer unit tests |
| `src/utils/__tests__/storageAdapter.test.ts` | **Create** — storage adapter tests (in-memory fake) |
| `src/utils/__tests__/flushScheduler.test.ts` | **Create** — scheduler tests (immediate fake) |
| `src/utils/__tests__/logger-enhanced.test.ts` | (existing) verify still passes |
| `src/utils/__tests__/logger-security.test.ts` | (existing) verify sanitize still masks |

---

### Task 1: Create LogBuffer internal module

**Files:**
- Create: `src/utils/logger/buffer.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/buffer.test.ts
import { LogBuffer } from '../logger/buffer.js';
import type { LogEntry } from '../logger/types.js';

function makeEntry(id: string): LogEntry {
  return { id, timestamp: Date.now(), type: 'INFO', message: id };
}

describe('LogBuffer', () => {
  it('pushes and drains entries', () => {
    const buf = new LogBuffer(10);
    buf.push(makeEntry('a'));
    buf.push(makeEntry('b'));
    expect(buf.size()).toBe(2);
    const drained = buf.drain();
    expect(drained.map(e => e.id)).toEqual(['a', 'b']);
    expect(buf.size()).toBe(0);
  });

  it('drops oldest when over capacity', () => {
    const buf = new LogBuffer(2);
    buf.push(makeEntry('a'));
    buf.push(makeEntry('b'));
    buf.push(makeEntry('c'));
    expect(buf.size()).toBe(2);
    expect(buf.drain().map(e => e.id)).toEqual(['b', 'c']);
  });

  it('clear empties the buffer', () => {
    const buf = new LogBuffer(5);
    buf.push(makeEntry('a'));
    buf.clear();
    expect(buf.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/buffer.test.ts`
Expected: FAIL — cannot find module `../logger/buffer.js`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/logger/buffer.ts
import type { LogEntry } from './types.js';

/**
 * In-memory ring buffer for pending log entries.
 * Pure (no chrome dependency) so it can be unit-tested directly.
 */
export class LogBuffer {
  private entries: LogEntry[] = [];

  constructor(private readonly capacity: number) {}

  push(entry: LogEntry): void {
    if (this.entries.length >= this.capacity) {
      // slice(1) drops the oldest; avoids in-place shift
      this.entries = this.entries.slice(1);
    }
    this.entries.push(entry);
  }

  drain(): LogEntry[] {
    const out = this.entries;
    this.entries = [];
    return out;
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/buffer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger/buffer.ts src/utils/__tests__/buffer.test.ts
git commit -m "refactor(logger): add LogBuffer in-memory ring module"
```

---

### Task 2: Create LogSanitize internal module

**Files:**
- Create: `src/utils/logger/sanitize.ts`
- Test: `src/utils/__tests__/logger-security.test.ts` (existing, verify after)

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/sanitize.test.ts
import { sanitizeLogDetails } from '../logger/sanitize.js';

describe('sanitizeLogDetails', () => {
  it('masks API keys in string values', async () => {
    const out = await sanitizeLogDetails({ token: 'sk-1234567890abcdef' });
    expect(out.token).not.toContain('sk-1234567890abcdef');
  });

  it('handles circular references', async () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const out = await sanitizeLogDetails(obj);
    expect(out.__sanitized).toBeDefined();
  });

  it('returns primitives unchanged', async () => {
    expect(await sanitizeLogDetails({ n: 42, b: true })).toEqual({ n: 42, b: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/sanitize.test.ts`
Expected: FAIL — cannot find module `../logger/sanitize.js`

- [ ] **Step 3: Write minimal implementation**

Move the `sanitizeLogDetails` / `sanitizeArray` functions and constants (`MAX_RECURSION_DEPTH`, `SANITIZE_RESULT`) from `core.ts` into this new file. Keep the exact logic from `core.ts:16-21` and `core.ts:195-328`. The only change is the import source for `sanitizeRegex`.

```typescript
// src/utils/logger/sanitize.ts
import { sanitizeRegex } from '../piiSanitizer.js';
import type { LogEntry } from './types.js';

const MAX_RECURSION_DEPTH = 100;
const SANITIZE_RESULT = {
  TOO_DEEP: '[SANITIZED: too deep]',
  CIRCULAR_REF: '[SANITIZED: circular reference]',
} as const;

async function sanitizeLogDetails(
  details: Record<string, unknown>,
  visitedObjects?: WeakSet<object>,
  depth = 0,
): Promise<Record<string, unknown>> {
  if (details === null || details === undefined) return details;
  if (typeof details !== 'object') throw new Error(`Expected object, got ${typeof details}`);
  if (typeof WeakSet !== 'undefined' && !visitedObjects) visitedObjects = new WeakSet<object>();
  if (depth >= MAX_RECURSION_DEPTH) return { __sanitized: SANITIZE_RESULT.TOO_DEEP };
  if (visitedObjects && visitedObjects.has(details)) return { __sanitized: SANITIZE_RESULT.CIRCULAR_REF };
  if (details instanceof Date) return { __value: details.toISOString() };
  if (details instanceof Error) return { message: details.message, stack: details.stack };
  if (visitedObjects) visitedObjects.add(details);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined) { sanitized[key] = value; continue; }
    if (typeof value === 'string') {
      const result = await sanitizeRegex(value);
      if (result.maskedItems.length > 0) {
        sanitized[key] = result.text;
        sanitized[`${key}_maskedTypes`] = result.maskedItems.map((m) => typeof m === 'string' ? m : m.type);
      } else {
        sanitized[key] = value;
      }
    } else if (typeof value === 'object') {
      if (Array.isArray(value)) sanitized[key] = await sanitizeArray(value, visitedObjects, depth + 1);
      else sanitized[key] = await sanitizeLogDetails(value as Record<string, unknown>, visitedObjects, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

async function sanitizeArray(arr: unknown[], visitedObjects?: WeakSet<object>, depth = 0): Promise<unknown[] | string> {
  if (depth >= MAX_RECURSION_DEPTH) return SANITIZE_RESULT.TOO_DEEP;
  if (visitedObjects && visitedObjects.has(arr)) return SANITIZE_RESULT.CIRCULAR_REF;
  if (visitedObjects) visitedObjects.add(arr);
  const sanitized: unknown[] = [];
  for (const item of arr) {
    if (item === null || item === undefined) { sanitized.push(item); continue; }
    if (typeof item === 'string') {
      const result = await sanitizeRegex(item);
      sanitized.push(result.maskedItems.length > 0 ? result.text : item);
    } else if (typeof item === 'object') {
      if (Array.isArray(item)) sanitized.push(await sanitizeArray(item, visitedObjects, depth + 1));
      else if (item instanceof Date) sanitized.push(item.toISOString());
      else if (item instanceof Error) sanitized.push({ message: item.message, stack: item.stack });
      else sanitized.push(await sanitizeLogDetails(item as Record<string, unknown>, visitedObjects, depth + 1));
    } else {
      sanitized.push(item);
    }
  }
  return sanitized;
}

export { sanitizeLogDetails, sanitizeArray };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/sanitize.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify existing security test still passes**

Run: `npx vitest run src/utils/__tests__/logger-security.test.ts`
Expected: PASS (sanitize behaviour unchanged, just relocated)

- [ ] **Step 6: Commit**

```bash
git add src/utils/logger/sanitize.ts src/utils/__tests__/sanitize.test.ts
git commit -m "refactor(logger): extract LogSanitize internal module from core"
```

---

### Task 3: Create LogStorageAdapter (interface + Chrome + in-memory)

**Files:**
- Create: `src/utils/logger/storageAdapter.ts`
- Test: `src/utils/__tests__/storageAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/storageAdapter.test.ts
import { InMemoryLogAdapter } from '../logger/storageAdapter.js';
import type { LogEntry } from '../logger/types.js';

function makeEntry(id: string): LogEntry {
  return { id, timestamp: Date.now(), type: 'INFO', message: id };
}

describe('InMemoryLogAdapter', () => {
  it('appends, loads, and prunes by retention', async () => {
    const adapter = new InMemoryLogAdapter();
    const old = makeEntry('old');
    old.timestamp = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
    await adapter.append([old, makeEntry('new')]);
    const loaded = await adapter.load();
    expect(loaded.map(e => e.id)).toEqual(['new']); // old pruned by retention
  });

  it('clears all', async () => {
    const adapter = new InMemoryLogAdapter();
    await adapter.append([makeEntry('a')]);
    await adapter.clear();
    expect(await adapter.load()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/storageAdapter.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/logger/storageAdapter.ts
import type { LogEntry } from './types.js';

const LOG_STORAGE_KEY = 'sanitization_logs';
const RETENTION_DAYS = 3;
const MAX_LOGS = 500;

export interface LogStorageAdapter {
  append(entries: LogEntry[]): Promise<void>;
  load(): Promise<LogEntry[]>;
  clear(): Promise<void>;
}

function pruneLogs(logs: LogEntry[]): LogEntry[] {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return logs.filter((log) => log.timestamp > cutoff);
}

/** Chrome runtime implementation — uses chrome.storage.local */
export class ChromeStorageLogAdapter implements LogStorageAdapter {
  async append(entries: LogEntry[]): Promise<void> {
    const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
    let logs: LogEntry[] = (storage[LOG_STORAGE_KEY] as LogEntry[]) || [];
    logs.push(...entries);
    logs = pruneLogs(logs);
    if (logs.length > MAX_LOGS) logs = logs.slice(logs.length - MAX_LOGS);
    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
  }

  async load(): Promise<LogEntry[]> {
    const storage = await chrome.storage.local.get(LOG_STORAGE_KEY);
    return (storage[LOG_STORAGE_KEY] as LogEntry[]) || [];
  }

  async clear(): Promise<void> {
    await chrome.storage.local.remove(LOG_STORAGE_KEY);
  }
}

/** Test fake — keeps everything in a plain array */
export class InMemoryLogAdapter implements LogStorageAdapter {
  private logs: LogEntry[] = [];

  async append(entries: LogEntry[]): Promise<void> {
    this.logs.push(...entries);
    this.logs = pruneLogs(this.logs);
    if (this.logs.length > MAX_LOGS) this.logs = this.logs.slice(this.logs.length - MAX_LOGS);
  }

  async load(): Promise<LogEntry[]> {
    return [...this.logs];
  }

  async clear(): Promise<void> {
    this.logs = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/storageAdapter.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger/storageAdapter.ts src/utils/__tests__/storageAdapter.test.ts
git commit -m "refactor(logger): add LogStorageAdapter with Chrome + in-memory impls"
```

---

### Task 4: Create LogFlushScheduler (interface + Chrome alarms + immediate)

**Files:**
- Create: `src/utils/logger/flushScheduler.ts`
- Test: `src/utils/__tests__/flushScheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/flushScheduler.test.ts
import { ImmediateFlushScheduler } from '../logger/flushScheduler.js';

describe('ImmediateFlushScheduler', () => {
  it('invokes the registered handler immediately on schedule', async () => {
    const scheduler = new ImmediateFlushScheduler();
    let called = 0;
    scheduler.onFlushRequested(() => { called++; });
    await scheduler.schedule();
    expect(called).toBe(1);
  });

  it('flushNow triggers the handler', async () => {
    const scheduler = new ImmediateFlushScheduler();
    let called = 0;
    scheduler.onFlushRequested(() => { called++; });
    await scheduler.flushNow();
    expect(called).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/flushScheduler.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/logger/flushScheduler.ts

const LOGGER_ALARM_NAME = 'yasumaro-logger-flush';
const BATCH_FLUSH_ALARM_MINUTES = 1;

export interface LogFlushScheduler {
  onFlushRequested(handler: () => Promise<void>): void;
  schedule(): void;
  flushNow(): Promise<void>;
}

/** Chrome runtime implementation — uses chrome.alarms + onSuspend */
export class ChromeAlarmFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;

  onFlushRequested(handler: () => Promise<void>): void {
    this.handler = handler;
    if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === LOGGER_ALARM_NAME) void this.handler?.();
      });
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
      chrome.runtime.onSuspend.addListener(async () => {
        await this.flushNow();
      });
    }
  }

  schedule(): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) return;
    chrome.alarms.create(LOGGER_ALARM_NAME, { delayInMinutes: BATCH_FLUSH_ALARM_MINUTES });
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}

/** Test fake — runs handler synchronously/immediately */
export class ImmediateFlushScheduler implements LogFlushScheduler {
  private handler: (() => Promise<void>) | null = null;

  onFlushRequested(handler: () => Promise<void>): void {
    this.handler = handler;
  }

  schedule(): void {
    void this.handler?.();
  }

  async flushNow(): Promise<void> {
    if (this.handler) await this.handler();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/flushScheduler.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger/flushScheduler.ts src/utils/__tests__/flushScheduler.test.ts
git commit -m "refactor(logger): add LogFlushScheduler with Chrome alarms + immediate impls"
```

---

### Task 5: Rewrite core.ts as orchestrator

**Files:**
- Modify: `src/utils/logger/core.ts` (full rewrite of body, keep exports)
- Test: `src/utils/__tests__/logger-enhanced.test.ts` (existing, verify)

- [ ] **Step 1: Write the failing test (orchestrator contract)**

```typescript
// src/utils/__tests__/coreOrchestrator.test.ts
import { LogBuffer } from '../logger/buffer.js';
import { InMemoryLogAdapter } from '../logger/storageAdapter.js';
import { ImmediateFlushScheduler } from '../logger/flushScheduler.js';
import { addLog, getLogs, clearLogs, flushLogs } from '../logger/core.js';

describe('core orchestrator', () => {
  it('addLog pushes to buffer and flush persists via storage', async () => {
    // These are the real exports; they use the default Chrome adapters in
    // production, but the test environment (no chrome) falls back gracefully.
    await clearLogs();
    await addLog('INFO', 'hello');
    const logs = await getLogs();
    expect(logs.some((l) => l.message === 'hello')).toBe(true);
    await clearLogs();
  });
});
```

- [ ] **Step 2: Run test to verify current core still behaves (baseline)**

Run: `npx vitest run src/utils/__tests__/coreOrchestrator.test.ts`
Expected: may PASS or FAIL depending on chrome availability — this is a baseline before rewrite. Note the result, then proceed.

- [ ] **Step 3: Rewrite core.ts as orchestrator**

Replace the entire body of `core.ts` (lines 1-408) with:

```typescript
/**
 * logger/core.ts
 * Orchestrator for log recording. Delegates buffering, sanitization, storage,
 * and flush scheduling to focused modules under src/utils/logger/.
 *
 * External interface (addLog / getLogs / clearLogs / flushLogs) is unchanged.
 */
import { sanitizeRegex } from '../piiSanitizer.js';
import { LogBuffer } from './buffer.js';
import { sanitizeLogDetails } from './sanitize.js';
import { ChromeStorageLogAdapter, type LogStorageAdapter } from './storageAdapter.js';
import { ChromeAlarmFlushScheduler, type LogFlushScheduler } from './flushScheduler.js';
import { LogEntry, LogTypeValues } from './types.js';

const MAX_PENDING_LOGS = 100;
const BATCH_FLUSH_SIZE = 10;

const buffer = new LogBuffer(MAX_PENDING_LOGS);
const storage: LogStorageAdapter = new ChromeStorageLogAdapter();
const scheduler: LogFlushScheduler = new ChromeAlarmFlushScheduler();

let isFlushing = false;

async function persistPending(): Promise<void> {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const entries = buffer.drain();
    if (entries.length > 0) await storage.append(entries);
  } catch (e) {
    console.error('Logger: Failed to flush logs', e);
  } finally {
    isFlushing = false;
  }
}

scheduler.onFlushRequested(() => persistPending());

export async function addLog<T extends object = Record<string, unknown>>(
  type: LogTypeValues,
  message: string,
  details: T = {} as T,
): Promise<void> {
  try {
    if (type === 'DEBUG' && !isDevelopment()) return;

    const sanitizedMessage = await sanitizeRegex(message);
    const { traceId: traceIdValue, ...restDetails } = details as Record<string, unknown>;
    const traceId = typeof traceIdValue === 'string' ? traceIdValue : undefined;

    const entry: LogEntry = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : (() => { const a = new Uint32Array(2); crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); })(),
      timestamp: Date.now(),
      type,
      message: sanitizedMessage.maskedItems.length > 0 ? sanitizedMessage.text : message,
      details: await sanitizeLogDetails(restDetails),
      traceId,
    };

    if (buffer.size() >= MAX_PENDING_LOGS) buffer.drain(); // drop oldest batch
    buffer.push(entry);

    if (buffer.size() >= BATCH_FLUSH_SIZE) await persistPending();
    else scheduler.schedule();
  } catch (e) {
    console.error('Logger: Failed to save log', e);
  }
}

export async function flushLogs(_immediate: boolean = false): Promise<void> {
  await persistPending();
}

export async function getLogs(): Promise<LogEntry[]> {
  const stored = await storage.load();
  return [...stored, ...buffer.drain()];
}

export async function clearLogs(): Promise<void> {
  buffer.clear();
  await storage.clear();
}

export function isDevelopment(): boolean {
  if (typeof process !== 'undefined' && process.env) {
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === 'development') return true;
    if (nodeEnv === 'production' || nodeEnv === 'test' || nodeEnv === undefined || nodeEnv === null) return false;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV === true) return true;
  return false;
}

export function getPendingLogCount(): number {
  return buffer.size();
}

export function clearPendingLogs(): void {
  buffer.clear();
}
```

Note: `getLogs` calls `buffer.drain()` which empties the buffer — this matches the original behaviour (pending logs are merged into the returned list and persisted on next flush). Keep it consistent with the original `getLogs` (core.ts:385-389).

- [ ] **Step 4: Run the full logger test suite**

Run: `npx vitest run src/utils/__tests__/logger-enhanced.test.ts src/utils/__tests__/logger-security.test.ts src/utils/__tests__/logger-source.test.ts src/utils/__tests__/buffer.test.ts src/utils/__tests__/sanitize.test.ts src/utils/__tests__/storageAdapter.test.ts src/utils/__tests__/flushScheduler.test.ts`
Expected: PASS (all logger tests green, addLog interface unchanged)

- [ ] **Step 5: Run type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from logger modules

- [ ] **Step 6: Commit**

```bash
git add src/utils/logger/core.ts
git commit -m "refactor(logger): rewrite core.ts as orchestrator over extracted modules"
```

---

### Task 6: Verify no call sites changed and full suite passes

**Files:**
- None new — verification only

- [ ] **Step 1: Confirm addLog call sites are unchanged**

Run: `grep -rn "from '../utils/logger.js'" src --include=*.ts | wc -l`
Expected: same count as before the refactor (the 100+ matches from exploration). The refactor did not touch any caller.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS (no regressions across the project)

- [ ] **Step 3: Commit a final verification note if needed**

If any test failed due to import path changes (e.g. a caller imported `sanitizeLogDetails` directly from core — verify none did), fix the import and commit. Otherwise no commit needed for this task.

---

## Self-Review

**Spec coverage:**
- `LogBuffer` internal module → Task 1 ✅
- `LogSanitize` internal module → Task 2 ✅
- `LogStorageAdapter` (interface + Chrome + in-memory) → Task 3 ✅
- `LogFlushScheduler` (interface + Chrome alarms + immediate) → Task 4 ✅
- `core.ts` orchestrator, exports unchanged → Task 5 ✅
- 159 call sites unchanged → Task 6 ✅
- Deletion test rationale (locality) documented in PBI → yes

**Placeholder scan:** No TBD/TODO. All code blocks complete. Tests have actual assertions.

**Type consistency:** `LogEntry`, `LogTypeValues` from `types.js` used consistently. `LogStorageAdapter` / `LogFlushScheduler` interfaces match their impls. `sanitizeLogDetails` signature matches Task 2 export.

**Scope check:** Single subsystem (logger core). No decomposition needed.
