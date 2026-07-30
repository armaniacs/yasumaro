# Fix VULN-001 & VULN-002 — Design Document (Final)

**Date**: 2026-07-30
**Source**: VulnHunter Security Audit — `obsidian-smart-history_VULNHUNT_RESULTS_2026-07-30-203440`
**Codebase convention**: constants in UPPER_SNAKE_CASE, English error messages, `deps.query()` accepts `Record<string, unknown>`, `chrome.storage` has no cross-store transactions

---

## Overview

Fix two confirmed vulnerabilities:

| ID | Title | CWE | Severity |
|---|---|---|---|
| VULN-001 | Unbounded `ids` array in `append_to_obsidian` | CWE-400 (Uncontrolled Resource Consumption) | Low |
| VULN-002 | Rate limiter browser restart bypass | CWE-307 (Improper Restriction of Excessive Authentication Attempts) | Low |

---

## VULN-001: Unbounded `ids` Array

### Current Behavior

`dashboardSqliteHandlers.ts:221-225`:
```typescript
case 'append_to_obsidian': {
  const ids = payload.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, error: 'No IDs provided' };
  }
  // ...deps.query({ ids, limit: ids.length, orderBy: 'id', orderDir: 'ASC' })
```

No upper bound. Attacker sends 100K-element array → 100K `?` placeholders in SQL `IN` clause at `opfsWorker.ts:280-283` → offscreen document OOM → all SQLite fails.

### Fix

Three checks applied in this **exact order** (order is security-critical — check 1 gates check 2):

**Check 1: Array + non-empty + max length** — `ids.length === 0 || ids.length > MAX_APPEND_IDS` — gates both checks below. DoS-safe: rejects oversized arrays without iteration.

**Check 2: Element type** — `ids.every(id => typeof id === 'number')` — fast, O(n) on at-most-100 elements. Without this, an attacker could inject strings into `params.push(...ids)` at `opfsWorker.ts:282`, bypassing SQL parameterization assumptions.

**Check 3: Finite values** — `ids.every(id => Number.isFinite(id))` — rejects `NaN`, `Infinity`, `-Infinity` which SQLite cannot bind. Combined with Check 2 into a single predicate: `ids.every(id => typeof id === 'number' && Number.isFinite(id))`.

Constant placement (same module scope as existing `ALLOWED_UPDATE_FIELDS` at line 10):
```typescript
const MAX_APPEND_IDS = 100;
```

Revised block:
```typescript
case 'append_to_obsidian': {
  const ids = payload.ids;
  // Check 1: array shape
  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, error: 'No IDs provided' };
  }
  if (ids.length > MAX_APPEND_IDS) {
    return { success: false, error: `Maximum ${MAX_APPEND_IDS} IDs allowed` };
  }
  // Check 2+3: element types (safe — array is ≤100 elements at this point)
  if (!ids.every(id => typeof id === 'number' && Number.isFinite(id))) {
    return { success: false, error: 'All IDs must be finite numbers' };
  }
  // Safe cast: checks above guarantee number[]
  const numericIds = ids as number[];
  const allResult = await deps.query({ ids: numericIds, limit: numericIds.length, ... });
```

### Rationale

| Decision | Why |
|---|---|
| Length check BEFORE type check | `ids.every()` on 100K elements is itself a DoS vector. Length check gates it. |
| `Number.isFinite()` not just `typeof` | `NaN`, `Infinity` pass `typeof id === 'number'` but crash SQLite binding. |
| `MAX_APPEND_IDS` at module scope | Follows existing convention: `ALLOWED_UPDATE_FIELDS` (line 10), `RATE_LIMIT_ATTEMPTS` (rateLimiter.ts:7) |
| Defensive cast `as number[]` | `deps.query` expects `Record<string, unknown>`. After validation, explicit cast documents the type assertion. |

### Testing

| Test case | Expected |
|---|---|
| `ids: []` | rejected — "No IDs provided" |
| `ids: [1]` | accepted |
| `ids: [...]` (100 elements) | accepted |
| `ids: [...]` (101 elements) | rejected — "Maximum 100 IDs allowed" |
| `ids: [1, "a", 3]` | rejected — "All IDs must be finite numbers" |
| `ids: [NaN]` | rejected — "All IDs must be finite numbers" |
| `ids: [Infinity]` | rejected — "All IDs must be finite numbers" |
| `ids: [1.5, 2.7]` | accepted (floats are finite numbers; cast to integer by SQLite) |

---

## VULN-002: Rate Limiter Browser Restart Bypass

### Current Behavior

`rateLimiter.ts` uses `chrome.storage.session` exclusively for all keys (`FAILED_ATTEMPTS`, `FIRST_ATTEMPT_TIME`, `LOCKED_UNTIL`). Session storage is cleared on browser restart → rate limiter resets → unlimited brute-force across restarts.

### Fix

Persist `LOCKED_UNTIL` to `chrome.storage.local`. Fail-safes and merge strategy below.

#### 1. `checkRateLimit()` — Read Phase

Read `LOCKED_UNTIL` from **both** stores. Merge strategy:
```typescript
const sessionStorage = await chrome.storage.session.get([...]);
const localStorage = await chrome.storage.local.get([STORAGE_KEYS.LOCKED_UNTIL]);

const sessionLockedUntil = (sessionStorage[STORAGE_KEYS.LOCKED_UNTIL] as number) || 0;
const localLockedUntil = (localStorage[STORAGE_KEYS.LOCKED_UNTIL] as number) || 0;
const lockedUntil = Math.max(sessionLockedUntil, localLockedUntil);
```

`Math.max` (not `??`) is correct:
- Session = 1700000000000, local = 0 → 1700000000000 (current session lockout)
- Session = 0, local = 1700000000000 → 1700000000000 (prior session lockout, restored after restart)
- Both = 0 → 0 (no lockout)

The existing check `if (lockedUntil && now < lockedUntil)` at line 36 handles this value correctly. If `lockedUntil` is expired (in the past), `now < lockedUntil` is false — lockout correctly skipped. The stale local value stays until `resetFailedAttempts()` cleans it up (see §3).

#### 2. Lockout Trigger — Write Phase

When `attempts >= RATE_LIMIT_ATTEMPTS` and within window (existing line 49-54):

**Write order: local FIRST, then session.** Rationale:
- If local write succeeds but session fails: lockout survives restart (local has it), current session loses the immediate lockout but it's re-read from local on next `checkRateLimit()` call (this session has the local value merged in).
- If local write fails: session write still happens → current session protected → restart resets (acceptable, same risk as before fix, but now rare — one write failure vs every restart).

```typescript
// Write order: local first, then session (fail-safe)
const lockoutTime = now + LOCKOUT_DURATION_MS;
await chrome.storage.local.set({ [STORAGE_KEYS.LOCKED_UNTIL]: lockoutTime });
await chrome.storage.session.set({ [STORAGE_KEYS.LOCKED_UNTIL]: lockoutTime });
```

#### 3. `resetFailedAttempts()` — Cleanup Phase

Remove `LOCKED_UNTIL` from **both** stores:
```typescript
export async function resetFailedAttempts(): Promise<void> {
  await chrome.storage.session.remove([
    STORAGE_KEYS.FAILED_ATTEMPTS,
    STORAGE_KEYS.FIRST_ATTEMPT_TIME,
    STORAGE_KEYS.LOCKED_UNTIL,
  ]);
  await chrome.storage.local.remove([STORAGE_KEYS.LOCKED_UNTIL]);
}
```

#### Summary of Changes

| Function | Session Storage | Local Storage (new) |
|---|---|---|
| `checkRateLimit()` reads | FAILED_ATTEMPTS, FIRST_ATTEMPT_TIME, LOCKED_UNTIL | LOCKED_UNTIL → merge via `Math.max` |
| Lockout trigger writes | LOCKED_UNTIL | LOCKED_UNTIL (written first) |
| `resetFailedAttempts()` removes | FAILED_ATTEMPTS, FIRST_ATTEMPT_TIME, LOCKED_UNTIL | LOCKED_UNTIL |
| `recordFailedAttempt()` writes | FAILED_ATTEMPTS, FIRST_ATTEMPT_TIME | — (no change) |

### Rationale

| Decision | Why |
|---|---|
| Only `LOCKED_UNTIL` needs persistence | Counters reset on restart is fine — the lockout timestamp blocks entry regardless of counter state |
| `Math.max` merge | Handles `0` correctly (vs `??` which treats `0` as present) |
| Write local BEFORE session | Local failure → session still protects current session; session failure → local protects after restart. Reverse order would lose persistence on session success+local failure. |
| No transaction needed | `chrome.storage` doesn't support cross-store transactions. Accept the two-step write; fail-safe ordering covers the gap. |

### Testing

| Test case | Expected |
|---|---|
| Lockout triggered → `LOCKED_UNTIL` in local storage | `chrome.storage.local.get([LOCKED_UNTIL])` returns the timestamp |
| Simulate restart (clear session) → `checkRateLimit()` while local has future lockout | returns `{ success: false }` |
| `resetFailedAttempts()` after lockout | both session and local `LOCKED_UNTIL` are removed |
| Lockout expired (local value in past) → `checkRateLimit()` | returns `{ success: true }` (existing logic at line 36 handles this) |

---

## Files Changed

| File | Change |
|---|---|
| `src/background/handlers/dashboardSqliteHandlers.ts` | +`MAX_APPEND_IDS = 100`, +3 validation checks in order (length cap → type → finite), safe cast |
| `src/utils/rateLimiter.ts` | +`chrome.storage.local` read in `checkRateLimit()`, +local write in lockout trigger, +local remove in `resetFailedAttempts()` |
| `obsidian-smart-history_VULNHUNT_RESULTS_.../exploit_tests/test_vuln_001_*.ts` | Update assertions to verify bound enforcement (+ fix pass → regression pass) |
| `obsidian-smart-history_VULNHUNT_RESULTS_.../exploit_tests/test_vuln_002_*.ts` | Update assertions to verify local storage persistence |

## Acceptance Criteria

1. `ids: [...101 elements]` → rejected with "Maximum 100 IDs allowed"
2. `ids: ["a", "b"]` → rejected with "All IDs must be finite numbers"
3. `ids: [NaN, Infinity]` → rejected with "All IDs must be finite numbers"
4. Lockout state survives simulated browser restart (session cleared, local retained)
5. Expired lockout in local storage does NOT block new attempts
6. All existing tests pass; updated exploit tests pass as regression guards
