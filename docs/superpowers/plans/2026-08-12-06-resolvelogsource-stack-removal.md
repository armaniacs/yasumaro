# resolveLogSource Stack Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `resolveLogSource` (which parses `new Error().stack` to guess the caller) from `api.ts`, so `source` is taken only from the explicit argument. Keep `extractSourceFromImportMetaUrl` as a pure utility.

**Architecture:** `api.ts` log functions stop calling `resolveLogSource(source)` and pass `source` through unchanged. `resolveLogSource` is deleted; `extractSourceFromImportMetaUrl` stays exported from `logger.ts` (pure URL→filename conversion, still tested). No external caller relied on `resolveLogSource` (only `logger.ts` re-exported it).

**Tech Stack:** TypeScript (ESM), Vitest.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/logger/api.ts` | **Modify** — remove `resolveLogSource`, pass `source` through |
| `src/utils/logger.ts` | **Modify** — drop `resolveLogSource` from re-export |
| `src/utils/__tests__/logger-source.test.ts` | **Modify** — delete resolveLogSource tests, keep extractSourceFromImportMetaUrl |

---

### Task 1: Remove resolveLogSource from api.ts

**Files:**
- Modify: `src/utils/logger/api.ts` (resolveLogSource function + 6 call sites)

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/logSourcePassthrough.test.ts
import * as logger from '../logger.js';

describe('log source passthrough', () => {
  it('uses explicit source without stack parsing', async () => {
    // In test env, addLog persists to in-memory; we just verify no throw and
    // that resolveLogSource is gone (import should fail if it existed).
    await logger.logError('test msg', { x: 1 }, 'UNKN_001', 'myModule');
    // If resolveLogSource still existed it would be importable; assert absence:
    expect((logger as Record<string, unknown>).resolveLogSource).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/logSourcePassthrough.test.ts`
Expected: FAIL — `resolveLogSource` is still exported (not undefined)

- [ ] **Step 3: Delete resolveLogSource and update call sites**

In `api.ts`:
- Delete the `resolveLogSource` function (lines 36-62).
- In `createStructuredLog` call sites, replace `resolveLogSource(source)` with `source`:

```typescript
// logInfo
const entry = createStructuredLog(LogType.INFO, message, details, undefined, source);
// logWarn
const entry = createStructuredLog(LogType.WARN, message, details, errorCode, source);
// logError
const entry = createStructuredLog(LogType.ERROR, message, details, errorCode, source);
// logDebug
const entry = createStructuredLog(LogType.DEBUG, message, details, undefined, source);
// logSanitize
const entry = createStructuredLog(LogType.SANITIZE, message, details, errorCode, source);
// logCritical
const entry = createStructuredLog(LogType.ERROR, message, details, errorCode, source);
```

`createStructuredLog` itself already accepts `source?: string` and assigns it directly — no change needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/logSourcePassthrough.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/logger/api.ts src/utils/__tests__/logSourcePassthrough.test.ts
git commit -m "refactor(logger): remove resolveLogSource stack parsing from api"
```

---

### Task 2: Update logger.ts re-export

**Files:**
- Modify: `src/utils/logger.ts` (lines 35-36 area)

- [ ] **Step 1: Remove resolveLogSource from re-export**

In `logger.ts`, find the block:
```typescript
export {
  extractSourceFromImportMetaUrl,
  resolveLogSource,
  ...
} from './logger/api.js';
```
Remove the `resolveLogSource,` line. Keep `extractSourceFromImportMetaUrl`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (no caller imports `resolveLogSource` from `logger.js`)

- [ ] **Step 3: Commit**

```bash
git add src/utils/logger.ts
git commit -m "refactor(logger): drop resolveLogSource from logger re-export"
```

---

### Task 3: Trim logger-source.test.ts

**Files:**
- Modify: `src/utils/__tests__/logger-source.test.ts`

- [ ] **Step 1: Remove resolveLogSource describe block**

Open `logger-source.test.ts`. Delete the `describe('resolveLogSource', ...)` block (lines ~30-50). Keep `describe('extractSourceFromImportMetaUrl', ...)`.

- [ ] **Step 2: Run the trimmed test**

Run: `npx vitest run src/utils/__tests__/logger-source.test.ts`
Expected: PASS (extractSourceFromImportMetaUrl tests only)

- [ ] **Step 3: Commit**

```bash
git add src/utils/__tests__/logger-source.test.ts
git commit -m "test(logger): drop resolveLogSource tests, keep extractSourceFromImportMetaUrl"
```

---

### Task 4: Full logger suite verification

**Files:** none new

- [ ] **Step 1: Run all logger tests**

Run: `npx vitest run src/utils/__tests__`
Expected: PASS (all green)

- [ ] **Step 2: Commit if fix needed**

Only if a regression surfaced.

---

## Self-Review

**Spec coverage:**
- resolveLogSource deleted → Task 1 ✅
- source passed through → Task 1 ✅
- extractSourceFromImportMetaUrl retained → Task 2/3 ✅
- re-export trimmed → Task 2 ✅
- existing tests pass → Task 4 ✅

**Placeholder scan:** No TBD. Code shown.

**Type consistency:** `source?: string` flows through `createStructuredLog` unchanged. `extractSourceFromImportMetaUrl` signature untouched.

**Scope check:** Single concern (stack removal). No decomposition.
