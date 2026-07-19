# Dead Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 10 confirmed dead code symbols across 8 files, verified by static analysis and grep.

**Architecture:** Pure removal — no new code, no refactoring, no test changes. Each commit removes a single risk category of dead symbols, followed by type-check + test + build validation.

**Tech Stack:** TypeScript, Chrome Extension Manifest V3, WXT build tool, Jest

---

### Task 1: Remove low-risk `_`-prefixed unused helpers (5 symbols, 5 files)

**Files:**
- Modify: `src/popup/errorUtils.ts:70-72`
- Modify: `src/popup/recordCurrentPage.ts:125-128`
- Modify: `src/popup/statusPanel.ts:16-21`
- Modify: `src/utils/piiSanitizer.ts:127-148`
- Modify: `src/utils/ublockMatcher.ts:210-230`

- [ ] **Step 1: Remove `_isKnownError()` from `src/popup/errorUtils.ts`**

Delete lines 70-72 (the function and the blank line before it):

```typescript
// Before (L68-73):
function isSystemError(error: unknown): error is SystemError {
  return hasSource(error) && error.source === 'system';
}

function _isKnownError(error: unknown): error is KnownError {
  return isObsidianError(error) || isAiError(error) || isNetworkError(error) || isUserError(error) || isSystemError(error);
}

/**
 * エラーメッセージ定数（Problem #5: キャッシュ追加でパフォーマンス改善）
 */

// After (L68 onward):
function isSystemError(error: unknown): error is SystemError {
  return hasSource(error) && error.source === 'system';
}

/**
 * エラーメッセージ定数（Problem #5: キャッシュ追加でパフォーマンス改善）
 */
```

- [ ] **Step 2: Remove `_resetRecordButtonAndClearFlag()` from `src/popup/recordCurrentPage.ts`**

Delete lines 125-128:

```typescript
// Before (L123-129):
}

function _resetRecordButtonAndClearFlag(btn: HTMLButtonElement): void {
  isAwaitingForceConfirm = false;
  void resetRecordButton(btn);
}

async function forceRecord(

// After:
}

async function forceRecord(
```

- [ ] **Step 3: Remove `_getRecordCurrentPage()` from `src/popup/statusPanel.ts`**

Delete lines 16-21:

```typescript
// Before (L14-23):
}

function _getRecordCurrentPage(): (force: boolean) => Promise<void> {
  if (!_recordCurrentPage) {
    throw new Error('recordCurrentPage not initialized. Call setRecordCurrentPageFn first.');
  }
  return _recordCurrentPage;
}

export async function initStatusPanel(): Promise<void> {

// After:
}

export async function initStatusPanel(): Promise<void> {
```

- [ ] **Step 4: Remove `_executeWithTimeout()` from `src/utils/piiSanitizer.ts`**

Delete lines 127-148:

```typescript
// Before (L125-149):
}

/**
 * タイムアウト付きで関数を実行する
 * @param {Function} fn - 実行する関数
 * @param {number} timeout - タイムアウト時間（ミリ秒）
 * @returns {Promise<T>} 関数の実行結果
 */
async function _executeWithTimeout<T>(fn: () => T, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${timeout}ms`));
        }, timeout);

        try {
            const result = fn();
            clearTimeout(timer);
            resolve(result);
        } catch (error) {
            clearTimeout(timer);
            reject(error);
        }
    });
}

export interface SanitizeOptions {

// After:
}

export interface SanitizeOptions {
```

- [ ] **Step 5: Remove `_matchRule()` from `src/utils/ublockMatcher.ts`**

Delete lines 210-230:

```typescript
// Before (L207-231):
  return result.isBlocked;
}

/**
 * Evaluate a single rule against a domain.
 * @param {string} urlDomain - Domain extracted from the URL.
 * @param {RuleWithDomain} rule - A rule object produced by ublockParser.js.
 * @param {UblockMatcherContext} context - Matching context.
 * @returns {boolean} - true if the rule matches the URL.
 */
function _matchRule(urlDomain: string, rule: RuleWithDomain, context: UblockMatcherContext): boolean {
  // Basic domain pattern match (supports wildcards via matchesPattern).
  if (!matchesPattern(urlDomain, rule.domain)) {
    return false;
  }

  // Evaluate optional rule options if present.
  if (rule.options && Object.keys(rule.options).length > 0) {
    return evaluateOptions(rule, context);
  }

  // No options → rule matches.
  return true;
}

// After:
  return result.isBlocked;
}

```

- [ ] **Step 6: Verify with type-check, tests, and build**

```bash
npm run type-check
npm test
npm run build
```

Expected: All pass with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/popup/errorUtils.ts src/popup/recordCurrentPage.ts src/popup/statusPanel.ts src/utils/piiSanitizer.ts src/utils/ublockMatcher.ts
git commit -m "chore: remove low-risk unused _-prefixed helper functions"
```

---

### Task 2: Remove unused exported public APIs (3 symbols, 3 files)

**Files:**
- Modify: `src/background/sqliteAlert.ts:58-60`
- Modify: `src/dashboard/tagClusterPanel.ts:22-24`
- Modify: `src/utils/promptSanitizer.ts:322-330`

- [ ] **Step 1: Remove `getConsecutiveFailureCount()` from `src/background/sqliteAlert.ts`**

Delete lines 58-60:

```typescript
// Before (L56-62):
}

export function getConsecutiveFailureCount(): number {
    return consecutiveFailures;
}

export function _resetForTesting(): void {

// After:
}

export function _resetForTesting(): void {
```

- [ ] **Step 2: Remove `setActiveTag()` from `src/dashboard/tagClusterPanel.ts`**

Delete lines 22-24:

```typescript
// Before (L20-26):
};

export function setActiveTag(tag: string | null): void {
  tagFilterState.activeTag = tag;
}

// Holds the controller across initTagClusterPanel() calls so a re-render

// After:
};

// Holds the controller across initTagClusterPanel() calls so a re-render
```

- [ ] **Step 3: Remove `checkContentDangerLevel()` from `src/utils/promptSanitizer.ts`**

Delete lines 322-330:

```typescript
// Before (L320-331):
}

/**
 * コンテンツの危険度を確認する
 * @param {string} content - 確認するコンテンツ
 * @returns {DangerLevelValues} 危険度レベル
 */
export function checkContentDangerLevel(content: string): DangerLevelValues {
  const result = sanitizePromptContent(content);
  return result.dangerLevel;
}

/**
 * 検出された警告をログ用にフォーマット

// After:
}

/**
 * 検出された警告をログ用にフォーマット
```

- [ ] **Step 4: Verify with type-check, tests, and build**

```bash
npm run type-check
npm test
npm run build
```

Expected: All pass with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/background/sqliteAlert.ts src/dashboard/tagClusterPanel.ts src/utils/promptSanitizer.ts
git commit -m "chore: remove unused exported public APIs"
```

---

### Task 3: Remove unused OPFS spike function `runOpfsSpikeB()` (1 file)

**Files:**
- Modify: `src/offscreen/opfsSpike.ts:89-197`

- [ ] **Step 1: Remove `runOpfsSpikeB()` from `src/offscreen/opfsSpike.ts`**

Delete lines 89-197 (the function and its preceding comment block, through end of file):

```typescript
// Before (L88 onward) — keep everything up to and including L88, delete L89 to EOF:

}

// After — file ends at the closing brace of `runOpfsSpikeA()` (L88):
}
```

The file should end at L88: the closing `}` of `runOpfsSpikeA()`.

Context of what remains (lines 88 is the last line kept):

```
      worker.postMessage('run');
  });
}
```

- [ ] **Step 2: Verify with type-check, tests, and build**

```bash
npm run type-check
npm test
npm run build
```

Expected: All pass. The OPFS spike test (`src/offscreen/__tests__/opfsSpike.test.ts`) tests `runSpikeSteps`, which remains in the file — it should continue to pass.

- [ ] **Step 3: Commit**

```bash
git add src/offscreen/opfsSpike.ts
git commit -m "chore: remove unused OPFS spike function runOpfsSpikeB"
```

---

### Task 4: Remove unconnected Breaking Changes modal subsystem (1 file, 5 symbols)

**Files:**
- Modify: `src/dashboard/dashboard.ts:747-796`

- [ ] **Step 1: Remove Breaking Changes modal subsystem from `src/dashboard/dashboard.ts`**

Delete lines 747-796 (the entire section comment + variable + constant + 3 functions):

```typescript
// Before (L745-798):
}

// Breaking Changes Notification Modal
// ============================================================================

let breakingChangesTrapId: string | null = null;

const BREAKING_CHANGES_SHOWN_KEY = 'breaking_changes_v5_shown';

function getBreakingChangesElements() {
  return {
    modal: document.getElementById('breakingChangesModal') as HTMLElement | null,
    closeBtn: document.getElementById('closeBreakingChangesModalBtn') as HTMLButtonElement | null,
    dismissBtn: document.getElementById('dismissBreakingChangesModalBtn') as HTMLButtonElement | null,
  };
}

async function showBreakingChangesModal(): Promise<void> {
  // 既に表示済みの場合はスキップ
  const shown = await chrome.storage.local.get(BREAKING_CHANGES_SHOWN_KEY).then(result => result[BREAKING_CHANGES_SHOWN_KEY]);
  if (shown) return;

  const { modal, dismissBtn, closeBtn } = getBreakingChangesElements();
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  void modal.offsetHeight;
  modal.classList.add('show');

  // ボタンのイベントリスナー設定
  dismissBtn?.addEventListener('click', closeBreakingChangesModal);
  closeBtn?.addEventListener('click', closeBreakingChangesModal);

  // Focus trap
  breakingChangesTrapId = focusTrapManager.trap(modal, closeBreakingChangesModal);
  dismissBtn?.focus();
}

async function closeBreakingChangesModal(): Promise<void> {
  const { modal } = getBreakingChangesElements();
  if (!modal) return;
  modal.classList.remove('show');
  modal.style.display = 'none';
  modal.classList.add('hidden');
  if (breakingChangesTrapId) {
    focusTrapManager.release(breakingChangesTrapId);
    breakingChangesTrapId = null;
  }

  // 表示済みとして記録
  await chrome.storage.local.set({ [BREAKING_CHANGES_SHOWN_KEY]: true });
}

// ============================================================================
// Initialization
// ============================================================================

// After (L745 onward):
}

// ============================================================================
// Initialization
// ============================================================================
```

- [ ] **Step 2: Verify with type-check, tests, and build**

```bash
npm run type-check
npm test
npm run build
```

Expected: All pass. Test files (`dashboard.test.ts`, `dashboard-handlers.test.ts`) contain HTML fixtures with `closeBreakingChangesModalBtn` elements but do not import or call the removed functions — they should continue to pass.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/dashboard.ts
git commit -m "chore: remove unconnected Breaking Changes modal subsystem"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full validation**

```bash
npm run type-check && npm test && npm run build
```

Expected: All pass, zero regressions.

- [ ] **Step 2: Optional — verify no remaining references exist**

```bash
rg -n "getConsecutiveFailureCount|showBreakingChangesModal|closeBreakingChangesModal|BREAKING_CHANGES_SHOWN_KEY|setActiveTag|runOpfsSpikeB|_isKnownError|_resetRecordButtonAndClearFlag|_getRecordCurrentPage|_executeWithTimeout|checkContentDangerLevel|_matchRule" src/
```

Expected: Zero matches.
